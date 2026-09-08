import type { AuditEventRecord } from '@/lib/audit-events'
import type { DeviceModelFamilyReference } from '@/lib/model-families'
import type { FirmwarePolicyMode } from '@/lib/firmware-policies'

export type DeviceModelSource = 'MANUAL' | 'API' | 'IMPORT'

export type DeviceModelReference = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export type DeviceModelFirmwareReference = {
  id: string
  vendorId: string
  version: string
  logicalVersion: string
  variant: string | null
  imageCode: string | null
  platform: string
  catalogState: string
  policyEligibility: string
  variantEquivalence: string
  status: string
  isActive: boolean
  releasedAt: string | null
  firmwareTrain: { id: string; name: string } | null
}

export type DeviceModelRecord = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId: string | null
  model: string
  /** The model's explicit broad firmware-platform compatibility selection. */
  supportedPlatforms: string[]
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  vendor: DeviceModelReference
  deviceType: DeviceModelReference
  family: DeviceModelFamilyReference | null
  deviceCount: number
  desiredFirmwareRelease: DeviceModelFirmwareReference | null
}

export type DeviceModelDetailRecord = DeviceModelRecord & {
  createdAt: string
  updatedAt: string
  customers: Array<{ id: string; name: string; deviceCount: number }>
  firmwareDistribution: Array<{
    firmwareReleaseId: string | null
    version: string
    platform: string | null
    deviceCount: number
  }>
  workflowCounts: {
    planned: number
    ignored: number
    customerDeclined: number
    done: number
    undecided: number
  }
  technicalStateCounts: {
    current: number
    actionRequired: number
    unknown: number
    noPolicy: number
  }
  desiredFirmware: {
    available: true
    policyId: string | null
    policyMode: FirmwarePolicyMode | null
    trackKey: string | null
    desiredPlatform: string | null
    release: DeviceModelFirmwareReference | null
  }
  availableFirmware: {
    available: true
    releases: Array<DeviceModelFirmwareReference & { selectable: boolean }>
  }
  auditHistory: AuditEventRecord[]
}

export type DeviceModelFieldErrors = Record<string, string>

export class DeviceModelValidationError extends Error {
  constructor(
    message: string,
    readonly fields: DeviceModelFieldErrors,
  ) {
    super(message)
    this.name = 'DeviceModelValidationError'
  }
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned : null
}

function parseSupportedPlatforms(value: unknown, errors: DeviceModelFieldErrors) {
  if (!Array.isArray(value)) {
    errors.supportedPlatforms = 'Supported platforms must be a list.'
    return []
  }
  const platforms = new Map<string, string>()
  for (const raw of value) {
    const platform = optionalText(raw)
    if (!platform) continue
    if (platform.length > 160) {
      errors.supportedPlatforms = 'Each supported platform must be 160 characters or fewer.'
      continue
    }
    platforms.set(platform.toLocaleLowerCase('en-US'), platform)
  }
  return [...platforms.values()]
}

function parseLegacyPlatformStorage(value: unknown, errors: DeviceModelFieldErrors) {
  if (typeof value !== 'string') return null
  const raw = value.normalize('NFKC').trim()
  if (!raw) return []
  return parseSupportedPlatforms(raw.split(',').map((part) => part.trim()), errors)
}

export function cleanDeviceModelName(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedDeviceModelName(value: unknown) {
  return cleanDeviceModelName(value).toLocaleLowerCase('en-US')
}

export function parseDeviceModelInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const vendorId = optionalText(body.vendorId) ?? ''
  const deviceTypeId = optionalText(body.deviceTypeId) ?? ''
  const familyId = optionalText(body.familyId)
  const model = cleanDeviceModelName(body.model)
  const notes = optionalText(body.notes)
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: DeviceModelFieldErrors = {}
  const hasSupportedPlatforms = Object.prototype.hasOwnProperty.call(body, 'supportedPlatforms')
  const hasLegacyPlatformStorage = Object.prototype.hasOwnProperty.call(body, 'platform')
  const supportedPlatforms = hasSupportedPlatforms
    ? parseSupportedPlatforms(body.supportedPlatforms, errors)
    : hasLegacyPlatformStorage
      ? parseLegacyPlatformStorage(body.platform, errors)
      : null

  // DeviceModel.platform remains an internal serialized DB column during the
  // migration. The public model contract exposes supportedPlatforms only.
  const platform = supportedPlatforms ? supportedPlatforms.join(', ') || null : optionalText(body.platform)

  if (!vendorId) errors.vendorId = 'Vendor is required.'
  if (!deviceTypeId) errors.deviceTypeId = 'Device type is required.'

  if (!model) errors.model = 'Model name is required.'
  else if (model.length > 160) errors.model = 'Model name must be 160 characters or fewer.'

  if (platform && platform.length > 160) {
    errors.supportedPlatforms = 'The supported-platform list must be 160 characters or fewer in total.'
  }
  if (notes && notes.length > 4000) errors.notes = 'Notes must be 4000 characters or fewer.'

  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) errors.source = 'Choose MANUAL, API, or IMPORT.'
  if (externalProvider && externalProvider.length > 120) errors.externalProvider = 'External provider must be 120 characters or fewer.'
  if (externalId && externalId.length > 255) errors.externalId = 'External ID must be 255 characters or fewer.'

  if (Object.keys(errors).length > 0) throw new DeviceModelValidationError('Please correct the highlighted fields.', errors)

  return {
    vendorId,
    deviceTypeId,
    familyId,
    model,
    platform,
    supportedPlatforms,
    notes,
    isActive,
    source,
    externalProvider,
    externalId,
  }
}
