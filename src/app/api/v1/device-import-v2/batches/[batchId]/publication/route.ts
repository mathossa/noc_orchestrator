import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  getImporterV2PublicationQa,
  ImporterV2PublicationConflictError,
  ImporterV2PublicationValidationError,
  publishImporterV2Batch,
} from '@/lib/importer-v2-publication-store'
import type { ImporterV2PublicationMode } from '@/lib/importer-v2-publication'
import {
  findImporterV2PublicationIdentityConflicts,
  formatImporterV2IdentityConflictMessage,
} from '@/lib/importer-v2-publication-identity-diagnostics'

type RouteContext = { params: Promise<{ batchId: string }> }

type PublishRequest = {
  mode: ImporterV2PublicationMode
  qaFingerprint: string
  idempotencyKey: string
  approvedProposalKeys: string[]
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parsePublishRequest(value: unknown): PublishRequest {
  const body = object(value)
  if (!body) throw new ImporterV2PublicationValidationError('Request body must be an object.')
  if (body.mode !== 'ALL_RESOLVED' && body.mode !== 'VALID_ONLY') {
    throw new ImporterV2PublicationValidationError('mode must be ALL_RESOLVED or VALID_ONLY.')
  }
  if (typeof body.qaFingerprint !== 'string' || !body.qaFingerprint.trim()) {
    throw new ImporterV2PublicationValidationError('qaFingerprint is required.')
  }
  if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) {
    throw new ImporterV2PublicationValidationError('idempotencyKey is required.')
  }
  if (
    !Array.isArray(body.approvedProposalKeys) ||
    body.approvedProposalKeys.some((key) => typeof key !== 'string')
  ) {
    throw new ImporterV2PublicationValidationError('approvedProposalKeys must be an array of proposal keys.')
  }
  return body as unknown as PublishRequest
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params

    // QA reads must be immutable. Reconciliation is performed when an engineer
    // applies a workspace correction or explicitly requests Recheck. Mutating
    // rows here made concurrent GETs increment reviewRevision and invalidate
    // each other's QA fingerprints without any user-visible change.
    return NextResponse.json({ data: await getImporterV2PublicationQa(batchId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build importer publication QA.'
    return NextResponse.json(
      { error: { code: 'IMPORTER_PUBLICATION_QA_FAILED', message } },
      { status: 500 },
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const body = parsePublishRequest(await request.json())

    // Publication validation is read-only until the atomic publication
    // transaction begins. Manual identity edits are reconciled by the action /
    // recheck endpoints; publication must never silently rewrite the reviewed
    // workspace snapshot immediately before comparing its fingerprint.
    const currentQa = await getImporterV2PublicationQa(batchId)
    if (currentQa.qaFingerprint !== body.qaFingerprint) {
      throw new ImporterV2PublicationConflictError(
        'The staged QA snapshot changed after review. QA has been refreshed; review the latest staged changes before publishing.',
      )
    }

    // Keep the transaction-level uniqueness assertion as the final safeguard,
    // but diagnose the same condition before publication so engineers see the
    // exact staged row, durable identifier and canonical device involved.
    const candidateRows =
      body.mode === 'VALID_ONLY'
        ? currentQa.publication.validOnlyCandidateRows
        : currentQa.publication.allResolvedCandidateRows
    const identityConflicts = await findImporterV2PublicationIdentityConflicts({
      batchId,
      rowNumbers: candidateRows,
    })
    if (identityConflicts.length > 0) {
      throw new ImporterV2PublicationValidationError(
        formatImporterV2IdentityConflictMessage(identityConflicts),
      )
    }

    const session = await auth.api.getSession({ headers: request.headers })
    const result = await publishImporterV2Batch({
      batchId,
      mode: body.mode,
      qaFingerprint: body.qaFingerprint,
      idempotencyKey: body.idempotencyKey,
      approvedProposalKeys: body.approvedProposalKeys,
      actorUserId: session?.user.id ?? null,
    })
    return NextResponse.json({ data: result })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    const message = error instanceof Error ? error.message : 'Unable to publish importer batch.'
    if (error instanceof ImporterV2PublicationConflictError) {
      return NextResponse.json(
        { error: { code: 'STALE_IMPORTER_PUBLICATION_QA', message } },
        { status: 409 },
      )
    }
    if (error instanceof ImporterV2PublicationValidationError) {
      return NextResponse.json(
        { error: { code: 'IMPORTER_PUBLICATION_VALIDATION_FAILED', message } },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: { code: 'IMPORTER_PUBLICATION_FAILED', message } },
      { status: 500 },
    )
  }
}
