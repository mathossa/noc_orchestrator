import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cleanAuvikHierarchyLabel, deriveAuvikHierarchyProposal, inferAuvikProposalFromKnownCustomer, inferAuvikSiteFromKnownCustomer, normalizeAuvikNamingPolicy, removeAuvikParentPrefix, suggestAuvikTenantHierarchy, type AuvikHierarchyProposal } from '@/lib/auvik-tenant-matching'
import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'
import { AuvikApiError } from '@/lib/auvik-api-client'
import { discoverAuvikInventoryTenants, getAuvikInventoryConnection } from '@/lib/auvik-integration-store'

type RouteContext = {
  params: Promise<{ sourceId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAdminRequest(request)
    const { sourceId } = await context.params
    const stored = await getAuvikInventoryConnection(sourceId)
    if (!stored) throw new Error('Auvik connection was not found.')
    const rawBody = await request.text()
    const incoming = rawBody ? JSON.parse(rawBody) as { namingPolicy?: unknown } : {}
    const namingPolicy = incoming.namingPolicy && typeof incoming.namingPolicy === 'object' &&
      !Array.isArray(incoming.namingPolicy)
      ? normalizeAuvikNamingPolicy(incoming.namingPolicy as Parameters<typeof normalizeAuvikNamingPolicy>[0])
      : stored.configuration.namingPolicy
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
    // Derive the fallback from explicit, existing Customer context only.
    // The details endpoint occasionally omits a parent link even when
    // displayName is "Customer - Site - Business Unit". Never turn such a
    // leaf into a new Customer based on its own display name.
    const key = (name: string) => cleanAuvikHierarchyLabel(name).toLocaleLowerCase('en-US')
    const savedById = new Map(stored.configuration.tenants.map((scope) => [scope.tenantId, scope]))
    const graph = new Map<string, AuvikHierarchyProposal | null>(tenants.map((tenant) => [
      tenant.id, deriveAuvikHierarchyProposal(tenant, tenants, namingPolicy),
    ] as const))
    const knownNames = [
      ...customers.map((item) => item.name),
      ...stored.configuration.tenants.map((scope) => scope.customer?.trim() ?? ''),
      ...[...graph.values()].map((proposal) => proposal?.customer ?? ''),
      ...[...reusable.values()].map((mapping) => mapping?.customer ?? ''),
    ].filter(Boolean)
    const customerNames = [...new Map(knownNames.map((name) => [key(name), name])).values()]
    const unitCache = new Map<string, string[]>()
    const unitsFor = (customerName: string): string[] => {
      const label = key(customerName)
      const cached = unitCache.get(label)
      if (cached) return cached
      const existingUnits = customers.filter((customer) => key(customer.name) === label)
        .flatMap((customer) => customer.organizationUnits.filter((unit) => unit.isActive).map((unit) => unit.name))
      const savedUnits = stored.configuration.tenants
        .filter((scope) => key(scope.customer ?? '') === label)
        .map((scope) => scope.businessUnit ?? '')
      const proposedUnits = [...graph.values()]
        .filter((proposal) => proposal && key(proposal.customer) === label)
        .map((proposal) => proposal?.businessUnit ?? '')
      const parentUnits = tenants
        .filter((candidate) => candidate.attributes.tenantType?.toLowerCase().includes('multi'))
        .map((candidate) => {
          const name = candidate.attributes.displayName ?? ''
          const child = removeAuvikParentPrefix(name, customerName)
          return child === cleanAuvikHierarchyLabel(name) ? '' : child
        })
      const units = [...new Set([...existingUnits, ...savedUnits, ...proposedUnits, ...parentUnits]
        .map((unit) => cleanAuvikHierarchyLabel(unit)).filter(Boolean))]
      unitCache.set(label, units)
      return units
    }
    const inferredProposalFor = (tenant: (typeof tenants)[number]): AuvikHierarchyProposal | null => {
      const name = tenant.attributes.displayName ?? tenant.attributes.clientName ?? ''
      if (!name || tenant.attributes.tenantType?.toLowerCase().includes('multi')) return null
      const confirmedCustomer = savedById.get(tenant.id)?.customer?.trim() ||
        reusable.get(tenant.id)?.customer?.trim()
      const candidates = confirmedCustomer
        ? [confirmedCustomer]
        : customerNames.filter((customerName) =>
          inferAuvikSiteFromKnownCustomer(name, customerName, namingPolicy) !== null)
      // Do not arbitrarily choose among multiple matching Customer names.
      if (candidates.length !== 1) return null
      const customerName = candidates[0]
      const parts = inferAuvikProposalFromKnownCustomer(name, customerName, unitsFor(customerName), namingPolicy)
      return parts ? { ...parts, parentTenantId: tenant.relationships?.parent?.data?.id ?? null } : null
    }
    return NextResponse.json({
      data: tenants.map((tenant) => {
        const parentProposal = graph.get(tenant.id) ?? null
        const fallback = inferredProposalFor(tenant)
        const proposal = parentProposal && fallback && key(parentProposal.customer) === key(fallback.customer)
          ? {
              ...parentProposal,
              businessUnit: parentProposal.businessUnit ?? fallback.businessUnit,
              // A source leaf label can append the known BU even when the
              // parent chain contains only Customer + Site.
              site: parentProposal.businessUnit ? parentProposal.site : fallback.site,
            }
          : parentProposal ?? fallback
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
