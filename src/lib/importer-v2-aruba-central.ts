/**
 * New Central device normalization into the shared Importer v2 boundary.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * The adapter does not resolve canonical identity, stage publication or apply
 * firmware policy. Those are shared Importer v2 responsibilities.
 */
import type {
  InventorySourceAdapter,
  InventorySourceDefinition,
  NormalizedInventorySourceRow,
} from '@/lib/inventory-source-adapter'
import {
  normalizeInventoryProvider,
  normalizedInventorySource,
} from '@/lib/inventory-source-adapter'
import type { ArubaCentralDevice } from '@/lib/aruba-central-api-client'

export const ARUBA_CENTRAL_PROVIDER = 'ARUBA'
export const ARUBA_NEW_CENTRAL_ADAPTER_TYPE = 'aruba-central-new'

export type ArubaNewCentralImportContext = {
  /** Customer mapping is explicit; a Central group is not a customer. */
  customer?: string | null
  businessUnit?: string | null
  /** Allows a confirmed site mapping without mistaking opaque site IDs for names. */
  sitesById?: Readonly<Record<string, string>>
}

export type ArubaNewCentralAdapterInput = {
  devices: readonly ArubaCentralDevice[]
  context?: ArubaNewCentralImportContext
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

function importerDeviceType(value: unknown) {
  switch (clean(value)?.toUpperCase()) {
    case 'ACCESS_POINT':
    case 'AP':
      return 'Access Point'
    case 'SWITCH':
      return 'Switch'
    case 'GATEWAY':
      // Gateways are not automatically assumed to be firewalls.
      return 'Gateway'
    default:
      return clean(value)
  }
}

export function arubaNewCentralDeviceToNormalizedRow(
  device: ArubaCentralDevice,
  rowNumber: number,
  context: ArubaNewCentralImportContext = {},
): NormalizedInventorySourceRow {
  const sourceId = clean(device.id) ?? clean(device.serialNumber)
  const siteId = clean(device.siteId)
  const mappedSite = siteId ? clean(context.sitesById?.[siteId]) : null
  const firmwareVersion = clean(device.firmwareVersion)
  const softwareVersion = clean(device.softwareVersion)

  return {
    rowNumber,
    sourceRecordKey: sourceId,
    rawValues: {
      customer: clean(context.customer),
      businessUnit: clean(context.businessUnit),
      site: mappedSite ?? clean(device.siteName),
      sourceId,
      deviceName: clean(device.deviceName),
      hostname: clean(device.hostname),
      serialNumber: clean(device.serialNumber),
      macAddress: clean(device.macAddress),
      vendor: 'Aruba',
      model: clean(device.model),
      deviceType: importerDeviceType(device.deviceType),
      managementAddress: clean(device.ipv4),
      currentFirmware: firmwareVersion ?? softwareVersion,
      firmwareVersion,
      softwareVersion,
    },
    sourceEvidence: {
      provider: ARUBA_CENTRAL_PROVIDER,
      variant: 'NEW',
      sourceId,
      site: { id: siteId, name: clean(device.siteName) },
      group: {
        id: clean(device.deviceGroupId),
        name: clean(device.deviceGroupName),
      },
      device: {
        id: clean(device.id),
        serialNumber: clean(device.serialNumber),
        macAddress: clean(device.macAddress),
        deviceType: clean(device.deviceType),
        status: clean(device.status),
        deployment: clean(device.deployment),
        firmwareVersion,
        softwareVersion,
      },
    },
  }
}

function assertSource(source: InventorySourceDefinition) {
  if (normalizeInventoryProvider(source.provider) !== ARUBA_CENTRAL_PROVIDER) {
    throw new Error('Aruba Central adapter requires provider ARUBA.')
  }
  if (source.adapterType !== ARUBA_NEW_CENTRAL_ADAPTER_TYPE) {
    throw new Error(
      `New Central adapter requires type ${ARUBA_NEW_CENTRAL_ADAPTER_TYPE}.`,
    )
  }
}

export const arubaNewCentralInventorySourceAdapter: InventorySourceAdapter<ArubaNewCentralAdapterInput> = {
  adapterType: ARUBA_NEW_CENTRAL_ADAPTER_TYPE,

  loadAndNormalize({ source, input }) {
    assertSource(source)
    const rows = input.devices.map((device, index) =>
      arubaNewCentralDeviceToNormalizedRow(device, index + 1, input.context),
    )
    return normalizedInventorySource({
      source,
      rows,
      metadata: { deviceCount: rows.length, variant: 'NEW' },
    })
  },
}
