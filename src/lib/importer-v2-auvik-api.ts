import type {
  InventorySourceAdapter,
  InventorySourceDefinition,
  NormalizedInventorySourceRow,
} from '@/lib/inventory-source-adapter'
import {
  normalizeInventoryProvider,
  normalizedInventorySource,
} from '@/lib/inventory-source-adapter'
import type { AuvikDeviceV2Resource } from '@/lib/auvik-api-client'

export const AUVIK_API_PROVIDER = 'AUVIK'
export const AUVIK_API_V2_ADAPTER_TYPE = 'auvik-api-v2'

export type AuvikImporterV2TenantContext = {
  enabled?: boolean
  tenantId: string
  tenantName?: string | null
  customer?: string | null
  businessUnit?: string | null
  site?: string | null
}

export type AuvikApiTenantInventory = {
  context: AuvikImporterV2TenantContext
  devices: readonly AuvikDeviceV2Resource[]
}

export type AuvikApiAdapterInput = {
  tenants: readonly AuvikApiTenantInventory[]
}

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function firstString(value: unknown) {
  if (!Array.isArray(value)) return null
  for (const candidate of value) {
    const result = clean(candidate)
    if (result) return result
  }
  return null
}

function sourceEvidence(
  resource: AuvikDeviceV2Resource,
  context: AuvikImporterV2TenantContext,
) {
  return {
    provider: AUVIK_API_PROVIDER,
    tenant: {
      id: context.tenantId,
      name: clean(context.tenantName),
    },
    device: {
      id: resource.id,
      type: resource.type,
      attributes: { ...resource.attributes },
      relationships: resource.relationships
        ? structuredClone(resource.relationships)
        : null,
    },
  }
}

export function auvikDeviceV2ToNormalizedInventoryRow(
  resource: AuvikDeviceV2Resource,
  context: AuvikImporterV2TenantContext,
  rowNumber: number,
): NormalizedInventorySourceRow {
  const firmwareVersion = clean(resource.attributes.firmwareVersion)
  const softwareVersion = clean(resource.attributes.softwareVersion)
  const macAddress =
    clean(resource.attributes.macAddress) ??
    firstString(resource.attributes.macAddresses)

  return {
    rowNumber,
    sourceRecordKey: clean(resource.id),
    rawValues: {
      customer: clean(context.customer),
      businessUnit: clean(context.businessUnit),
      site: clean(context.site),
      deviceName: clean(resource.attributes.deviceName),
      hostname: clean(resource.attributes.hostname),
      sourceId: clean(resource.id),
      serialNumber: clean(resource.attributes.serialNumber),
      macAddress,
      vendor: clean(resource.attributes.make),
      model: clean(resource.attributes.model),
      deviceType:
        clean(resource.attributes.deviceTypeDescription) ??
        clean(resource.attributes.deviceType),
      managementAddress: firstString(resource.attributes.ipAddresses),
      currentFirmware: firmwareVersion ?? softwareVersion,
      firmwareVersion,
      softwareVersion,
    },
    sourceEvidence: sourceEvidence(resource, context),
  }
}

function assertAuvikSource(source: InventorySourceDefinition) {
  if (normalizeInventoryProvider(source.provider) !== AUVIK_API_PROVIDER) {
    throw new Error('Auvik API adapter requires provider AUVIK.')
  }
  if (source.adapterType !== AUVIK_API_V2_ADAPTER_TYPE) {
    throw new Error(
      `Auvik API adapter requires adapter type ${AUVIK_API_V2_ADAPTER_TYPE}.`,
    )
  }
}

export const auvikApiV2InventorySourceAdapter: InventorySourceAdapter<AuvikApiAdapterInput> =
  {
    adapterType: AUVIK_API_V2_ADAPTER_TYPE,

    loadAndNormalize({ source, input }) {
      assertAuvikSource(source)
      let rowNumber = 0
      const rows = input.tenants.flatMap((tenant) =>
        tenant.devices.map((device) => {
          rowNumber += 1
          return auvikDeviceV2ToNormalizedInventoryRow(
            device,
            tenant.context,
            rowNumber,
          )
        }),
      )

      return normalizedInventorySource({
        source,
        rows,
        metadata: {
          tenantCount: input.tenants.length,
          deviceCount: rows.length,
        },
      })
    },
  }
