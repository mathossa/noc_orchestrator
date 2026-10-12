import { describe, expect, it } from 'vitest'
import {
  ARUBA_CENTRAL_PROVIDER,
  ARUBA_NEW_CENTRAL_ADAPTER_TYPE,
  arubaNewCentralInventorySourceAdapter,
} from '@/lib/importer-v2-aruba-central'

const source = {
  provider: 'ARUBA',
  adapterType: ARUBA_NEW_CENTRAL_ADAPTER_TYPE,
  sourceAdapterId: 'aruba-central-new:connection-1',
  name: 'Aruba New Central',
  enabled: true,
  configuration: {
    variant: 'NEW',
    baseUrl: 'https://de1.api.central.arubanetworks.com',
  },
}

describe('New Central Importer v2 adapter', () => {
  it('maintains the provider-scoped identity separate from connection identity', () => {
    expect(ARUBA_CENTRAL_PROVIDER).toBe('ARUBA')
    expect(ARUBA_NEW_CENTRAL_ADAPTER_TYPE).toBe('aruba-central-new')
  })

  it('maps a real Central device payload and preserves offline, group and site evidence', async () => {
    const normalized = await arubaNewCentralInventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        context: {
          customer: 'Customer A',
          sitesById: { 'site-1': 'HQ' },
        },
        devices: [
          {
            id: 'SERIAL-AP',
            serialNumber: 'SERIAL-AP',
            deviceName: 'AP-2-2',
            macAddress: 'AA:BB:CC:DD:EE:FF',
            model: 'AP-515',
            deviceType: 'ACCESS_POINT',
            ipv4: '10.0.0.8',
            siteId: 'site-1',
            siteName: 'Old Site Name',
            deviceGroupId: 'group-id',
            deviceGroupName: 'AP group',
            softwareVersion: '10.6.0.2_90095',
            status: 'OFFLINE',
          },
        ],
      },
    })
    expect(normalized.metadata).toEqual({ variant: 'NEW', deviceCount: 1 })
    expect(normalized.rows[0]).toMatchObject({
      rowNumber: 1,
      sourceRecordKey: 'SERIAL-AP',
      rawValues: {
        customer: 'Customer A',
        site: 'HQ',
        deviceName: 'AP-2-2',
        sourceId: 'SERIAL-AP',
        serialNumber: 'SERIAL-AP',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        vendor: 'Aruba',
        model: 'AP-515',
        deviceType: 'Access Point',
        currentFirmware: '10.6.0.2_90095',
        softwareVersion: '10.6.0.2_90095',
      },
      sourceEvidence: {
        provider: 'ARUBA',
        variant: 'NEW',
        site: { id: 'site-1' },
        group: { id: 'group-id', name: 'AP group' },
        device: { status: 'OFFLINE' },
      },
    })
  })

  it('keeps gateway type explicit and does not infer an Aruba group as a customer', async () => {
    const normalized = await arubaNewCentralInventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        devices: [
          {
            id: 'GW-1',
            deviceType: 'GATEWAY',
            deviceGroupName: 'Branch routers',
            siteId: 'opaque-site-id',
            status: 'DORMANT',
          },
        ],
      },
    })
    expect(normalized.rows[0].rawValues).toMatchObject({
      customer: null,
      site: null,
      deviceType: 'Gateway',
      currentFirmware: null,
    })
    expect(normalized.rows[0].sourceEvidence?.device).toMatchObject({
      status: 'DORMANT',
    })
  })

  it('prefers running firmware evidence and does not invent missing firmware', async () => {
    const normalized = await arubaNewCentralInventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        devices: [
          { serialNumber: 'SW-1', firmwareVersion: 'WC.16.11.0014', softwareVersion: 'boot' },
          { id: 'SW-2', deviceType: 'SWITCH' },
        ],
      },
    })
    expect(normalized.rows.map((row) => row.rowNumber)).toEqual([1, 2])
    expect(normalized.rows[0].rawValues.currentFirmware).toBe('WC.16.11.0014')
    expect(normalized.rows[1].rawValues.currentFirmware).toBeNull()
    expect(normalized.rows[1].rawValues.deviceType).toBe('Switch')
  })

  it('rejects a non-Aruba or different variant source', () => {
    expect(() =>
      arubaNewCentralInventorySourceAdapter.loadAndNormalize({
        source: { ...source, provider: 'AUVIK' },
        input: { devices: [] },
      }),
    ).toThrow('provider ARUBA')
    expect(() =>
      arubaNewCentralInventorySourceAdapter.loadAndNormalize({
        source: { ...source, adapterType: 'aruba-central-classic' },
        input: { devices: [] },
      }),
    ).toThrow('New Central adapter requires')
  })
})
