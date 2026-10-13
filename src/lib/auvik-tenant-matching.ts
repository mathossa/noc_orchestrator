import type { AuvikTenantResource } from '@/lib/auvik-api-client'

export type AuvikCanonicalCustomer = {
  name: string
  organizationUnits: readonly { id: string; name: string; isActive: boolean }[]
  sites: readonly { name: string; isActive: boolean; organizationUnitId: string | null }[]
}

export type AuvikTenantSuggestion = {
  customer: string
  businessUnit: string | null
  site: string | null
  status: 'CUSTOMER' | 'CUSTOMER_AND_SITE'
}

function matchKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

/**
 * Suggest only unambiguous canonical names. Never infer a canonical hierarchy
 * from an opaque Auvik ID or a domain prefix; never create a Customer/Site.
 * The user reviews and saves the suggestion before any inventory is synced.
 */
export type AuvikHierarchyProposal = {
  customer: string
  businessUnit: string | null
  site: string
  parentTenantId: string | null
}

/**
 * Derive one proposed Customer → optional Business Unit → Site from the
 * Auvik parent graph, excluding the topmost MSP grouping. No canonical
 * database objects are created by this routine. All names come from the
 * documented Tenant Details API, never from opaque domain prefixes.
 */
export function deriveAuvikHierarchyProposal(
  tenant: AuvikTenantResource,
  accessible: readonly AuvikTenantResource[],
): AuvikHierarchyProposal | null {
  if (tenant.attributes.tenantType?.toLocaleLowerCase('en-US') === 'multiclient') return null
  const byId = new Map(accessible.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const chain: AuvikTenantResource[] = []
  let current: AuvikTenantResource | undefined = tenant
  while (current) {
    if (seen.has(current.id)) return null
    seen.add(current.id)
    chain.unshift(current)
    const parentId: string | undefined = current.relationships?.parent?.data?.id
    if (!parentId) break
    current = byId.get(parentId)
    // A truncated parent graph cannot safely establish customer ownership.
    if (!current) return null
  }
  const names = chain.map((item) => item.attributes.displayName?.trim() ?? '')
  if (names.some((name) => !name)) return null
  // One site immediately under the main MSP account represents its own
  // customer; intermediate nested multi-sites become an optional unit.
  const withoutRoot = chain.length > 1 ? names.slice(1) : names
  return {
    customer: withoutRoot[0],
    businessUnit: withoutRoot.length > 2 ? withoutRoot.slice(1, -1).join(' / ') : null,
    site: withoutRoot[withoutRoot.length - 1],
    parentTenantId: tenant.relationships?.parent?.data?.id ?? null,
  }
}

export function suggestAuvikTenantHierarchy(
  tenant: AuvikTenantResource,
  customers: readonly AuvikCanonicalCustomer[],
  proposal?: AuvikHierarchyProposal | null,
): AuvikTenantSuggestion | null {
  const attributes = tenant.attributes
  const customerName = proposal?.customer ?? attributes.clientName ?? attributes.name ??
    attributes.tenantName ?? attributes.displayName
  if (!customerName?.trim()) return null

  const matches = customers.filter((customer) => matchKey(customer.name) === matchKey(customerName))
  if (matches.length !== 1) return null
  const customer = matches[0]
  const siteName = proposal?.site ?? attributes.siteName
  if (!siteName?.trim()) {
    return { customer: customer.name, businessUnit: null, site: null, status: 'CUSTOMER' }
  }

  const matchingSites = customer.sites.filter(
    (site) => site.isActive && matchKey(site.name) === matchKey(siteName),
  )
  if (matchingSites.length !== 1) {
    return { customer: customer.name, businessUnit: null, site: null, status: 'CUSTOMER' }
  }
  const site = matchingSites[0]
  const unit = customer.organizationUnits.find(
    (item) => item.id === site.organizationUnitId && item.isActive,
  )
  return {
    customer: customer.name,
    businessUnit: unit?.name ?? null,
    site: site.name,
    status: 'CUSTOMER_AND_SITE',
  }
}
