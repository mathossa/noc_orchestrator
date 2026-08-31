import type { FirmwareReleaseReference } from '@/lib/firmware-releases'

export type FirmwareTrainRecord = {
  id: string
  vendorId: string
  vendor: FirmwareReleaseReference
  platform: string
  name: string
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  releaseCount: number
}

export type FirmwareTrainDetailRecord = FirmwareTrainRecord & {
  createdAt: string
  updatedAt: string
  releases: Array<{
    id: string
    version: string
    status: string
    isActive: boolean
    releasedAt: string | null
  }>
}

export type FirmwareTrainFieldErrors = Record<string, string>

export class FirmwareTrainValidationError extends Error {
  constructor(
    message: string,
    readonly fields: FirmwareTrainFieldErrors,
  ) {
    super(message)
    this.name = 'FirmwareTrainValidationError'
  }
}

function optionalText(value: unknown, collapseWhitespace = true) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim()
  const cleaned = collapseWhitespace ? normalized.replace(/\s+/g, ' ') : normalized
  return cleaned.length > 0 ? cleaned : null
}

export function cleanFirmwareTrainName(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedFirmwareTrainName(value: unknown) {
  return cleanFirmwareTrainName(value).toLocaleLowerCase('en-US')
}

export function cleanFirmwareTrainPlatform(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedFirmwareTrainPlatform(value: unknown) {
  return cleanFirmwareTrainPlatform(value).toLocaleLowerCase('en-US')
}

export function parseFirmwareTrainInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const vendorId = optionalText(body.vendorId) ?? ''
  const platform = cleanFirmwareTrainPlatform(body.platform)
  const name = cleanFirmwareTrainName(body.name)
  const notes = optionalText(body.notes, false)
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId, false)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: FirmwareTrainFieldErrors = {}

  if (!vendorId) errors.vendorId = 'Vendor is required.'
  if (!platform) errors.platform = 'Platform or firmware family is required.'
  else if (platform.length > 160) errors.platform = 'Platform must be 160 characters or fewer.'

  if (!name) errors.name = 'Train name is required.'
  else if (name.length > 160) errors.name = 'Train name must be 160 characters or fewer.'

  if (notes && notes.length > 4000) errors.notes = 'Notes must be 4000 characters or fewer.'
  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) errors.source = 'Choose MANUAL, API, or IMPORT.'
  if (externalProvider && externalProvider.length > 120) errors.externalProvider = 'External provider must be 120 characters or fewer.'
  if (externalId && externalId.length > 255) errors.externalId = 'External ID must be 255 characters or fewer.'

  if (Object.keys(errors).length > 0) throw new FirmwareTrainValidationError('Please correct the highlighted fields.', errors)

  return {
    vendorId,
    platform,
    name,
    notes,
    isActive,
    source,
    externalProvider,
    externalId,
  }
}
