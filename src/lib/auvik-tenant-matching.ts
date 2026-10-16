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

export type AuvikNamingRule = {
  id: string
  enabled: boolean
  field: 'customer' | 'businessUnit' | 'site'
  match: 'EXACT' | 'PREFIX'
  find: string
  replace: string
}

export type AuvikNamingPolicy = {
  stripAccountNumbers: boolean
  stripRepeatedParents: boolean
  rules: readonly AuvikNamingRule[]
}

export const DEFAULT_AUVIK_NAMING_POLICY: AuvikNamingPolicy = {
  stripAccountNumbers: true,
  stripRepeatedParents: true,
  rules: [],
}

export function normalizeAuvikNamingPolicy(value: Partial<AuvikNamingPolicy> | null | undefined): AuvikNamingPolicy {
  const rules = value?.rules ?? []
  if (!Array.isArray(rules) || rules.length > 50) throw new Error('Auvik naming rules must contain 50 or fewer items.')
  const ids = new Set<string>()
  const normalized = rules.map((rule) => {
    if (typeof rule.id !== 'string' || rule.id.length > 100 || ids.has(rule.id) ||
      !['customer', 'businessUnit', 'site'].includes(rule.field) ||
      !['EXACT', 'PREFIX'].includes(rule.match) ||
      typeof rule.find !== 'string' || typeof rule.replace !== 'string' ||
      rule.find.length > 120 || rule.replace.length > 120 ||
      (rule.enabled === true && !rule.find.trim())) throw new Error('Auvik naming rule is invalid.')
    ids.add(rule.id)
    return { id: rule.id, enabled: rule.enabled === true, field: rule.field, match: rule.match,
      find: rule.find.trim(), replace: rule.replace.trim() }
  })
  return {
    stripAccountNumbers: value?.stripAccountNumbers !== false,
    stripRepeatedParents: value?.stripRepeatedParents !== false,
    rules: normalized,
  }
}

function applyAuvikOverride(field: AuvikNamingRule['field'], input: string, policy: AuvikNamingPolicy) {
  let output = input
  for (const rule of policy.rules) {
    if (!rule.enabled || rule.field !== field) continue
    const original = output.toLocaleLowerCase('en-US')
    const find = rule.find.toLocaleLowerCase('en-US')
    if (rule.match === 'EXACT' && original === find) output = rule.replace
    else if (rule.match === 'PREFIX' && original.startsWith(find) &&
      (original.length === find.length || /[\s\-_/]/u.test(output.charAt(find.length)))) {
      output = rule.replace + output.slice(rule.find.length)
    }
  }
  return output.trim()
}

