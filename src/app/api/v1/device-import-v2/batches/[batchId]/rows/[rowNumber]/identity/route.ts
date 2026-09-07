import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  applyImporterV2WorkspaceIdentityDecision,
  previewImporterV2WorkspaceIdentityDecision,
  type ImporterV2WorkspaceIdentityDecision,
} from '@/lib/importer-v2-workspace-identity'

type RouteContext = {
  params: Promise<{ batchId: string; rowNumber: string }>
}

type RequestBody = {
  mode: 'PREVIEW' | 'APPLY'
  decision: ImporterV2WorkspaceIdentityDecision
  scopeToken?: string | null
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseBody(value: unknown): RequestBody {
  const body = object(value)
  if (!body || (body.mode !== 'PREVIEW' && body.mode !== 'APPLY')) {
    throw new Error('mode must be PREVIEW or APPLY.')
  }
  const decision = object(body.decision)
  if (!decision) throw new Error('decision is required.')
  const kinds = new Set([
    'CONFIRM_MATCH',
    'CHOOSE_CANDIDATE',
    'CREATE_NEW',
    'MANUAL_OVERRIDE',
  ])
  if (typeof decision.kind !== 'string' || !kinds.has(decision.kind)) {
    throw new Error('decision.kind must use a supported identity decision.')
  }
  if (typeof decision.explanation !== 'string' || !decision.explanation.trim()) {
    throw new Error('decision.explanation is required.')
  }
  if (
    decision.canonicalDeviceId !== undefined &&
    decision.canonicalDeviceId !== null &&
    typeof decision.canonicalDeviceId !== 'string'
  ) {
    throw new Error('canonicalDeviceId must be a string when supplied.')
  }
  if (body.mode === 'APPLY' && typeof body.scopeToken !== 'string') {
    throw new Error('scopeToken is required when applying an identity decision.')
  }
  return body as unknown as RequestBody
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { batchId, rowNumber: rawRowNumber } = await context.params
    const rowNumber = Number.parseInt(rawRowNumber, 10)
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      throw new Error('rowNumber must be a positive integer.')
    }
    const body = parseBody(await request.json())
    if (body.mode === 'PREVIEW') {
      const preview = await previewImporterV2WorkspaceIdentityDecision({
        batchId,
        rowNumber,
        decision: body.decision,
      })
      return NextResponse.json({ data: preview })
    }

    const session = await auth.api.getSession({ headers: request.headers })
    const result = await applyImporterV2WorkspaceIdentityDecision({
      batchId,
      rowNumber,
      decision: body.decision,
      scopeToken: body.scopeToken ?? '',
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
    const message =
      error instanceof Error ? error.message : 'Unable to process identity review.'
    const stale = message.includes('changed after preview')
    const badRequest =
      message.includes('must') ||
      message.includes('required') ||
      message.includes('not part of') ||
      message.includes('only valid') ||
      message.includes('no identity resolution')
    return NextResponse.json(
      {
        error: {
          code: stale ? 'STALE_IDENTITY_PREVIEW' : 'IDENTITY_REVIEW_FAILED',
          message,
        },
      },
      { status: stale ? 409 : badRequest ? 400 : 500 },
    )
  }
}
