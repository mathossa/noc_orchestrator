export type DeviceModelFamilyReference = {
  id: string
  vendorId: string
  name: string
  isActive: boolean
}

export type DeviceModelFamilyRecord = DeviceModelFamilyReference & {
  notes: string | null
  vendor: { id: string; code: string; name: string; isActive: boolean }
  modelCount: number
  createdAt: string
  updatedAt: string
}

export type DeviceModelFamilyDetailRecord = DeviceModelFamilyRecord & {
  models: Array<{
    id: string
    model: string
    platform: string | null
    isActive: boolean
    deviceCount: number
    deviceType: { id: string; code: string; name: string; isActive: boolean }
  }>
}

export type DeviceModelFamilyFieldErrors = Record<string, string>

export class DeviceModelFamilyValidationError extends Error {
  constructor(
    message: string,
    readonly fields: DeviceModelFamilyFieldErrors,
  ) {
    super(message)
    this.name = 'DeviceModelFamilyValidationError'
  }
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned : null
}

export function cleanDeviceModelFamilyName(value: unknown) {
  return optionalText(value) ?? ''
}

export function normalizedDeviceModelFamilyName(value: unknown) {
  return cleanDeviceModelFamilyName(value).toLocaleLowerCase('en-US')
}

export function parseDeviceModelFamilyInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const vendorId = optionalText(body.vendorId) ?? ''
  const name = cleanDeviceModelFamilyName(body.name)
  const notes = optionalText(body.notes)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: DeviceModelFamilyFieldErrors = {}

  if (!vendorId) errors.vendorId = 'Vendor is required.'
  if (!name) errors.name = 'Family / series name is required.'
  else if (name.length > 160) errors.name = 'Family / series name must be 160 characters or fewer.'
  if (notes && notes.length > 4000) errors.notes = 'Notes must be 4000 characters or fewer.'

  if (Object.keys(errors).length > 0) {
    throw new DeviceModelFamilyValidationError('Please correct the highlighted fields.', errors)
  }

  return { vendorId, name, notes, isActive }
}
