import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import {
  createAuvikInventoryConnection,
  type AuvikInventoryTenantScope,
} from '@/lib/auvik-integration-store'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function tenantScopes(value: unknown): AuvikInventoryTenantScope[] {
  if (value === undefined) return []
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

export async function POST(request: Request) {
  try {
    await requireAdminRequest(request)
    const body = object(await request.json())
    if (
      !body ||
      typeof body.name !== 'string' ||
      typeof body.region !== 'string' ||
      typeof body.username !== 'string' ||
      typeof body.apiKey !== 'string'
    ) {
      throw new Error(
        'name, region, username and apiKey are required.',
      )
    }

    const connection = await createAuvikInventoryConnection({
      name: body.name,
      region: body.region,
      credentials: {
        username: body.username,
        apiKey: body.apiKey,
      },
      tenants: tenantScopes(body.tenants),
    })

    return NextResponse.json({ data: connection }, { status: 201 })
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
      error instanceof Error
        ? error.message
        : 'Unable to create Auvik connection.'
    return NextResponse.json(
      { error: { code: 'AUVIK_CONNECTION_CREATE_FAILED', message } },
      { status: 400 },
    )
  }
}
