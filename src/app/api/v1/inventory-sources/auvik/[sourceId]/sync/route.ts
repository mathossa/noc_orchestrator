import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { AuvikApiError } from '@/lib/auvik-api-client'
import { runAuvikInventorySync } from '@/lib/auvik-inventory-sync'
import { listInventorySyncRuns } from '@/lib/inventory-sync-run-store'

type RouteContext = {
  params: Promise<{ sourceId: string }>
}

async function POSTHandler(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const result = await runAuvikInventorySync(sourceId)
    return NextResponse.json({
      data: {
        batch: result.batch,
        profile: result.profile,
        evaluation: result.evaluation,
        source: result.source,
        automation: result.automation,
        autoPublication: result.autoPublication,
        syncRun: result.syncRun,
      },
    })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: { code: 'ACCESS_DENIED', message: error.message } },
        { status: error.status },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to synchronize Auvik inventory.'
    return NextResponse.json(
      {
        error: {
          code: 'AUVIK_SYNC_FAILED',
          message,
          ...(error instanceof AuvikApiError
            ? {
                providerStatus: error.status,
                retryable: error.retryable,
              }
            : {}),
        },
      },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}

async function GETHandler(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const runs = await listInventorySyncRuns(sourceId)
    return NextResponse.json({
      data: runs.map((run) => ({
        ...run,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status })
    }
    return NextResponse.json(
      { error: { message: 'Unable to read sync progress.' } },
      { status: 500 },
    )
  }
}

export const GET = withAdmin(GETHandler)
export const POST = withAdmin(POSTHandler)
