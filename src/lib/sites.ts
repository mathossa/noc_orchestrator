export type SiteSource = 'MANUAL' | 'API' | 'IMPORT'

export type SiteRecord = {
  id: string
  customerId: string
  customer: { id: string; code: string | null; name: string; isActive: boolean }
  name: string
  code: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  country: string | null
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  deviceCount: number
}

export type SiteDetailRecord = SiteRecord & {
  createdAt: string
  updatedAt: string
}

export type SiteFieldErrors = Record<string, string>

export class SiteValidationError extends Error {
  constructor(
    message: string,
    readonly fields: SiteFieldErrors,
  ) {
    super(message)
    this.name = 'SiteValidationError'
  }
}

function optionalText(value: unknown, collapseWhitespace = true) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim()
  const cleaned = collapseWhitespace ? normalized.replace(/\s+/g, ' ') : normalized
  return cleaned.length > 0 ? cleaned : null
}

export function cleanSiteName(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedSiteName(value: unknown) {
  return cleanSiteName(value).toLocaleLowerCase('en-US')
}

export function cleanSiteCode(value: unknown) {
  const cleaned = optionalText(value)
  if (!cleaned) return null
  return cleaned.toUpperCase().replace(/[\s_]+/g, '-')
}

export function parseSiteInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const name = cleanSiteName(body.name)
  const code = cleanSiteCode(body.code)
  const addressLine1 = optionalText(body.addressLine1)
  const addressLine2 = optionalText(body.addressLine2)
  const postalCode = optionalText(body.postalCode)
  const city = optionalText(body.city)
  const region = optionalText(body.region)
  const country = optionalText(body.country)
  const notes = optionalText(body.notes, false)
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId, false)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: SiteFieldErrors = {}

  if (!name) errors.name = 'Site name is required.'
  else if (name.length > 160) errors.name = 'Site name must be 160 characters or fewer.'

  if (code && !/^[A-Z0-9][A-Z0-9.-]*$/.test(code)) {
    errors.code = 'Use letters, numbers, dots, or hyphens only.'
  }

  const limitedFields: Array<[string, string | null, number]> = [
    ['addressLine1', addressLine1, 255],
    ['addressLine2', addressLine2, 255],
    ['postalCode', postalCode, 40],
    ['city', city, 120],
    ['region', region, 120],
    ['country', country, 120],
  ]
  for (const [field, value, max] of limitedFields) {
    if (value && value.length > max) errors[field] = `Must be ${max} characters or fewer.`
  }

  if (notes && notes.length > 4000) errors.notes = 'Notes must be 4000 characters or fewer.'
  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) errors.source = 'Choose MANUAL, API, or IMPORT.'
  if (externalProvider && externalProvider.length > 120) errors.externalProvider = 'External provider must be 120 characters or fewer.'
  if (externalId && externalId.length > 255) errors.externalId = 'External ID must be 255 characters or fewer.'

  if (Object.keys(errors).length > 0) throw new SiteValidationError('Please correct the highlighted fields.', errors)

  return {
    name,
    code,
    addressLine1,
    addressLine2,
    postalCode,
    city,
    region,
    country,
    notes,
    isActive,
    source,
    externalProvider,
    externalId,
  }
}
