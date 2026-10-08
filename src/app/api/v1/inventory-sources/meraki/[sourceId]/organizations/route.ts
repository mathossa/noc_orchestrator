import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { MerakiApiError } from '@/lib/meraki-api-client'
import { discoverMerakiOrganizations } from '@/lib/meraki-integration-store'
type RouteContext = { params: Promise<{ sourceId: string }> }
export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const organizations = await discoverMerakiOrganizations(sourceId)
    return NextResponse.json({ data: organizations.map((organization) => ({ id: organization.id, name: organization.name, url: organization.url ?? null })) })
  } catch (error) {
    if (error instanceof AdminAccessError) return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: error.message } }, { status: error.status })
    const message = error instanceof Error ? error.message : 'Unable to discover Meraki organizations.'
    return NextResponse.json({ error: { code: 'MERAKI_ORGANIZATION_DISCOVERY_FAILED', message, ...(error instanceof MerakiApiError ? { providerStatus: error.status, retryable: error.retryable } : {}) } }, { status: message.includes('not found') ? 404 : 400 })
  }
}
