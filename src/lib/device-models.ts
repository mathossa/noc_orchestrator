export type DeviceModelSource = 'MANUAL' | 'API' | 'IMPORT'

export type DeviceModelReference = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export type DeviceModelRecord = {
  id: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string | null
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  vendor: DeviceModelReference
  deviceType: DeviceModelReference
  deviceCount: number
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
  desiredFirmware: {
    available: false
    release: null
  }
  availableFirmware: {
    available: true
    releases: Array<{
      id: string
      version: string
      platform: string
      status: string
      isActive: boolean
      releasedAt: string | null
    }>
  }
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
  const model = cleanDeviceModelName(body.model)
  const platform = optionalText(body.platform)
  const notes = optionalText(body.notes)
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: DeviceModelFieldErrors = {}

  if (!vendorId) errors.vendorId = 'Vendor is required.'
  if (!deviceTypeId) errors.deviceTypeId = 'Device type is required.'

  if (!model) errors.model = 'Model name is required.'
  else if (model.length > 160) errors.model = 'Model name must be 160 characters or fewer.'

  if (platform && platform.length > 160) errors.platform = 'Platform must be 160 characters or fewer.'
  if (notes && notes.length > 4000) errors.notes = 'Notes must be 4000 characters or fewer.'

  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) {
    errors.source = 'Choose MANUAL, API, or IMPORT.'
  }

  if (externalProvider && externalProvider.length > 120) {
    errors.externalProvider = 'External provider must be 120 characters or fewer.'
  }

  if (externalId && externalId.length > 255) {
    errors.externalId = 'External ID must be 255 characters or fewer.'
  }

  if (Object.keys(errors).length > 0) {
    throw new DeviceModelValidationError('Please correct the highlighted fields.', errors)
  }

  return {
    vendorId,
    deviceTypeId,
    model,
    platform,
    notes,
    isActive,
    source,
    externalProvider,
    externalId,
  }
}
