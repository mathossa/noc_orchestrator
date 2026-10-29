import { withAdmin } from '@/lib/api-route-guard'
import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { MerakiApiError } from '@/lib/meraki-api-client'
import { testMerakiInventoryConnection } from '@/lib/meraki-integration-store'
type RouteContext = { params: Promise<{ sourceId: string }> }
async function POSTHandler(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    return NextResponse.json({ data: await testMerakiInventoryConnection(sourceId) })
  } catch (error) {
    if (error instanceof AdminAccessError) return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: error.message } }, { status: error.status })
    const message = error instanceof Error ? error.message : 'Unable to test Meraki connection.'
    return NextResponse.json({ error: { code: 'MERAKI_CONNECTION_TEST_FAILED', message, ...(error instanceof MerakiApiError ? { providerStatus: error.status, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds } : {}) } }, { status: message.includes('not found') ? 404 : 400 })
  }
}

export const POST = withAdmin(POSTHandler)
