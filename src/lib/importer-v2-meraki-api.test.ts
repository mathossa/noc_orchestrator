import { describe, expect, it } from 'vitest'
import {
  merakiDashboardInventorySourceAdapter,
  configuredMerakiOrganizations,
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

  it('retains online/dormant/offline availability evidence separately from firmware interpretation', async () => {
    const normalized = await merakiDashboardInventorySourceAdapter.loadAndNormalize({
      source: {
        provider: 'MERAKI', adapterType: 'meraki-dashboard-api-v1',
        sourceAdapterId: 'meraki:test', name: 'Meraki', enabled: true, configuration: {},
      },
      input: {
        organizations: [{
          context,
          devices: [
            { networkId: 'N1', serial: 'Q-ONLINE', model: 'CW9162I', firmware: 'wireless-32-2-4' },
            { networkId: 'N1', serial: 'Q-DORMANT', model: 'CW9162I', firmware: 'Not running configured version' },
            { networkId: 'N1', serial: 'Q-OFFLINE', model: 'CW9162I' },
          ],
          availabilities: [
            { serial: 'Q-ONLINE', status: 'online' },
            { serial: 'Q-DORMANT', status: 'dormant' },
            { serial: 'Q-OFFLINE', status: 'offline' },
          ],
          availabilityObservedAt: '2026-10-08T20:00:00.000Z',
        }],
      },
    })
    expect(normalized.rows.map((row) =>
      (row.sourceEvidence?.availability as { status?: string } | null)?.status,
    )).toEqual(['online', 'dormant', 'offline'])
    expect(normalized.rows[0].rawValues.firmwareVersion).toBe('wireless-32-2-4')
    expect(normalized.rows[1].rawValues.firmwareVersion).toBe('Not running configured version')
    expect(normalized.rows[1].sourceEvidence?.availability).toEqual({
      status: 'dormant', observedAt: '2026-10-08T20:00:00.000Z',
    })
  })

  it('never infers online when Meraki provides no availability evidence', () => {
    const row = merakiDeviceToNormalizedInventoryRow(
      { networkId: 'N1', serial: 'Q-UNKNOWN', model: 'MR36' }, context, 1,
    )
    expect(row.sourceEvidence?.availability).toBeNull()
  })

  it('syncs only enabled organizations and networks, preserving legacy all-network scope', () => {
    const scopes = configuredMerakiOrganizations({
      organizations: [
        { ...context, enabled: false },
        { ...context, organizationId: 'org-2', enabled: true, networks: [
          { networkId: 'N-A', enabled: false },
          { networkId: 'N-B', enabled: true },
        ] },
        { ...context, organizationId: 'org-3', enabled: true, networks: [], networksDiscovered: true },
        { ...context, organizationId: 'legacy', enabled: true, networks: [] },
      ],
    })
    expect(scopes.map((scope) => scope.organizationId)).toEqual(['org-2', 'legacy'])
    expect(scopes[0].networks.map((network) => network.networkId)).toEqual(['N-B'])
    expect(scopes[1].networks).toEqual([])
    expect(() => configuredMerakiOrganizations({
      organizations: [{ ...context, enabled: true, networksDiscovered: true, networks: [] }],
    })).toThrow('Enable at least one')
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
