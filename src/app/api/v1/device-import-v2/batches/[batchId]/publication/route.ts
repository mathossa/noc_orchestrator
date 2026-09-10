import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  getImporterV2PublicationQa,
  ImporterV2PublicationConflictError,
  ImporterV2PublicationValidationError,
  publishImporterV2Batch,
} from '@/lib/importer-v2-publication-store'
import type { ImporterV2PublicationMode } from '@/lib/importer-v2-publication'
import { reconcileImporterV2ManualIdentity } from '@/lib/importer-v2-workspace-identity-repair'
import { recheckImporterV2Workspace } from '@/lib/importer-v2-workspace-maintenance'

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
    const identityRepair = await reconcileImporterV2ManualIdentity(batchId)
    if (identityRepair.repairedRowCount > 0) {
      await recheckImporterV2Workspace(batchId)
    }
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
