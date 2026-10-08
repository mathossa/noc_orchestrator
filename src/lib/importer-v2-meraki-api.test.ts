import { describe, expect, it } from 'vitest'
import {
  merakiDashboardInventorySourceAdapter,
  merakiDeviceToNormalizedInventoryRow,
  merakiProductTypeToDeviceType,
} from '@/lib/importer-v2-meraki-api'

const context = {
  organizationId: 'org-1',
  organizationName: 'Source Organization',
  customer: 'Canonical Customer',
  businessUnit: null,
  networks: [
    { networkId: 'N1', networkName: 'Source Network', site: 'Canonical Site' },
  ],
}

describe('Meraki -> Importer v2 normalization', () => {
  it('uses serial as provider identity and preserves firmware evidence', () => {
    const row = merakiDeviceToNormalizedInventoryRow(
      {
        networkId: 'N1',
        serial: 'Q234-ABCD-5678',
        model: 'MR36',
        name: 'AP01',
        mac: '00:11:22:33:44:55',
        lanIp: '10.0.0.10',
        firmware: 'wireless-31-1-7',
        productType: 'wireless',
      },
      context,
      1,
    )
    expect(row.rawValues).toMatchObject({
      customer: 'Canonical Customer',
      site: 'Canonical Site',
      sourceId: 'Q234-ABCD-5678',
      serialNumber: 'Q234-ABCD-5678',
      vendor: 'Cisco',
      model: 'MR36',
      deviceType: 'Access Point',
      currentFirmware: 'wireless-31-1-7',
    })
    expect(row.sourceEvidence).toMatchObject({
      organization: { id: 'org-1' },
      network: { id: 'N1' },
    })
  })

  it('normalizes only supported canonical device families', () => {
    expect(merakiProductTypeToDeviceType('switch')).toBe('Switch')
    expect(merakiProductTypeToDeviceType('wireless')).toBe('Access Point')
    expect(merakiProductTypeToDeviceType('appliance')).toBe('Firewall')
    expect(merakiProductTypeToDeviceType('camera')).toBe('camera')
  })

  it('cannot express desired firmware, exception, approval or work-plan ownership fields', () => {
    const row = merakiDeviceToNormalizedInventoryRow(
      {
        networkId: 'N1',
        serial: 'Q-OWNERSHIP',
        model: 'MX75',
        productType: 'appliance',
        firmware: 'wired-18-211-2',
      },
      context,
      1,
    )
    expect(Object.keys(row.rawValues).sort()).toEqual(
      expect.arrayContaining([
        'currentFirmware',
        'deviceName',
        'deviceType',
        'firmwareVersion',
        'model',
        'serialNumber',
        'sourceId',
        'vendor',
      ]),
    )
    for (const forbidden of [
      'desiredFirmware',
      'preferredFirmware',
      'minimumFirmware',
      'firmwareException',
      'approval',
      'maintenanceWindow',
      'workPlan',
      'lifecycle',
      'eolDecision',
    ]) {
      expect(row.rawValues).not.toHaveProperty(forbidden)
    }
  })

  it('produces shared normalized source rows without a custom publication path', async () => {
    const normalized = await merakiDashboardInventorySourceAdapter.loadAndNormalize({
      source: {
        provider: 'MERAKI',
        adapterType: 'meraki-dashboard-api-v1',
        sourceAdapterId: 'meraki-dashboard-api-v1:test',
        name: 'Meraki',
        enabled: true,
        configuration: {},
      },
      input: {
        organizations: [
          {
            context,
            devices: [
              {
                networkId: 'N1',
                serial: 'Q1',
                model: 'MS225-24P',
                productType: 'switch',
              },
            ],
          },
        ],
      },
    })
    expect(normalized.rows).toHaveLength(1)
    expect(normalized.source.provider).toBe('MERAKI')
  })
})
