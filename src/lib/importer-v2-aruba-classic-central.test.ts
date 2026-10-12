import { describe, expect, it } from 'vitest'
import {
  arubaClassicCentralInventorySourceAdapter,
  classicCentralObservationToNormalizedRow,
} from '@/lib/importer-v2-aruba-classic-central'

const source = {
  provider: 'ARUBA',
  adapterType: 'aruba-central-classic',
  sourceAdapterId: 'aruba-central-classic:connection-1',
  name: 'Classic Central',
  enabled: true,
  configuration: { variant: 'CLASSIC' },
}

describe('Classic Central importer adapter', () => {
  it('preserves running firmware, serial, site, group and offline evidence', async () => {
    const result = await arubaClassicCentralInventorySourceAdapter.loadAndNormalize({
      source,
      input: {
        context: { customer: 'Customer A', sitesByName: { 'Branch-01': 'Main Branch' } },
        devices: [{
          kind: 'AP',
          raw: {
            serial: 'AP-SERIAL-01',
            macaddr: 'AA:BB:CC:DD:EE:FF',
            name: 'AP01',
            model: 'AP-515',
            group: 'AP-PROD',
            site: 'Branch-01',
            ip_address: '10.0.0.12',
            firmware_version: '8.10.0.14',
            status: 'Down',
          },
        }],
      },
    })
    expect(result.rows[0]).toMatchObject({
      sourceRecordKey: 'AP-SERIAL-01',
      rawValues: {
        customer: 'Customer A',
        site: 'Main Branch',
        deviceName: 'AP01',
        sourceId: 'AP-SERIAL-01',
        serialNumber: 'AP-SERIAL-01',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        model: 'AP-515',
        deviceType: 'Access Point',
        currentFirmware: '8.10.0.14',
        managementAddress: '10.0.0.12',
      },
      sourceEvidence: {
        variant: 'CLASSIC',
        device: {
          kind: 'AP',
          status: 'Down',
          group: 'AP-PROD',
          site: 'Branch-01',
        },
      },
    })
  })

  it('does not mistake the Central group for a customer or infer gateway as firewall', () => {
    const row = classicCentralObservationToNormalizedRow({
      kind: 'GATEWAY',
      raw: { serial: 'GW01', group: 'Customers', status: 'Down' },
    }, 1)
    expect(row.rawValues.customer).toBeNull()
    expect(row.rawValues.deviceType).toBe('Gateway')
    expect(row.rawValues.currentFirmware).toBeNull()
  })

  it('keeps source identity separated from the canonical device', async () => {
    const result = await arubaClassicCentralInventorySourceAdapter.loadAndNormalize({
      source,
      input: {devices: [{kind: 'SWITCH',raw: {serial:'SW01',status:'Up'}}]},
    })
    expect(result.rows[0].rawValues.sourceId).toBe('SW01')
    expect(result.rows[0].rawValues.deviceType).toBe('Switch')
    expect(result.metadata).toEqual({deviceCount:1,variant:'CLASSIC'})
  })

  it('rejects mismatched providers or Central variants', () => {
    expect(() => arubaClassicCentralInventorySourceAdapter.loadAndNormalize({
      source: {...source,provider:'AUVIK'},input:{devices:[]},
    })).toThrow()
    expect(() => arubaClassicCentralInventorySourceAdapter.loadAndNormalize({
      source: {...source,adapterType:'aruba-central-new'},input:{devices:[]},
    })).toThrow()
  })
})
