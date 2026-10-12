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
export function suggestAuvikTenantHierarchy(
  tenant: AuvikTenantResource,
  customers: readonly AuvikCanonicalCustomer[],
): AuvikTenantSuggestion | null {
  const attributes = tenant.attributes
  const customerName = attributes.clientName ?? attributes.name ??
    attributes.tenantName ?? attributes.displayName
  if (!customerName?.trim()) return null

  const matches = customers.filter((customer) => matchKey(customer.name) === matchKey(customerName))
  if (matches.length !== 1) return null
  const customer = matches[0]
  const siteName = attributes.siteName
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
