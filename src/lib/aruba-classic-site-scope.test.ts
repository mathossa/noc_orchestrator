import { describe, expect, it } from 'vitest'
import { filterClassicCentralDevicesBySelectedSites } from '@/lib/aruba-classic-site-scope'

const sites = [
  { siteId: '12', siteName: 'HQ', site: 'NOC HQ', enabled: true },
  { siteId: '38', siteName: 'Branch', site: 'NOC Branch', enabled: false },
  { siteId: '42', siteName: 'Remote', site: 'NOC Remote', enabled: true },
]

describe('Aruba Classic selected-site safety gate', () => {
  it('stages only enabled sites, and excludes disabled, unknown and unassigned sites', () => {
    const result = filterClassicCentralDevicesBySelectedSites([
      { kind: 'AP', raw: { serial: 'AP1', site_id: 12, site_name: 'HQ' } },
      { kind: 'SWITCH', raw: { serial: 'SW2', site_id: 38, site_name: 'Branch' } },
      { kind: 'AP', raw: { serial: 'AP3', site: 'Nonselected' } },
      { kind: 'AP', raw: { serial: 'AP4', group: 'HQ' } },
      { kind: 'SWITCH', raw: { serial: 'SW5', site_id: 42, site_name: 'Remote' } },
    ], sites)
    expect(result.devices.map(device => device.raw.serial)).toEqual(['AP1', 'SW5'])
    expect(result.excludedCount).toBe(3)
    expect(result.withoutSiteCount).toBe(1)
    expect(result.conflictedSiteCount).toBe(0)
  })

  it('can match by stable site ID even when the observed label has changed', () => {
    const result = filterClassicCentralDevicesBySelectedSites([
      { kind: 'AP', raw: { serial: 'AP1', site_id: 12, site_name: 'HQ (renamed)' } },
    ], sites)
    expect(result.devices).toHaveLength(1)
    expect(result.devices[0].raw.site).toBe('HQ')
    expect(result.devices[0].raw.centralObservedSiteName).toBe('HQ (renamed)')
  })

  it('never allows an ID/name mismatch to include a device from an unselected site', () => {
    const result = filterClassicCentralDevicesBySelectedSites([
      { kind: 'AP', raw: { serial: 'AP1', site_id: 38, site_name: 'HQ' } },
      { kind: 'AP', raw: { serial: 'AP2', site_id: 777, site_name: 'HQ' } },
      { kind: 'AP', raw: { serial: 'AP3', site_id: 12, site_name: 'Branch' } },
    ], sites)
    expect(result.devices).toEqual([])
    expect(result.conflictedSiteCount).toBe(3)
  })

  it('compares site names case-insensitively only when IDs do not contradict', () => {
    const result = filterClassicCentralDevicesBySelectedSites([
      { kind: 'AP', raw: { serial: 'AP1', site_name: ' hq ' } },
      { kind: 'AP', raw: { serial: 'AP2', site_name: 'BRANCH' } },
      { kind: 'AP', raw: { serial: 'AP3', site_name: '   remote  ' } },
    ], sites)
    expect(result.devices.map(device => device.raw.serial)).toEqual(['AP1', 'AP3'])
  })

  it('does not import anything when the saved scope has no selected sites', () => {
    const result = filterClassicCentralDevicesBySelectedSites([
      {kind:'AP',raw:{serial:'AP1',site:'HQ'}},
    ], sites.map(site => ({...site,enabled:false})))
    expect(result.devices).toEqual([])
    expect(result.excludedCount).toBe(1)
  })

  it('rejects ambiguous or duplicate Central site scope identities', () => {
    expect(() => filterClassicCentralDevicesBySelectedSites([], [
      sites[0],{...sites[0],siteName:'Other HQ'},
    ])).toThrow('duplicate site IDs')
  })
})
