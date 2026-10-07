import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { AuvikApiError } from '@/lib/auvik-api-client'
import { testAuvikInventoryConnection } from '@/lib/auvik-integration-store'

type RouteContext = {
  params: Promise<{ sourceId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    return NextResponse.json({
      data: await testAuvikInventoryConnection(sourceId),
    })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: { code: 'ACCESS_DENIED', message: error.message } },
        { status: error.status },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to test Auvik connection.'
    return NextResponse.json(
      {
        error: {
          code: 'AUVIK_CONNECTION_TEST_FAILED',
          message,
          ...(error instanceof AuvikApiError ? { providerStatus: error.status } : {}),
        },
      },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}
