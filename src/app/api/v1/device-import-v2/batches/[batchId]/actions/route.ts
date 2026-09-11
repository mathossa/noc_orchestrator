import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'
import {
  applyImporterV2WorkspaceEffectiveOverlay,
  importerV2WorkspacePreviewChangeReason,
} from '@/lib/importer-v2-workspace-effective-overlay'
import { reconcileImporterV2ManualIdentity } from '@/lib/importer-v2-workspace-identity-repair'
import { recheckImporterV2Workspace } from '@/lib/importer-v2-workspace-maintenance'
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

const ACTION_TYPES = new Set([
  'SET_FIELD',
  'LINK_FIELD',
  'CLEAR_FIELD',
  'IGNORE_FIELD',
  'CHANGE_SET',
  'EXCLUDE_ROW',
  'REMEMBER_EXACT',
  'CREATE_SCOPED_RULE',
])
const CHANGE_SET_TYPES = new Set([
  'SET_FIELD',
  'LINK_FIELD',
  'CLEAR_FIELD',
  'IGNORE_FIELD',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateChangeSet(action: Record<string, unknown>) {
  if (!Array.isArray(action.changes) || action.changes.length === 0) {
    throw new Error('CHANGE_SET requires at least one field change.')
  }
  const fields = new Set<string>()
  for (const change of action.changes) {
    if (
      !isObject(change) ||
      typeof change.type !== 'string' ||
      !CHANGE_SET_TYPES.has(change.type) ||
      typeof change.field !== 'string'
    ) {
      throw new Error('Each CHANGE_SET item must be a supported field action.')
    }
    if (fields.has(change.field)) {
      throw new Error('CHANGE_SET may contain each field only once.')
    }
    fields.add(change.field)
    if (
      (change.type === 'SET_FIELD' || change.type === 'LINK_FIELD') &&
      (!isObject(change.value) || typeof change.value.label !== 'string' || !change.value.label.trim())
    ) {
      throw new Error('SET_FIELD and LINK_FIELD changes require a target label.')
    }
    if (typeof change.explanation !== 'string' || !change.explanation.trim()) {
      throw new Error('Each CHANGE_SET item requires an explanation.')
    }
  }
}

function parseActionRequest(value: unknown): ActionRequest {
  if (!isObject(value)) throw new Error('Request body must be an object.')
  if (value.mode !== 'PREVIEW' && value.mode !== 'APPLY') {
    throw new Error('mode must be PREVIEW or APPLY.')
  }
  if (
    !isObject(value.selection) ||
    (value.selection.mode !== 'ROWS' && value.selection.mode !== 'QUERY')
  ) {
    throw new Error('selection must use ROWS or QUERY mode.')
  }
  if (
    value.selection.mode === 'ROWS' &&
    (!Array.isArray(value.selection.rowNumbers) ||
      value.selection.rowNumbers.some((row) => !Number.isInteger(row)))
  ) {
    throw new Error('ROWS selection requires integer rowNumbers.')
  }
  if (
    value.selection.mode === 'QUERY' &&
    !isObject(value.selection.filters)
  ) {
    throw new Error('QUERY selection requires a filters object.')
  }
  if (
    !isObject(value.action) ||
    typeof value.action.type !== 'string' ||
    !ACTION_TYPES.has(value.action.type)
  ) {
    throw new Error('action is required and must use a supported action type.')
  }
  if (typeof value.action.explanation !== 'string' || !value.action.explanation.trim()) {
    throw new Error('action.explanation is required.')
  }
  if (value.action.type === 'CHANGE_SET') validateChangeSet(value.action)
  if (value.mode === 'APPLY' && typeof value.scopeToken !== 'string') {
    throw new Error('scopeToken is required when applying a previewed action.')
  }
  return value as unknown as ActionRequest
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { batchId } = await context.params
    const body = parseActionRequest(await request.json())
    if (body.mode === 'PREVIEW') {
      const preview = await previewImporterV2WorkspaceAction({
        batchId,
        selection: body.selection,
        action: body.action,
      })
      return NextResponse.json({
        data: {
          ...preview,
          confirmationReasons: [
            importerV2WorkspacePreviewChangeReason(preview, body.action),
            ...preview.confirmationReasons,
          ],
        },
      })
    }

    const session = await auth.api.getSession({ headers: request.headers })
    const result = await applyImporterV2WorkspaceAction({
      batchId,
      selection: body.selection,
      action: body.action,
      scopeToken: body.scopeToken ?? '',
      actorUserId: session?.user.id ?? null,
    })

    const effectiveState = await applyImporterV2WorkspaceEffectiveOverlay({
      batchId,
      scopeToken: result.scopeToken,
      action: body.action,
    })
    const identityRepair = await reconcileImporterV2ManualIdentity(batchId, result.scopeToken)
    const recheck = await recheckImporterV2Workspace(batchId, result.scopeToken)

    return NextResponse.json({
      data: {
        ...result,
        ...effectiveState,
        identityRepair,
        recheck,
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
        : 'Unable to process the reconciliation action.'
    const stale = message.includes('after preview')
    const badRequest =
      message.includes('must') ||
      message.includes('required') ||
      message.includes('Select at least') ||
      message.includes('matches no included staged rows') ||
      message.includes('CHANGE_SET')
    return NextResponse.json(
      {
        error: {
          code: stale
            ? 'STALE_PREVIEW'
            : 'IMPORTER_WORKSPACE_ACTION_FAILED',
          message,
        },
      },
      { status: stale ? 409 : badRequest ? 400 : 500 },
    )
  }
}
