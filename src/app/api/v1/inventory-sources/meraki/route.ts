import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { createMerakiInventoryConnection } from '@/lib/meraki-integration-store'
import type { MerakiOrganizationScope } from '@/lib/importer-v2-meraki-api'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}
function organizationScopes(value: unknown): MerakiOrganizationScope[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('organizations must be an array.')
  return value.map((entry) => {
    const item = object(entry)
    if (!item || typeof item.organizationId !== 'string') {
      throw new Error('Each organization scope requires organizationId.')
    }
    return {
      enabled: item.enabled === undefined ? undefined : item.enabled === true,
      organizationId: item.organizationId,
      organizationName: optionalString(item.organizationName),
      customer: optionalString(item.customer),
      businessUnit: optionalString(item.businessUnit),
      networks: Array.isArray(item.networks)
        ? item.networks.map((network) => {
            const value = object(network)
            if (!value || typeof value.networkId !== 'string') {
              throw new Error('Each Meraki network scope requires networkId.')
            }
            return {
              enabled: value.enabled === undefined ? undefined : value.enabled === true,
              networkId: value.networkId,
              networkName: optionalString(value.networkName),
              site: optionalString(value.site),
            }
          })
        : [],
    }
  })
}

export async function POST(request: Request) {
  try {
    await requireAdminRequest(request)
    const body = object(await request.json())
    if (!body || typeof body.name !== 'string' || typeof body.environment !== 'string' || typeof body.apiKey !== 'string') {
      throw new Error('name, environment and apiKey are required.')
    }
    return NextResponse.json({
      data: await createMerakiInventoryConnection({
        name: body.name,
        environment: body.environment,
        credentials: { apiKey: body.apiKey },
        organizations: organizationScopes(body.organizations),
      }),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: error.message } }, { status: error.status })
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : 'Unable to create Meraki connection.'
    return NextResponse.json({ error: { code: 'MERAKI_CONNECTION_CREATE_FAILED', message } }, { status: 400 })
  }
}
