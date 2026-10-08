import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { MerakiApiError } from '@/lib/meraki-api-client'
import { discoverMerakiNetworks } from '@/lib/meraki-integration-store'
type RouteContext = { params: Promise<{ sourceId: string }> }
export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const body = await request.json() as { organizationId?: unknown }
    if (typeof body.organizationId !== 'string') throw new Error('organizationId is required.')
    const networks = await discoverMerakiNetworks(sourceId, body.organizationId)
    return NextResponse.json({ data: networks.map((network) => ({
      id: network.id, organizationId: network.organizationId, name: network.name,
      productTypes: network.productTypes ?? [], tags: network.tags ?? [], timeZone: network.timeZone ?? null,
    })) })
  } catch (error) {
    if (error instanceof AdminAccessError) return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: error.message } }, { status: error.status })
    if (error instanceof SyntaxError) return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    const message = error instanceof Error ? error.message : 'Unable to discover Meraki networks.'
    return NextResponse.json({ error: { code: 'MERAKI_NETWORK_DISCOVERY_FAILED', message, ...(error instanceof MerakiApiError ? { providerStatus: error.status, retryable: error.retryable } : {}) } }, { status: message.includes('not found') ? 404 : 400 })
  }
}
