import { describe, expect, it } from 'vitest'
import {
  AUVIK_API_PROVIDER,
  AUVIK_API_V2_SOURCE_ADAPTER_ID,
  auvikDevicesV2ToImporterV2StagedRows,
} from '@/lib/importer-v2-auvik-api'

describe('Importer v2 Auvik API adapter', () => {
  it('keeps provider identity separate from API transport identity', () => {
    expect(AUVIK_API_PROVIDER).toBe('AUVIK')
    expect(AUVIK_API_V2_SOURCE_ADAPTER_ID).toBe('auvik-api-v2')
  })

  it('normalizes Auvik device data and provided tenant hierarchy context', () => {
    const [row] = auvikDevicesV2ToImporterV2StagedRows({
      context: {
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
            make: 'Cisco',
            model: 'C9300-24P',
            deviceType: 'switch',
            deviceTypeDescription: 'Switch',
            serialNumber: 'FOC12345678',
            ipAddresses: ['10.0.0.10', '2001:db8::10'],
            firmwareVersion: '17.15.5',
            softwareVersion: 'Cisco IOS XE Software',
          },
        },
      ],
    })

    expect(row).toEqual({
      rowNumber: 1,
      sourceRecordKey: 'auvik-device-123',
      rawValues: {
        customer: 'Example Customer',
        businessUnit: 'North',
        site: 'HQ',
        deviceName: 'HQ-SW01',
        sourceId: 'auvik-device-123',
        serialNumber: 'FOC12345678',
        vendor: 'Cisco',
        model: 'C9300-24P',
        deviceType: 'Switch',
        managementAddress: '10.0.0.10',
        currentFirmware: '17.15.5',
        firmwareVersion: '17.15.5',
        softwareVersion: 'Cisco IOS XE Software',
      },
    })
  })

  it('does not invent optional inventory data that the source did not return', () => {
    const [row] = auvikDevicesV2ToImporterV2StagedRows({
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
    })

    expect(row.sourceRecordKey).toBe('device-minimal')
    expect(row.rawValues.sourceId).toBe('device-minimal')
    expect(row.rawValues.vendor).toBe('Aruba')
    expect(row.rawValues.model).toBe('AP-515')
    expect(row.rawValues.deviceType).toBe('Access Point')
    expect(row.rawValues.customer).toBeNull()
    expect(row.rawValues.currentFirmware).toBeNull()
  })

  it('uses software version as current firmware only when firmware is absent', () => {
    const [row] = auvikDevicesV2ToImporterV2StagedRows({
      devices: [
        {
          type: 'device',
          id: 'device-software-only',
          attributes: {
            deviceName: 'AP01',
            softwareVersion: '32.2.4',
          },
        },
      ],
    })

    expect(row.rawValues.currentFirmware).toBe('32.2.4')
    expect(row.rawValues.firmwareVersion).toBeNull()
    expect(row.rawValues.softwareVersion).toBe('32.2.4')
  })
})
