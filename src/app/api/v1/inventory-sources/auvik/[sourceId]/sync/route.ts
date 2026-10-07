import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { AuvikApiError } from '@/lib/auvik-api-client'
import { runAuvikInventorySync } from '@/lib/auvik-inventory-sync'

type RouteContext = {
  params: Promise<{ sourceId: string }>
}

export async function POST(request: Request, context: RouteContext) {
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