function cleanAuvikNameWithPolicy(value: string, policy: AuvikNamingPolicy) {
  const text = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return policy.stripAccountNumbers ? cleanAuvikHierarchyLabel(text) : text
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

/**
 * Drop a suffix only when it is a separately verified Business Unit,
 * separated from the site by " - ". Never trim arbitrary last segments.
 */
export function removeAuvikKnownUnitSuffix(label: string, unit: string) {
  const suffix = ' - ' + cleanAuvikHierarchyLabel(unit)
  if (!unit.trim() || !label.toLocaleLowerCase('en-US').endsWith(suffix.toLocaleLowerCase('en-US'))) {
    return label
  }
  const remaining = label.slice(0, -suffix.length).trim()
  return remaining || label
}

/** Exact Customer prefix in an Auvik leaf name, not an inferred tenant identity. */
export function inferAuvikSiteFromKnownCustomer(
  displayName: string,
  customerName: string,
  policy: AuvikNamingPolicy = DEFAULT_AUVIK_NAMING_POLICY,
): string | null {
  if (!policy.stripRepeatedParents || !displayName.trim() || !customerName.trim()) return null
  const label = cleanAuvikNameWithPolicy(displayName, policy)
  const site = removeAuvikParentPrefix(label, customerName)
  return site !== label && site.trim() ? site.trim() : null
}

export function inferAuvikProposalFromKnownCustomer(
  displayName: string,
  customerName: string,
  knownUnits: readonly string[],
  policy: AuvikNamingPolicy = DEFAULT_AUVIK_NAMING_POLICY,
): { customer: string; businessUnit: string | null; site: string } | null {
  const leaf = inferAuvikSiteFromKnownCustomer(displayName, customerName, policy)
  if (!leaf) return null
  const candidates = [...new Set(knownUnits
    .map((unit) => removeAuvikParentPrefix(cleanAuvikHierarchyLabel(unit), customerName))
    .filter(Boolean))]
    .map((unit) => ({ unit, site: removeAuvikKnownUnitSuffix(leaf, unit) }))
    .filter((result) => result.site !== leaf)
  // Multiple different units matching a suffix would be ambiguous.
  if (candidates.length > 1) return null
  const unit = candidates[0]?.unit ?? null
  const site = applyAuvikOverride('site', candidates[0]?.site ?? leaf, policy)
  const customer = applyAuvikOverride('customer', cleanAuvikNameWithPolicy(customerName, policy), policy)
  return customer && site ? { customer, businessUnit: unit, site } : null
}

/**
 * Refresh legacy auto-generated labels only when they still match the old
 * Auvik raw name or the former Customer-only normalization. Do not rewrite
 * unrelated, manually corrected canonical site names.
 */
export function upgradeLegacyAuvikSiteLabel(
  savedSite: string,
  rawSourceName: string,
  customer: string,
  candidateSite: string,
  businessUnit: string | null,
  policy: AuvikNamingPolicy = DEFAULT_AUVIK_NAMING_POLICY,
) {
  if (!savedSite.trim()) return candidateSite
  if (!candidateSite.trim() || !policy.stripRepeatedParents) return savedSite
  const cleanedRaw = cleanAuvikNameWithPolicy(rawSourceName, policy)
  const oldCustomerStripped = removeAuvikParentPrefix(cleanedRaw, customer)
  const withKnownUnit = businessUnit
    ? removeAuvikKnownUnitSuffix(oldCustomerStripped, businessUnit) : oldCustomerStripped
  if (matchKey(withKnownUnit) !== matchKey(candidateSite)) return savedSite
  return [cleanedRaw, oldCustomerStripped].some((oldAutoLabel) =>
    matchKey(oldAutoLabel) === matchKey(savedSite))
    ? candidateSite : savedSite
}

export function normalizeAuvikHierarchyNames(
  names: readonly string[],
  policy: AuvikNamingPolicy = DEFAULT_AUVIK_NAMING_POLICY,
) {
  if (names.length === 0) return null
  // Structural prefix removal uses the original Auvik parent label, not a
  // potentially renamed canonical customer override.
  const sourceCustomer = cleanAuvikNameWithPolicy(names[0], policy)
  const customer = applyAuvikOverride('customer', sourceCustomer, policy)
  if (!customer) return null
  const intermediates = names.slice(1, -1)
  const normalizedUnits: string[] = []
  for (const unit of intermediates) {
    let normalized = cleanAuvikNameWithPolicy(unit, policy)
    if (policy.stripRepeatedParents) {
      normalized = removeAuvikParentPrefix(normalized, sourceCustomer)
      for (const parent of normalizedUnits) normalized = removeAuvikParentPrefix(normalized, parent)
    }
    normalized = applyAuvikOverride('businessUnit', normalized, policy)
    if (normalized && matchKey(normalized) !== matchKey(customer) &&
      !normalizedUnits.some((previous) => matchKey(previous) === matchKey(normalized))) {
      normalizedUnits.push(normalized)
    }
  }
  let site = cleanAuvikNameWithPolicy(names[names.length - 1], policy)
  if (policy.stripRepeatedParents) {
    site = removeAuvikParentPrefix(site, sourceCustomer)
    for (const unit of normalizedUnits) site = removeAuvikParentPrefix(site, unit)
    // Auvik also uses "Customer - Site - Business Unit" for leaf labels.
    // The known intermediate parent is the only evidence required to remove
    // that suffix; don't remove trailing segments without an actual unit.
    for (const unit of [...normalizedUnits].sort((a, b) => b.length - a.length)) {
      site = removeAuvikKnownUnitSuffix(site, unit)
    }
  }
  site = applyAuvikOverride('site', site, policy)
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
  policy: AuvikNamingPolicy = DEFAULT_AUVIK_NAMING_POLICY,
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
  if (names.some((name) => !name) || chain.length < 2) return null
  // A leaf with no known parent is NOT its own Customer.
  // With two levels, only treat the parent as a Customer when the leaf
  // explicitly repeats that Customer prefix; a generic MSP root doesn't
  // establish ownership. In a complete MSP -> Customer -> Site chain,
  // discard the MSP root.
  if (chain.length === 2 && !inferAuvikSiteFromKnownCustomer(
    names[1], names[0], DEFAULT_AUVIK_NAMING_POLICY,
  )) return null
  // Some API responses start at the Customer instead of the MSP root.
  // If the next node is explicitly named "Customer - Business Unit",
  // keep that first Customer; otherwise discard the actual MSP root.
  const startsAtCustomer = chain.length >= 3 &&
    inferAuvikSiteFromKnownCustomer(names[1], names[0], DEFAULT_AUVIK_NAMING_POLICY) !== null
  const withoutRoot = chain.length >= 3 && !startsAtCustomer ? names.slice(1) : names
  const normalized = normalizeAuvikHierarchyNames(withoutRoot, policy)
  if (!normalized?.customer || !normalized.site) return null
  return {
    ...normalized,
    parentTenantId: tenant.relationships?.parent?.data?.id ?? null,
  }
}

/**
 * An exact Customer match is not an existing Site match. In particular the
 * CUSTOMER-only suggestion has site:null, which previously shadowed a
 * complete Auvik proposal and left new sites permanently "Not mapped".
 */
export function chooseAuvikMappingSuggestion(
  suggestion: { customer: string; businessUnit: string | null; site: string | null; status: 'CUSTOMER' | 'CUSTOMER_AND_SITE' | 'REUSED' } | null,
  proposal: AuvikHierarchyProposal | null,
): { customer: string; businessUnit: string | null; site: string | null } | null {
  if (!suggestion) return proposal
  if (suggestion.site || !proposal) return suggestion
  // An incomplete mapping reused from a different Auvik connection must
  // not shadow the missing Site either; only supplement matching hierarchies.
  if (matchKey(suggestion.customer) !== matchKey(proposal.customer) ||
      (suggestion.businessUnit && proposal.businessUnit &&
        matchKey(suggestion.businessUnit) !== matchKey(proposal.businessUnit))) {
    return suggestion
  }
  return { ...proposal, customer: suggestion.customer,
    businessUnit: suggestion.businessUnit ?? proposal.businessUnit }
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
    const unit = customer.organizationUnits.find(
      (candidate) => candidate.isActive && candidate.id === site.organizationUnitId,
    )
    const labels = unit
      ? [customer.name, unit.name, site.name]
      : [customer.name, site.name]
    const canonicalName = normalizeAuvikHierarchyNames(labels)?.site
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
