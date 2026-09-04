import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'
import {
  applyImporterV2WorkspaceAction,
  previewImporterV2WorkspaceAction,
} from '@/lib/importer-v2-workspace-store'

type RouteContext = { params: Promise<{ batchId: string }> }
type ActionRequest = {
  mode: 'PREVIEW' | 'APPLY'
  selection: ImporterV2WorkspaceSelection
  action: ImporterV2WorkspaceAction
  scopeToken?: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseActionRequest(value: unknown): ActionRequest {
  if (!isObject(value)) throw new Error('Request body must be an object.')
  if (value.mode !== 'PREVIEW' && value.mode !== 'APPLY') {
    throw new Error('mode must be PREVIEW or APPLY.')
  }
  if (!isObject(value.selection) || (value.selection.mode !== 'ROWS' && value.selection.mode !== 'QUERY')) {
    throw new Error('selection must use ROWS or QUERY mode.')
  }
  if (!isObject(value.action) || typeof value.action.type !== 'string') {
    throw new Error('action is required.')
  }
  if (value.mode === 'APPLY' && typeof value.scopeToken !== 'string') {
    throw new Error('scopeToken is required when applying a previewed action.')
  }
  return value as ActionRequest
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const body = parseActionRequest(await request.json())
    if (body.mode === 'PREVIEW') {
      return NextResponse.json({
        data: await previewImporterV2WorkspaceAction({
          batchId,
          selection: body.selection,
          action: body.action,
        }),
      })
    }

    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({
      data: await applyImporterV2WorkspaceAction({
        batchId,
        selection: body.selection,
        action: body.action,
        scopeToken: body.scopeToken ?? '',
        actorUserId: session?.user.id ?? null,
      }),
    })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    const message = error instanceof Error ? error.message : 'Unable to process the reconciliation action.'
    const stale = message.includes('scope changed after preview')
    const badRequest = message.includes('must') || message.includes('required') || message.includes('Select at least') || message.includes('contains no rows')
    return NextResponse.json(
      { error: { code: stale ? 'STALE_PREVIEW' : 'IMPORTER_WORKSPACE_ACTION_FAILED', message } },
      { status: stale ? 409 : badRequest ? 400 : 500 },
    )
  }
}
