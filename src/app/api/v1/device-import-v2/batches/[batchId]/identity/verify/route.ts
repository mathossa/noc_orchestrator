import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import type { ImporterV2WorkspaceSelection } from '@/lib/importer-v2-workspace'
import { verifyImporterV2WorkspaceObservedFirmware } from '@/lib/importer-v2-workspace-bulk-firmware'
import { verifyImporterV2WorkspaceIdentities } from '@/lib/importer-v2-workspace-bulk-identity'
import { recomputeImporterV2WorkspaceRows } from '@/lib/importer-v2-workspace-maintenance'

type RouteContext = { params: Promise<{ batchId: string }> }

type VerifyRequest = {
  selection: ImporterV2WorkspaceSelection
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseRequest(value: unknown): VerifyRequest {
  if (!isObject(value) || !isObject(value.selection)) {
    throw new Error('selection is required.')
  }
  const selection = value.selection
  if (selection.mode === 'ROWS') {
    if (
      !Array.isArray(selection.rowNumbers) ||
      selection.rowNumbers.length === 0 ||
      selection.rowNumbers.some(
        (rowNumber) => !Number.isInteger(rowNumber) || Number(rowNumber) < 1,
      )
    ) {
      throw new Error('ROWS selection requires positive integer rowNumbers.')
    }
  } else if (selection.mode === 'QUERY') {
    if (!isObject(selection.filters)) {
      throw new Error('QUERY selection requires a filters object.')
    }
  } else {
    throw new Error('selection must use ROWS or QUERY mode.')
  }
  return value as unknown as VerifyRequest
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const body = parseRequest(await request.json())
    const session = await auth.api.getSession({ headers: request.headers })
    const actorUserId = session?.user.id ?? null

    // One engineer action verifies both reusable identity matches and safe
    // observed-current-firmware evidence. Ambiguous/conflicting evidence stays
    // unresolved for the Inspector instead of being bulk accepted.
    const identity = await verifyImporterV2WorkspaceIdentities({
      batchId,
      selection: body.selection,
      actorUserId,
    })
    const firmware = await verifyImporterV2WorkspaceObservedFirmware({
      batchId,
      selection: body.selection,
      actorUserId,
    })
    const recompute = await recomputeImporterV2WorkspaceRows({ batchId })

    return NextResponse.json({
      data: {
        ...identity,
        firmware,
        recompute,
      },
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must contain valid JSON.',
          },
        },
        { status: 400 },
      )
    }
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to bulk verify staged device evidence.'
    const stale =
      message.includes('changed while bulk verification') ||
      message.includes('changed while bulk verification was running')
    const badRequest =
      message.includes('selection') ||
      message.includes('Select at least') ||
      message.includes('matches no staged rows') ||
      message.includes('rowNumbers')
    return NextResponse.json(
      {
        error: {
          code: stale
            ? 'STALE_BULK_VERIFICATION_SELECTION'
            : 'BULK_VERIFICATION_FAILED',
          message,
        },
      },
      { status: stale ? 409 : badRequest ? 400 : 500 },
    )
  }
}
