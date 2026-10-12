import { describe, expect, it } from 'vitest'
import { discoverSitesFromClassicDeviceEvidence } from '@/lib/aruba-classic-site-discovery'

describe('Classic Central site discovery from monitoring evidence', () => {
  it('deduplicates sites case-insensitively and preserves numeric site IDs', () => {
    const result = discoverSitesFromClassicDeviceEvidence([
      { kind: 'AP', raw: { serial: 'AP01', site: 'HQ', site_id: 12, group: 'Default' } },
      { kind: 'SWITCH', raw: { serial: 'SW01', site: 'hq', group_name: 'Switches' } },
      { kind: 'GATEWAY', raw: { serial: 'GW01', site_name: 'Branch', site_id: 42 } },
    ])
    expect(result).toEqual({
      sites: [
        { name: 'Branch', id: '42', origin: 'DEVICE_EVIDENCE' },
        { name: 'HQ', id: '12', origin: 'DEVICE_EVIDENCE' },
      ],
      observedDeviceCount: 3,
      unassignedDeviceCount: 0,
      observedGroupCount: 2,
    })
  })

  it('does not invent physical sites from configuration groups', () => {
    expect(discoverSitesFromClassicDeviceEvidence([
      { kind: 'AP', raw: { serial: 'AP01', ap_group: 'Location A' } },
      { kind: 'SWITCH', raw: { serial: 'SW01', group_name: 'Location B' } },
    ])).toEqual({
      sites: [],
      observedDeviceCount: 2,
      unassignedDeviceCount: 2,
      observedGroupCount: 2,
    })
  })

  it('accepts no observations without silently creating site scopes', () => {
    expect(discoverSitesFromClassicDeviceEvidence([])).toEqual({
      sites: [],
      observedDeviceCount: 0,
      unassignedDeviceCount: 0,
      observedGroupCount: 0,
    })
  })
})
