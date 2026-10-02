import { describe, expect, it } from 'vitest'
import {
  AUVIK_API_PROVIDER,
  AUVIK_API_V2_ADAPTER_TYPE,
  auvikApiV2InventorySourceAdapter,
} from '@/lib/importer-v2-auvik-api'

const source = {
  provider: AUVIK_API_PROVIDER,
  adapterType: AUVIK_API_V2_ADAPTER_TYPE,
  sourceAdapterId: 'auvik-api-v2:connection-1',
  name: 'Auvik production',
  enabled: true,
  configuration: { region: 'eu1' },
}

describe('Importer v2 Auvik API adapter', () => {
  it('keeps provider identity separate from connection/transport identity', () => {
    expect(AUVIK_API_PROVIDER).toBe('AUVIK')
    expect(AUVIK_API_V2_ADAPTER_TYPE).toBe('auvik-api-v2')
    expect(source.sourceAdapterId).toBe('auvik-api-v2:connection-1')
  })

  it('normalizes Auvik observations through the generic inventory adapter boundary', async () => {
    const normalized = await auvikApiV2InventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        tenants: [
          {
            context: {
              tenantId: 'tenant-1',
              tenantName: 'Example site',
              customer: 'Example Customer',
              businessUnit: 'North',
              site: 'HQ',
            },
            devices: [
              {
                type: 'device',
                id: 'auvik-device-123',
                attributes: {
                  deviceName: 'HQ-SW01',
                  hostname: 'hq-sw01.example.local',
                  make: 'Cisco',
                  model: 'C9300-24P',
                  deviceType: 'switch',
                  deviceTypeDescription: 'Switch',
                  serialNumber: 'FOC12345678',
                  macAddresses: ['00:11:22:33:44:55'],
                  ipAddresses: ['10.0.0.10', '2001:db8::10'],
                  firmwareVersion: '17.15.5',
                  softwareVersion: 'Cisco IOS XE Software',
                },
              },
            ],
          },
        ],
      },
    })

    expect(normalized.source).toMatchObject(source)
    expect(normalized.metadata).toEqual({
      tenantCount: 1,
      deviceCount: 1,
    })
    expect(normalized.rows).toHaveLength(1)
    expect(normalized.rows[0]).toMatchObject({
      rowNumber: 1,
      sourceRecordKey: 'auvik-device-123',
      rawValues: {
        customer: 'Example Customer',
        businessUnit: 'North',
        site: 'HQ',
        deviceName: 'HQ-SW01',
        hostname: 'hq-sw01.example.local',
        sourceId: 'auvik-device-123',
        serialNumber: 'FOC12345678',
        macAddress: '00:11:22:33:44:55',
        vendor: 'Cisco',
        model: 'C9300-24P',
        deviceType: 'Switch',
        managementAddress: '10.0.0.10',
        currentFirmware: '17.15.5',
        firmwareVersion: '17.15.5',
        softwareVersion: 'Cisco IOS XE Software',
      },
    })
    expect(normalized.rows[0].sourceEvidence).toMatchObject({
      provider: 'AUVIK',
      tenant: {
        id: 'tenant-1',
        name: 'Example site',
      },
      device: {
        id: 'auvik-device-123',
        type: 'device',
      },
    })
  })

  it('numbers rows deterministically across tenant fan-out', async () => {
    const normalized = await auvikApiV2InventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        tenants: [
          {
            context: { tenantId: 'tenant-a' },
            devices: [
              { type: 'device', id: 'a-1', attributes: {} },
              { type: 'device', id: 'a-2', attributes: {} },
            ],
          },
          {
            context: { tenantId: 'tenant-b' },
            devices: [
              { type: 'device', id: 'b-1', attributes: {} },
            ],
          },
        ],
      },
    })

    expect(normalized.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3])
    expect(normalized.rows.map((row) => row.rawValues.sourceId)).toEqual([
      'a-1',
      'a-2',
      'b-1',
    ])
  })

  it('does not invent optional inventory data that Auvik did not return', async () => {
    const normalized = await auvikApiV2InventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        tenants: [
          {
            context: { tenantId: 'tenant-1' },
            devices: [
              {
                type: 'device',
                id: 'device-minimal',
                attributes: {
                  make: 'Aruba',
                  model: 'AP-515',
                  deviceTypeDescription: 'Access Point',
                },
              },
            ],
          },
        ],
      },
    })

    const row = normalized.rows[0]
    expect(row.rawValues.sourceId).toBe('device-minimal')
    expect(row.rawValues.vendor).toBe('Aruba')
    expect(row.rawValues.model).toBe('AP-515')
    expect(row.rawValues.deviceType).toBe('Access Point')
    expect(row.rawValues.customer).toBeNull()
    expect(row.rawValues.currentFirmware).toBeNull()
  })

  it('rejects a non-Auvik source instead of silently changing provider identity', async () => {
    await expect(
      auvikApiV2InventorySourceAdapter.loadAndNormalize({
        source: { ...source, provider: 'MERAKI' },
        input: { tenants: [] },
      }),
    ).rejects.toThrow('requires provider AUVIK')
  })
})
