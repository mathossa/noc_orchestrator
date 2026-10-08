import type {
  InventorySourceAdapter,
  InventorySourceDefinition,
  NormalizedInventorySourceRow,
} from '@/lib/inventory-source-adapter'
import {
  normalizeInventoryProvider,
  normalizedInventorySource,
} from '@/lib/inventory-source-adapter'
import type { MerakiDevice } from '@/lib/meraki-api-client'

export const MERAKI_API_PROVIDER = 'MERAKI'
export const MERAKI_DASHBOARD_API_ADAPTER_TYPE = 'meraki-dashboard-api-v1'

export type MerakiNetworkScope = {
  networkId: string
  networkName?: string | null
  site?: string | null
}

export type MerakiOrganizationScope = {
  organizationId: string
  organizationName?: string | null
  customer?: string | null
  businessUnit?: string | null
  networks: readonly MerakiNetworkScope[]
}

export type MerakiOrganizationInventory = {
  context: MerakiOrganizationScope
  devices: readonly MerakiDevice[]
}

export type MerakiApiAdapterInput = {
  organizations: readonly MerakiOrganizationInventory[]
}

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

export function merakiProductTypeToDeviceType(productType: unknown) {
  switch (clean(productType)?.toLocaleLowerCase('en-US')) {
    case 'switch':
      return 'Switch'
    case 'wireless':
      return 'Access Point'
    case 'appliance':
      return 'Firewall'
    default:
      return clean(productType)
  }
}

function networkContext(
  scope: MerakiOrganizationScope,
  networkId: string,
) {
  return scope.networks.find((network) => network.networkId === networkId) ?? null
}

export function merakiDeviceToNormalizedInventoryRow(
  device: MerakiDevice,
  context: MerakiOrganizationScope,
  rowNumber: number,
): NormalizedInventorySourceRow {
  const network = networkContext(context, device.networkId)
  const organizationName = clean(context.organizationName)
  const networkName = clean(network?.networkName)
  const serial = clean(device.serial)

  return {
    rowNumber,
    sourceRecordKey: serial,
    rawValues: {
      customer: clean(context.customer) ?? organizationName,
      businessUnit: clean(context.businessUnit),
      site: clean(network?.site) ?? networkName,
      deviceName: clean(device.name) ?? serial,
      hostname: clean(device.name),
      sourceId: serial,
      serialNumber: serial,
      macAddress: clean(device.mac),
      vendor: 'Cisco',
      model: clean(device.model),
      deviceType: merakiProductTypeToDeviceType(device.productType),
      managementAddress: clean(device.lanIp),
      currentFirmware: clean(device.firmware),
      firmwareVersion: clean(device.firmware),
      softwareVersion: null,
    },
    sourceEvidence: {
      provider: MERAKI_API_PROVIDER,
      organization: {
        id: context.organizationId,
        name: organizationName,
      },
      network: {
        id: device.networkId,
        name: networkName,
      },
      device: structuredClone(device),
    },
  }
}

function assertMerakiSource(source: InventorySourceDefinition) {
  if (normalizeInventoryProvider(source.provider) !== MERAKI_API_PROVIDER) {
    throw new Error('Meraki API adapter requires provider MERAKI.')
  }
  if (source.adapterType !== MERAKI_DASHBOARD_API_ADAPTER_TYPE) {
    throw new Error(
      `Meraki API adapter requires adapter type ${MERAKI_DASHBOARD_API_ADAPTER_TYPE}.`,
    )
  }
}

export const merakiDashboardInventorySourceAdapter: InventorySourceAdapter<MerakiApiAdapterInput> =
  {
    adapterType: MERAKI_DASHBOARD_API_ADAPTER_TYPE,

    loadAndNormalize({ source, input }) {
      assertMerakiSource(source)
      let rowNumber = 0
      const rows = input.organizations.flatMap((organization) =>
        organization.devices.map((device) => {
          rowNumber += 1
          return merakiDeviceToNormalizedInventoryRow(
            device,
            organization.context,
            rowNumber,
          )
        }),
      )

      return normalizedInventorySource({
        source,
        rows,
        metadata: {
          organizationCount: input.organizations.length,
          deviceCount: rows.length,
        },
      })
    },
  }
