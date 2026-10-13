import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deriveAuvikHierarchyProposal, suggestAuvikTenantHierarchy } from '@/lib/auvik-tenant-matching'
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
    const customers = await prisma.customer.findMany({
      where: { isActive: true },
      select: {
        name: true,
        organizationUnits: {
          select: { id: true, name: true, isActive: true },
        },
        sites: {
          select: { name: true, isActive: true, organizationUnitId: true },
        },
      },
    })
    // Auvik tenant identity is global within a provider, not connection-local.
    // Reuse an exact tenant scope confirmed on another Auvik connection.
    const connections = await prisma.inventorySource.findMany({
      where: { provider: 'AUVIK', adapterType: 'auvik-api-v2', id: { not: sourceId } },
      select: { configuration: true },
    })
    type Mapping = { customer: string; businessUnit: string | null; site: string | null }
    const reusable = new Map<string, Mapping | null>()
    for (const source of connections) {
      const config = source.configuration as { tenants?: unknown } | null
      if (!Array.isArray(config?.tenants)) continue
      for (const candidate of config.tenants) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
        const item = candidate as Record<string, unknown>
        if (typeof item.tenantId !== 'string' || typeof item.customer !== 'string' || !item.customer.trim()) continue
        const target: Mapping = {
          customer: item.customer.trim(),
          businessUnit: typeof item.businessUnit === 'string' ? item.businessUnit.trim() || null : null,
          site: typeof item.site === 'string' ? item.site.trim() || null : null,
        }
        const prior = reusable.get(item.tenantId)
        // A conflicting persisted mapping must go to review, never choose a winner.
        if (prior === null) continue
        if (prior && JSON.stringify(prior) !== JSON.stringify(target)) reusable.set(item.tenantId, null)
        else reusable.set(item.tenantId, target)
      }
    }
    return NextResponse.json({
      data: tenants.map((tenant) => {
        const proposal = deriveAuvikHierarchyProposal(tenant, tenants)
        const suggestion = suggestAuvikTenantHierarchy(tenant, customers, proposal)
        const crossConnection = reusable.get(tenant.id)
        const hasConflict = reusable.has(tenant.id) && crossConnection === null
        return {
          id: tenant.id,
          domainPrefix: tenant.attributes.domainPrefix,
          tenantType: tenant.attributes.tenantType,
          displayName: tenant.attributes.displayName ?? tenant.attributes.clientName ?? tenant.attributes.name ??
            tenant.attributes.tenantName ?? null,
          siteName: tenant.attributes.siteName ?? proposal?.site ?? null,
          parentTenantId: proposal?.parentTenantId ?? tenant.relationships?.parent?.data?.id ?? null,
          proposal: !hasConflict ? proposal : null,
          suggestion: hasConflict ? null : crossConnection
            ? { ...crossConnection, status: 'REUSED' }
            : suggestion,
          mappingStatus: hasConflict ? 'CONFLICT' : crossConnection ? 'REUSED'
            : suggestion?.status === 'CUSTOMER_AND_SITE' ? 'MATCHED'
            : proposal ? 'PROPOSED' : 'REVIEW',
        }
      }),
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
