import type { ImporterV2StagedRow } from '@/lib/importer-v2-evaluator'
import type { AuvikDeviceV2Resource } from '@/lib/auvik-api-client'

export const AUVIK_API_PROVIDER = 'AUVIK'
export const AUVIK_API_V2_SOURCE_ADAPTER_ID = 'auvik-api-v2'

export type AuvikImporterV2TenantContext = {
  customer?: string | null
  businessUnit?: string | null
  site?: string | null
}

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function firstAddress(value: unknown) {
  if (!Array.isArray(value)) return null
  for (const candidate of value) {
    const address = clean(candidate)
    if (address) return address
  }
  return null
}

/**
 * Normalize one Auvik Device API v2 JSON:API resource into the same staging
 * contract used by Importer v2. Canonical matching/publication remains owned by
 * the existing importer; this adapter only translates observed source data.
 *
 * Some inventory attributes are optional because Auvik permissions/device
 * support determine what is present. Missing data remains missing and is never
 * invented by this adapter.
 */
export function auvikDeviceV2ToImporterV2StagedRow(
  resource: AuvikDeviceV2Resource,
  context: AuvikImporterV2TenantContext = {},
): ImporterV2StagedRow {
  const firmwareVersion = clean(resource.attributes.firmwareVersion)
  const softwareVersion = clean(resource.attributes.softwareVersion)

  return {
    rowNumber: 1,
    sourceRecordKey: clean(resource.id),
    rawValues: {
      customer: clean(context.customer),
      businessUnit: clean(context.businessUnit),
      site: clean(context.site),
      deviceName: clean(resource.attributes.deviceName),
      sourceId: clean(resource.id),
      serialNumber: clean(resource.attributes.serialNumber),
      vendor: clean(resource.attributes.make),
      model: clean(resource.attributes.model),
      deviceType:
        clean(resource.attributes.deviceTypeDescription) ??
        clean(resource.attributes.deviceType),
      managementAddress: firstAddress(resource.attributes.ipAddresses),
      currentFirmware: firmwareVersion ?? softwareVersion,
      firmwareVersion,
      softwareVersion,
    },
  }
}

export function auvikDevicesV2ToImporterV2StagedRows(input: {
  devices: readonly AuvikDeviceV2Resource[]
  context?: AuvikImporterV2TenantContext
}) {
  return input.devices.map((device, index) => ({
    ...auvikDeviceV2ToImporterV2StagedRow(device, input.context),
    rowNumber: index + 1,
  }))
}
