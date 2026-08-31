export const firmwareReleaseStatuses = [
  'AVAILABLE',
  'TESTING',
  'APPROVED',
  'RECOMMENDED',
  'DEPRECATED',
  'BLOCKED',
] as const

export type FirmwareReleaseStatus = (typeof firmwareReleaseStatuses)[number]
export type FirmwareReleaseSource = 'MANUAL' | 'API' | 'IMPORT'

export type FirmwareReleaseReference = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export type FirmwareReleaseRecord = {
  id: string
  vendorId: string
  vendor: FirmwareReleaseReference
  platform: string
  version: string
  filename: string | null
  sha256: string | null
  fileSizeBytes: string | null
  releaseNotesUrl: string | null
  status: FirmwareReleaseStatus
  notes: string | null
  releasedAt: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
}

export type FirmwareReleaseDetailRecord = FirmwareReleaseRecord & {
  createdAt: string
  updatedAt: string
  matchingModels: Array<{
    id: string
    model: string
    platform: string | null
    deviceType: { id: string; name: string }
    deviceCount: number
  }>
  usage: {
    currentDevices: number
    targetPolicies: number
    lifecycleTargets: number
  }
}

export type FirmwareReleaseFieldErrors = Record<string, string>

export class FirmwareReleaseValidationError extends Error {
  constructor(
    message: string,
    readonly fields: FirmwareReleaseFieldErrors,
  ) {
    super(message)
    this.name = 'FirmwareReleaseValidationError'
  }
}

function optionalText(value: unknown, collapseWhitespace = true) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim()
  const cleaned = collapseWhitespace ? normalized.replace(/\s+/g, ' ') : normalized
  return cleaned.length > 0 ? cleaned : null
}

export function cleanFirmwarePlatform(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedFirmwarePlatform(value: unknown) {
  return cleanFirmwarePlatform(value).toLocaleLowerCase('en-US')
}

export function cleanFirmwareVersion(value: unknown) {
  return optionalText(value, false) ?? ''
}

function parseFileSize(value: unknown, errors: FirmwareReleaseFieldErrors) {
  if (value === null || value === undefined || value === '') return null
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(text)) {
    errors.fileSizeBytes = 'File size must be a non-negative whole number of bytes.'
    return null
  }
  try {
    return BigInt(text)
  } catch {
    errors.fileSizeBytes = 'File size is too large or invalid.'
    return null
  }
}

function parseDate(value: unknown, errors: FirmwareReleaseFieldErrors) {
  const text = optionalText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    errors.releasedAt = 'Release date is invalid.'
    return null
  }
  return parsed
}

function validateHttpUrl(value: string | null, field: string, errors: FirmwareReleaseFieldErrors) {
  if (!value) return
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch {
    errors[field] = 'Use a valid http:// or https:// URL.'
  }
}

export function parseFirmwareReleaseInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const vendorId = optionalText(body.vendorId) ?? ''
  const platform = cleanFirmwarePlatform(body.platform)
  const version = cleanFirmwareVersion(body.version)
  const filename = optionalText(body.filename, false)
  const sha256 = optionalText(body.sha256, false)?.toLowerCase() ?? null
  const releaseNotesUrl = optionalText(body.releaseNotesUrl, false)
  const status = (optionalText(body.status)?.toUpperCase() ?? 'AVAILABLE') as FirmwareReleaseStatus
  const notes = optionalText(body.notes, false)
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId, false)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: FirmwareReleaseFieldErrors = {}
  const fileSizeBytes = parseFileSize(body.fileSizeBytes, errors)
  const releasedAt = parseDate(body.releasedAt, errors)

  if (!vendorId) errors.vendorId = 'Vendor is required.'
  if (!platform) errors.platform = 'Platform or firmware family is required.'
  else if (platform.length > 160) errors.platform = 'Platform must be 160 characters or fewer.'

  if (!version) errors.version = 'Version is required.'
  else if (version.length > 160) errors.version = 'Version must be 160 characters or fewer.'

  if (filename && filename.length > 512) errors.filename = 'Filename must be 512 characters or fewer.'
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) errors.sha256 = 'SHA256 must contain exactly 64 hexadecimal characters.'
  validateHttpUrl(releaseNotesUrl, 'releaseNotesUrl', errors)

  if (!firmwareReleaseStatuses.includes(status)) errors.status = 'Choose a supported firmware catalog status.'
  if (notes && notes.length > 4000) errors.notes = 'Notes must be 4000 characters or fewer.'

  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) errors.source = 'Choose MANUAL, API, or IMPORT.'
  if (externalProvider && externalProvider.length > 120) errors.externalProvider = 'External provider must be 120 characters or fewer.'
  if (externalId && externalId.length > 255) errors.externalId = 'External ID must be 255 characters or fewer.'

  if (Object.keys(errors).length > 0) throw new FirmwareReleaseValidationError('Please correct the highlighted fields.', errors)

  return {
    vendorId,
    platform,
    version,
    filename,
    sha256,
    fileSizeBytes,
    releaseNotesUrl,
    status,
    notes,
    releasedAt,
    isActive,
    source,
    externalProvider,
    externalId,
  }
}
