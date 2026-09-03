const MAX_SITE_CODE_LENGTH = 40

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') ?? ''
}

function normalized(value: string | null | undefined) {
  return clean(value).toLocaleLowerCase('en-US')
}

export function suggestedImportSiteCode(sourceValue: string) {
  const code = sourceValue
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (code || 'SITE').slice(0, MAX_SITE_CODE_LENGTH).replace(/-+$/g, '') || 'SITE'
}

export function nextAvailableImportSiteCode(baseCode: string, usedCodes: Set<string>) {
  if (!usedCodes.has(baseCode)) return baseCode
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `-${suffix}`
    const prefix = baseCode
      .slice(0, Math.max(1, MAX_SITE_CODE_LENGTH - suffixText.length))
      .replace(/-+$/g, '')
    const candidate = `${prefix}${suffixText}`
    if (!usedCodes.has(candidate)) return candidate
  }
  throw new Error(`Could not generate a unique Site code for ${baseCode}.`)
}

const GENERIC_SITE_VALUES = new Set([
  'open internet',
  'internet',
  'default',
  'default site',
  'unknown',
  'n/a',
  'na',
])

export function isGenericImportSiteValue(value: string | null | undefined) {
  return GENERIC_SITE_VALUES.has(normalized(value))
}

/**
 * When an upstream system uses a generic Site value, the combined
 * Organization/Site column can still contain the actual location. This only
 * proposes that suffix for review; it is never silently saved.
 */
export function suggestedImportSiteName(
  siteSourceValue: string,
  organizationSiteSourceValue: string | null | undefined,
  canonicalCustomerName: string,
) {
  const site = clean(siteSourceValue)
  const rawOrganizationSite = clean(organizationSiteSourceValue)
  const customer = clean(canonicalCustomerName)
  if (!site || !rawOrganizationSite || !customer || !isGenericImportSiteValue(site)) return site

  const rawNormalized = normalized(rawOrganizationSite)
  const customerNormalized = normalized(customer)
  if (!rawNormalized.startsWith(customerNormalized)) return site
  const remainder = rawOrganizationSite.slice(customer.length).replace(/^[\s._/|:;>-]+/, '').trim()
  return remainder || site
}

/** Preferred profile context for Site aliases. The raw combined organization /
 * site value keeps generic upstream labels such as “Open internet” distinct.
 */
export function importSiteProfileContext(
  customerTargetId: string,
  organizationSiteSourceValue: string | null | undefined,
) {
  const rawOrganizationSite = normalized(organizationSiteSourceValue)
  return rawOrganizationSite ? `${customerTargetId}|organization-site:${rawOrganizationSite}` : customerTargetId
}

/**
 * Read contexts in safest-first order. Generic Site labels with a raw
 * Organization/Site value deliberately do not fall back to the old
 * Customer-only alias, because that could map multiple physical Sites to one.
 */
export function importSiteProfileContextCandidates(
  customerTargetId: string,
  organizationSiteSourceValue: string | null | undefined,
  siteSourceValue: string | null | undefined,
) {
  const preferred = importSiteProfileContext(customerTargetId, organizationSiteSourceValue)
  if (preferred === customerTargetId || isGenericImportSiteValue(siteSourceValue)) return [preferred]
  return [preferred, customerTargetId]
}
