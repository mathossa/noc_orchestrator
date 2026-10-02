import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import {
  updateAuvikInventoryConnection,
  type AuvikInventoryTenantScope,
} from '@/lib/auvik-integration-store'

type RouteContext = {
  params: Promise<{ sourceId: string }>
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function tenantScopes(value: unknown): AuvikInventoryTenantScope[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('tenants must be an array.')
  return value.map((entry) => {
    const item = object(entry)
    if (!item || typeof item.tenantId !== 'string') {
      throw new Error('Each tenant scope requires tenantId.')
    }
    return {
      tenantId: item.tenantId,
      tenantName: optionalString(item.tenantName),
      customer: optionalString(item.customer),
      businessUnit: optionalString(item.businessUnit),
      site: optionalString(item.site),
    }
  })
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const body = object(await request.json())
    if (!body) throw new Error('Request body is required.')

    const hasCredentials =
      typeof body.username === 'string' || typeof body.apiKey === 'string'
    if (
      hasCredentials &&
      (typeof body.username !== 'string' || typeof body.apiKey !== 'string')
    ) {
      throw new Error(
        'Provide both username and apiKey when replacing credentials.',
      )
    }

    const connection = await updateAuvikInventoryConnection({
      sourceId,
      name: optionalString(body.name),
      region: optionalString(body.region),
      tenants: tenantScopes(body.tenants),
      enabled:
        typeof body.enabled === 'boolean' ? body.enabled : undefined,
      credentials: hasCredentials
        ? {
            username: body.username as string,
            apiKey: body.apiKey as string,
          }
        : undefined,
    })

    return NextResponse.json({ data: connection })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: { code: 'ACCESS_DENIED', message: error.message } },
        { status: error.status },
      )
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to update Auvik connection.'
    return NextResponse.json(
      { error: { code: 'AUVIK_CONNECTION_UPDATE_FAILED', message } },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}
