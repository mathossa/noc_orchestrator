import type {
  DeviceFirmwareReference,
  DeviceModelReference,
  DeviceRecord,
} from '@/lib/devices'

export type DeviceFormState = {
  customerId: string
  siteId: string
  deviceModelId: string
  name: string
  hostname: string
  serialNumber: string
  managementAddress: string
  notes: string
  currentFirmwareReleaseId: string
  currentFirmwareObservedAt: string
  currentFirmwareSource: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

export function emptyDeviceForm(customerId = '', siteId = ''): DeviceFormState {
  return {
    customerId,
    siteId,
    deviceModelId: '',
    name: '',
    hostname: '',
    serialNumber: '',
    managementAddress: '',
    notes: '',
    currentFirmwareReleaseId: '',
    currentFirmwareObservedAt: '',
    currentFirmwareSource: 'MANUAL',
    source: 'MANUAL',
    externalProvider: '',
    externalId: '',
    isActive: true,
  }
}

function normalizePlatform(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function deviceReleaseMatchesModel(
  release: DeviceFirmwareReference,
  model: DeviceModelReference | undefined,
) {
  if (!model || release.vendorId !== model.vendor.id) return false
  if (model.supportedPlatforms.length === 0) return true
  const releasePlatform = normalizePlatform(release.platform)
  return model.supportedPlatforms.some(
    (platform) => normalizePlatform(platform) === releasePlatform,
  )
}

export function toLocalDeviceDateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function deviceFormForRecord(record: DeviceRecord): DeviceFormState {
  return {
    customerId: record.customerId,
    siteId: record.siteId ?? '',
    deviceModelId: record.deviceModelId,
    name: record.name,
    hostname: record.hostname ?? '',
    serialNumber: record.serialNumber ?? '',
    managementAddress: record.managementAddress ?? '',
    notes: record.notes ?? '',
    currentFirmwareReleaseId: record.currentFirmwareReleaseId ?? '',
    currentFirmwareObservedAt: toLocalDeviceDateTimeInput(
      record.currentFirmwareObservedAt,
    ),
    currentFirmwareSource: record.currentFirmwareSource,
    source: record.source,
    externalProvider: record.externalProvider ?? '',
    externalId: record.externalId ?? '',
    isActive: record.isActive,
  }
}
