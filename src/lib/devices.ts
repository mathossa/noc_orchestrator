import type { AuditEventRecord } from '@/lib/audit-events'
import type { TechnicalFirmwareState } from '@/lib/firmware-state'

export type DeviceSource = 'MANUAL' | 'API' | 'IMPORT'

export type DeviceReference = {
  id: string
  code: string | null
  name: string
  isActive: boolean
}

export type DeviceContractReference = {
  id: string
  code: string
  name: string
  firmwareManagementEnabled: boolean
  isActive: boolean
}

export type DeviceModelReference = {
  id: string
  model: string
  platform: string | null
  supportedPlatforms: Array<{ id: string; platform: string }>
  isActive: boolean
  vendor: { id: string; code: string; name: string; isActive: boolean }
  deviceType: { id: string; code: string; name: string; isActive: boolean }
}

export type DeviceFirmwareReference = {
  id: string
  vendorId: string
  platform: string
  version: string
  status: string
  isActive: boolean
  firmwareTrain: { id: string; name: string } | null
}

export type DeviceLifecycleRecord = {
  id: string
  state: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
  reason: string | null
  notes: string | null
  plannedFor: string | null
  reviewAt: string | null
  decidedAt: string
  completedAt: string | null
  decidedBy: { id: string; name: string; email: string } | null
  targetFirmwareRelease: { id: string; version: string; platform: string }
}

export type DeviceRecord = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  platform: string | null
  name: string
  hostname: string | null
  serialNumber: string | null
  managementAddress: string | null
  notes: string | null
  currentFirmwareReleaseId: string | null
  currentFirmwareObservedAt: string | null
  currentFirmwareAgeDays: number | null
  currentFirmwareSource: string
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  customer: {
    id: string
    code: string | null
    name: string
    isActive: boolean
    contractType: DeviceContractReference | null
  }
  site: {
    id: string
    code: string | null
    name: string
    isActive: boolean
    contractType: DeviceContractReference | null
  } | null
  effectiveContractType: DeviceContractReference | null
  contractSource: 'SITE' | 'CUSTOMER' | 'NONE'
  deviceModel: DeviceModelReference
  currentFirmwareRelease: (DeviceFirmwareReference & { releasedAt: string | null }) | null
  lifecycle: DeviceLifecycleRecord | null
}

export type DeviceDetailRecord = DeviceRecord & {
  createdAt: string
  updatedAt: string
  desiredFirmware: { available: true; release: DeviceFirmwareReference | null }
  technicalState: { available: true; state: TechnicalFirmwareState }
  auditHistory: AuditEventRecord[]
}

export type DeviceReferenceData = {
  customers: Array<{
    id: string
    code: string | null
    name: string
    isActive: boolean
    contractType: DeviceContractReference | null
  }>
  sites: Array<{
    id: string
    customerId: string
    code: string | null
    name: string
    isActive: boolean
    contractType: DeviceContractReference | null
  }>
  models: DeviceModelReference[]
  firmwareReleases: DeviceFirmwareReference[]
}

export type DeviceFieldErrors = Record<string, string>

export class DeviceValidationError extends Error {
  constructor(
    message: string,
    readonly fields: DeviceFieldErrors,
  ) {
    super(message)
    this.name = 'DeviceValidationError'
  }
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned : null
}

function multilineText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.normalize('NFKC').trim()
  return cleaned.length > 0 ? cleaned : null
}

function requiredId(value: unknown) {
  return optionalText(value) ?? ''
}

function optionalDate(value: unknown, field: string, errors: DeviceFieldErrors) {
  const cleaned = optionalText(value)
  if (!cleaned) return null
  const parsed = new Date(cleaned)
  if (Number.isNaN(parsed.getTime())) {
    errors[field] = 'Enter a valid date and time.'
    return null
  }
  return parsed
}

export function cleanDeviceName(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedDeviceName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function normalizedPlatform(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function parseDeviceInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const errors: DeviceFieldErrors = {}

  const customerId = requiredId(body.customerId)
  const siteId = optionalText(body.siteId)
  const deviceModelId = requiredId(body.deviceModelId)
  const platform = optionalText(body.platform)
  const name = cleanDeviceName(body.name)
  const hostname = optionalText(body.hostname)
  const serialNumber = optionalText(body.serialNumber)
  const managementAddress = optionalText(body.managementAddress)
  const notes = multilineText(body.notes)
  const currentFirmwareReleaseId = optionalText(body.currentFirmwareReleaseId)
  const currentFirmwareSource = optionalText(body.currentFirmwareSource)?.toUpperCase() ?? 'MANUAL'
  const currentFirmwareObservedAt = currentFirmwareReleaseId
    ? optionalDate(body.currentFirmwareObservedAt, 'currentFirmwareObservedAt', errors)
    : null
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true

  if (!customerId) errors.customerId = 'Customer is required.'
  if (!deviceModelId) errors.deviceModelId = 'Device model is required.'
  if (platform && platform.length > 160) errors.platform = 'Platform must be 160 characters or fewer.'
  if (!name) errors.name = 'Device name is required.'
  else if (name.length > 160) errors.name = 'Device name must be 160 characters or fewer.'

  if (hostname && hostname.length > 253) errors.hostname = 'Hostname must be 253 characters or fewer.'
  if (serialNumber && serialNumber.length > 255) errors.serialNumber = 'Serial number must be 255 characters or fewer.'
  if (managementAddress && managementAddress.length > 255) {
    errors.managementAddress = 'Management address must be 255 characters or fewer.'
  }
  if (notes && notes.length > 5000) errors.notes = 'Notes must be 5000 characters or fewer.'

  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) errors.source = 'Choose MANUAL, API, or IMPORT.'
  if (!['MANUAL', 'API', 'IMPORT'].includes(currentFirmwareSource)) {
    errors.currentFirmwareSource = 'Choose MANUAL, API, or IMPORT.'
  }

  if (externalProvider && externalProvider.length > 120) {
    errors.externalProvider = 'External provider must be 120 characters or fewer.'
  }
  if (externalId && externalId.length > 255) errors.externalId = 'External ID must be 255 characters or fewer.'

  if (Object.keys(errors).length > 0) {
    throw new DeviceValidationError('Please correct the highlighted fields.', errors)
  }

  return {
    customerId,
    siteId,
    deviceModelId,
    platform,
    name,
    hostname,
    serialNumber,
    managementAddress,
    notes,
    currentFirmwareReleaseId,
    currentFirmwareObservedAt,
    currentFirmwareSource,
    source,
    externalProvider,
    externalId,
    isActive,
  }
}
