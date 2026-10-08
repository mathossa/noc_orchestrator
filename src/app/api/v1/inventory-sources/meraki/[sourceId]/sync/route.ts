import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { MerakiApiError } from '@/lib/meraki-api-client'
import { runMerakiInventorySync } from '@/lib/meraki-inventory-sync'
type RouteContext = { params: Promise<{ sourceId: string }> }
export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const result = await runMerakiInventorySync(sourceId)
    return NextResponse.json({ data: {
      batch: result.batch, profile: result.profile, evaluation: result.evaluation,
      source: result.source, automation: result.automation, autoPublication: result.autoPublication, syncRun: result.syncRun,
    } })
  } catch (error) {
    if (error instanceof AdminAccessError) return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: error.message } }, { status: error.status })
    const message = error instanceof Error ? error.message : 'Unable to synchronize Meraki inventory.'
    return NextResponse.json({ error: { code: 'MERAKI_SYNC_FAILED', message, ...(error instanceof MerakiApiError ? { providerStatus: error.status, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds } : {}) } }, { status: message.includes('not found') ? 404 : 400 })
  }
}
