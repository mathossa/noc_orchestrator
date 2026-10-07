import { NextResponse } from 'next/server'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { AuvikApiError } from '@/lib/auvik-api-client'
import { discoverAuvikInventoryTenants } from '@/lib/auvik-integration-store'

type RouteContext = {
  params: Promise<{ sourceId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const tenants = await discoverAuvikInventoryTenants(sourceId)
    return NextResponse.json({
      data: tenants.map((tenant) => ({
        id: tenant.id,
        domainPrefix: tenant.attributes.domainPrefix,
        tenantType: tenant.attributes.tenantType,
      })),
    })
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: { code: 'ACCESS_DENIED', message: error.message } },
        { status: error.status },
      )
    }
    const message =
      error instanceof Error ? error.message : 'Unable to discover Auvik tenants.'
    return NextResponse.json(
      {
        error: {
          code: 'AUVIK_TENANT_DISCOVERY_FAILED',
          message,
          ...(error instanceof AuvikApiError
            ? { providerStatus: error.status, retryable: error.retryable }
            : {}),
        },
      },
      { status: message.includes('not found') ? 404 : 400 },
    )
  }
}
