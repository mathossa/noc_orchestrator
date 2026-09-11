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

async function diagnoseIdentityConflict(batchId: string, mode: ImporterV2PublicationMode) {
  const qa = await getImporterV2PublicationQa(batchId)
  const candidateRows =
    mode === 'VALID_ONLY'
      ? qa.publication.validOnlyCandidateRows
      : qa.publication.allResolvedCandidateRows
  const conflicts = await findImporterV2PublicationIdentityConflicts({
    batchId,
    rowNumbers: candidateRows,
  })
  return conflicts.length > 0
    ? formatImporterV2IdentityConflictMessage(conflicts)
    : null
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
  let batchId: string | null = null
  let body: PublishRequest | null = null

  try {
    ;({ batchId } = await context.params)
    body = parsePublishRequest(await request.json())

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

    // Diagnose both staged-vs-canonical and staged-vs-staged durable identity
    // collisions before starting the transaction. The transaction repeats the
    // uniqueness assertion as the final race-condition safeguard.
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

    // Never leave an engineer with the transaction guard's generic identity
    // sentence. A conflict may arise only after an earlier row in this same
    // batch created a crosswalk, or due to a concurrent canonical change. Run
    // the detailed diagnostic again after rollback and return row/device data.
    if (
      error instanceof ImporterV2PublicationConflictError &&
      batchId &&
      body &&
      error.message.includes('Durable source identity')
    ) {
      try {
        const diagnostic = await diagnoseIdentityConflict(batchId, body.mode)
        if (diagnostic) {
          return NextResponse.json(
            {
              error: {
                code: 'IMPORTER_IDENTITY_CONFLICT',
                message: diagnostic,
              },
            },
            { status: 400 },
          )
        }
      } catch {
        // Preserve the original atomic-publication error if diagnostics fail.
      }
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
