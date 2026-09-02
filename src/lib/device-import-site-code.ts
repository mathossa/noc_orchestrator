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

/**
 * When an upstream system uses a generic Site value, the raw organization
 * string often still contains the actual location after the canonical Customer
 * name. This only proposes that suffix for review; it is never silently saved.
 */
export function suggestedImportSiteName(
  siteSourceValue: string,
  customerSourceValue: string | null | undefined,
  canonicalCustomerName: string,
) {
  const site = clean(siteSourceValue)
  const rawCustomer = clean(customerSourceValue)
  const customer = clean(canonicalCustomerName)
  if (!site || !rawCustomer || !customer || !GENERIC_SITE_VALUES.has(normalized(site))) return site

  const rawNormalized = normalized(rawCustomer)
  const customerNormalized = normalized(customer)
  if (!rawNormalized.startsWith(customerNormalized)) return site
  const remainder = rawCustomer.slice(customer.length).replace(/^[\s._/|:;>-]+/, '').trim()
  return remainder || site
}

export function importSiteProfileContext(customerTargetId: string, customerSourceValue: string | null | undefined) {
  const rawCustomer = normalized(customerSourceValue)
  return rawCustomer ? `${customerTargetId}|raw:${rawCustomer}` : customerTargetId
}
