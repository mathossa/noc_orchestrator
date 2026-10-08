import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { updateMerakiInventoryConnection } from '@/lib/meraki-integration-store'
import type { MerakiOrganizationScope } from '@/lib/importer-v2-meraki-api'

type RouteContext = { params: Promise<{ sourceId: string }> }
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function optionalString(value: unknown) { return typeof value === 'string' ? value : undefined }
function organizationScopes(value: unknown): MerakiOrganizationScope[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('organizations must be an array.')
  return value.map((entry) => {
    const item = object(entry)
    if (!item || typeof item.organizationId !== 'string') throw new Error('Each organization scope requires organizationId.')
    return {
      enabled: item.enabled === undefined ? undefined : item.enabled === true,
      organizationId: item.organizationId,
      organizationName: optionalString(item.organizationName),
      customer: optionalString(item.customer),
      businessUnit: optionalString(item.businessUnit),
      networks: Array.isArray(item.networks) ? item.networks.map((network) => {
        const item = object(network)
        if (!item || typeof item.networkId !== 'string') throw new Error('Each Meraki network scope requires networkId.')
        return { enabled: item.enabled === undefined ? undefined : item.enabled === true, networkId: item.networkId, networkName: optionalString(item.networkName), site: optionalString(item.site) }
      }) : [],
    }
  })
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const body = object(await request.json())
    if (!body) throw new Error('Request body is required.')
    if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new Error('apiKey must be a string.')
    const connection = await updateMerakiInventoryConnection({
      sourceId,
      name: optionalString(body.name),
      environment: optionalString(body.environment),
      organizations: organizationScopes(body.organizations),
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      credentials: typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : undefined,
    })
    return NextResponse.json({ data: connection })
  } catch (error) {
    if (error instanceof AdminAccessError) return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: error.message } }, { status: error.status })
    if (error instanceof SyntaxError) return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    const message = error instanceof Error ? error.message : 'Unable to update Meraki connection.'
    return NextResponse.json({ error: { code: 'MERAKI_CONNECTION_UPDATE_FAILED', message } }, { status: message.includes('not found') ? 404 : 400 })
  }
}
