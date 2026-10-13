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

/**
 * Default Auvik naming policy. Source display names remain unchanged;
 * these rules operate ONLY on proposed canonical hierarchy labels.
 * 1. Drop trailing Auvik account number markers such as " - [43541]".
 * 2. Remove a parent customer (or safe legal-suffix alias) from the START
 *    of a child unit/site name when it is separated by " - ".
 * 3. Remove a parent business-unit prefix from its descendant site.
 *
 * No fuzzy matching or substring replacement: "Unica" must never be removed
 * from "Unicat" or from the middle of a location name.
 */
export function cleanAuvikHierarchyLabel(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    .replace(/\s*(?:-\s*)?\[\s*\d+\s*\]\s*$/u, '')
    .trim().replace(/\s+-\s*$/u, '').trim()
}

function hierarchyAliases(value: string) {
  const aliases = new Set<string>()
  const original = cleanAuvikHierarchyLabel(value)
  if (!original) return []
  const add = (name: string) => {
    const normalized = cleanAuvikHierarchyLabel(name)
    if (normalized) aliases.add(normalized)
  }
  add(original)
  const segments = original.split(/\s+-\s+/u)
  if (segments.length > 1) add(segments[0])
  for (const item of [...aliases]) {
    let name = item
    for (let i = 0; i < 5; i += 1) {
      const shortened = name
        .replace(/\s+(?:B\.?V\.?|N\.?V\.?|holding|stichting)$/iu, '')
        .replace(/^Stichting\s+/iu, '')
        .trim()
      if (shortened === name || !shortened) break
      add(shortened)
      name = shortened
    }
  }
  return [...aliases].sort((left, right) => right.length - left.length)
}

export function removeAuvikParentPrefix(label: string, parent: string) {
  const cleaned = cleanAuvikHierarchyLabel(label)
  for (const alias of hierarchyAliases(parent)) {
    const prefix = alias + ' - '
    if (cleaned.toLocaleLowerCase('en-US').startsWith(prefix.toLocaleLowerCase('en-US'))) {
      const remainder = cleaned.slice(prefix.length).trim()
      if (remainder) return remainder
    }
  }
  return cleaned
}

export function normalizeAuvikHierarchyNames(names: readonly string[]) {
  if (names.length === 0) return null
  const customer = cleanAuvikHierarchyLabel(names[0])
  if (!customer) return null
  const intermediates = names.slice(1, -1)
  const normalizedUnits: string[] = []
  for (const unit of intermediates) {
    let normalized = removeAuvikParentPrefix(unit, customer)
    for (const parent of normalizedUnits) {
      normalized = removeAuvikParentPrefix(normalized, parent)
    }
    if (normalized && matchKey(normalized) !== matchKey(customer) &&
      !normalizedUnits.some((previous) => matchKey(previous) === matchKey(normalized))) {
      normalizedUnits.push(normalized)
    }
  }
  let site = cleanAuvikHierarchyLabel(names[names.length - 1])
  site = removeAuvikParentPrefix(site, customer)
  for (const unit of normalizedUnits) site = removeAuvikParentPrefix(site, unit)
  return {
    customer,
    businessUnit: normalizedUnits.length ? normalizedUnits.join(' / ') : null,
    site,
  }
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
  const normalized = normalizeAuvikHierarchyNames(withoutRoot)
  if (!normalized?.customer || !normalized.site) return null
  return {
    ...normalized,
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

  const matchingSites = customer.sites.filter((site) => {
    if (!site.isActive) return false
    const canonicalName = normalizeAuvikHierarchyNames([customer.name, site.name])?.site
    return matchKey(site.name) === matchKey(siteName) ||
      (canonicalName !== undefined && matchKey(canonicalName) === matchKey(siteName))
  })
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
