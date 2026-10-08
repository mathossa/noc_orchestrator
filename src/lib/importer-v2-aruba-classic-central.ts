/**
 * Classic Central observations → transport-neutral Importer v2 rows.
 * SPDX-License-Identifier: AGPL-3.0-only
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
import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'
import { ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE } from '@/lib/aruba-classic-central-api-client'
import { ARUBA_CENTRAL_PROVIDER } from '@/lib/importer-v2-aruba-central'

export type ArubaClassicCentralMappingContext = {
  customer?: string | null
  businessUnit?: string | null
  /** Classic site/group labels are scoped to the connected Central account. */
  sitesByName?: Readonly<Record<string, string>>
}

export type ArubaClassicCentralAdapterInput = {
  devices: readonly ClassicCentralDeviceObservation[]
  context?: ArubaClassicCentralMappingContext
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

function pick(value: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const candidate = clean(value[name])
    if (candidate) return candidate
  }
  return null
}

export function classicCentralObservationToNormalizedRow(
  observation: ClassicCentralDeviceObservation,
  rowNumber: number,
  context: ArubaClassicCentralMappingContext = {},
): NormalizedInventorySourceRow {
  const raw = observation.raw
  const serial = pick(raw, 'serial', 'serial_number', 'serialNumber')
  const sourceId = serial // Classic monitoring APIs use serial as their identity.
  const site = pick(raw, 'site', 'site_name', 'siteName')
  const version = pick(raw, 'firmware_version', 'firmwareVersion', 'version')
  const mappedSite = site ? clean(context.sitesByName?.[site]) : null
  const deviceType = observation.kind === 'AP'
    ? 'Access Point'
    : observation.kind === 'SWITCH'
      ? 'Switch'
      : 'Gateway'

  return {
    rowNumber,
    sourceRecordKey: sourceId,
    rawValues: {
      customer: clean(context.customer),
      businessUnit: clean(context.businessUnit),
      site: mappedSite ?? site,
      sourceId,
      deviceName: pick(raw, 'name', 'ap_name', 'hostname', 'device_name'),
      hostname: pick(raw, 'hostname'),
      serialNumber: serial,
      macAddress: pick(raw, 'macaddr', 'mac_address', 'macAddress'),
      vendor: 'Aruba',
      model: pick(raw, 'model'),
      deviceType,
      managementAddress: pick(raw, 'ip_address', 'ipaddr', 'ipAddress'),
      currentFirmware: version,
      firmwareVersion: version,
      softwareVersion: null,
    },
    sourceEvidence: {
      provider: ARUBA_CENTRAL_PROVIDER,
      variant: 'CLASSIC',
      device: {
        kind: observation.kind,
        sourceId,
        status: pick(raw, 'status'),
        serial,
        group: pick(raw, 'group', 'ap_group', 'device_group'),
        site,
        // Keep noncanonical source payload visible to Importer v2 review.
        raw: { ...raw },
      },
    },
  }
}

function assertClassicSource(source: InventorySourceDefinition) {
  if (normalizeInventoryProvider(source.provider) !== ARUBA_CENTRAL_PROVIDER) {
    throw new Error('Classic Central adapter requires provider ARUBA.')
  }
  if (source.adapterType !== ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE) {
    throw new Error(
      `Classic Central adapter requires type ${ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE}.`,
    )
  }
}

export const arubaClassicCentralInventorySourceAdapter: InventorySourceAdapter<ArubaClassicCentralAdapterInput> = {
  adapterType: ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE,

  loadAndNormalize({ source, input }) {
    assertClassicSource(source)
    const rows = input.devices.map((device, index) =>
      classicCentralObservationToNormalizedRow(device, index + 1, input.context),
    )
    return normalizedInventorySource({
      source,
      rows,
      metadata: { deviceCount: rows.length, variant: 'CLASSIC' },
    })
  },
}
