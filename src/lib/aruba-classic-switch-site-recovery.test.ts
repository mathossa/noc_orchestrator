import { describe, expect, it, vi } from 'vitest'
import { recoverClassicSwitchSitesFromVerifiedQueries } from '@/lib/aruba-classic-switch-site-recovery'
import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'

const sites=[
  {siteId:'128',siteName:'Unica - Bodegraven',enabled:true,site:'Unica Bodegraven'},
  {siteId:'129',siteName:'Other site',enabled:false,site:'Other'},
]
const inventory:ClassicCentralDeviceObservation[]=[
  {kind:'AP',raw:{serial:'AP01',site:'Unica - Bodegraven'}},
  {kind:'SWITCH',raw:{serial:'CX01',stack_id:'STACK-1',firmware_version:'10.13.1040'}},
  {kind:'SWITCH',raw:{serial:'CX02',stack_id:'STACK-1',firmware_version:'10.13.1040'}},
  {kind:'SWITCH',raw:{serial:'SW03',site:'Other site',site_id:129}},
]
const switchRecord=(serial:string,fields:Record<string,unknown>={})=>({
  kind:'SWITCH' as const,raw:{serial,...fields},
})

describe('Aruba Classic switch site recovery',()=>{
  it('recovers the eight site-filtered switch members without changing other-site inventory',async()=>{
    const eight=[
      ...inventory.slice(1,3),
      ...Array.from({length:6},(_,i)=>switchRecord(`CX${i+3}`,{stack_id:'STACK-2'})),
    ]
    const global=[
      ...inventory,
      ...Array.from({length:6},(_,i)=>switchRecord(`CX${i+3}`,{stack_id:'STACK-2'})),
      ...Array.from({length:12},(_,i)=>switchRecord(`OTHER${i}`)),
    ]
    const read=vi.fn(async(siteName:string)=>{
      if(siteName==='Unica - Bodegraven')return eight
      return []
    })
    const result=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:global,selectedSites:sites,readSwitchesForSite:read,
      impossibleSiteName:'nonexistent-control',
    })
    expect(result).toMatchObject({
      attempted:true,serverFilterVerified:true,recoveredSwitchCount:8,
      ambiguousSwitchCount:0,queriedSiteCount:1,unmatchedQueryRowCount:0,
    })
    expect(result.observations.filter(row=>row.kind==='SWITCH' &&
      row.raw.centralSiteEvidenceSource==='VERIFIED_CLASSIC_SWITCH_SITE_QUERY')).toHaveLength(8)
    expect(result.observations.find(row=>row.raw.serial==='SW03')?.raw.site).toBe('Other site')
    expect(result.observations.find(row=>row.raw.serial==='OTHER0')?.raw.site).toBeUndefined()
    expect(result.observations.find(row=>row.raw.serial==='CX01')?.raw).toMatchObject({
      site:'Unica - Bodegraven',
      site_id:'128',
      firmware_version:'10.13.1040',
      stack_id:'STACK-1',
      centralSiteEvidenceSource:'VERIFIED_CLASSIC_SWITCH_SITE_QUERY',
      centralOriginalSiteId:null,
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('fails closed when Aruba ignores the server-side site filter',async()=>{
    const read=vi.fn(async()=>[switchRecord('CX01')])
    const result=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:inventory,selectedSites:sites,readSwitchesForSite:read,
      impossibleSiteName:'nonexistent-control',
    })
    expect(result.serverFilterVerified).toBe(false)
    expect(result.recoveredSwitchCount).toBe(0)
    expect(result.observations[1].raw.site).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('rejects a filtered switch that reports a contradictory physical site',async()=>{
    const result=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:inventory,selectedSites:sites,
      readSwitchesForSite:async(site)=>site==='Unica - Bodegraven'
        ?[switchRecord('CX01',{site:'Other site',site_id:129})]:[],
      impossibleSiteName:'nonexistent-control',
    })
    expect(result.recoveredSwitchCount).toBe(0)
    expect(result.ambiguousSwitchCount).toBe(1)
  })

  it('requires a single unique unfiltered serial, and never publishes a filtered-only device',async()=>{
    const result=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:[...inventory,switchRecord('CX01')],
      selectedSites:sites,
      readSwitchesForSite:async(site)=>site==='Unica - Bodegraven'
        ?[switchRecord('CX01'),switchRecord('NOT_IN_GLOBAL')]:[],
      impossibleSiteName:'nonexistent-control',
    })
    expect(result.recoveredSwitchCount).toBe(0)
    expect(result.unmatchedQueryRowCount).toBe(2)
  })

  it('rejects duplicate site claims instead of assigning a serial arbitrarily',async()=>{
    const multiple=[...sites,{siteId:'130',siteName:'Other enabled',enabled:true,site:'Other'}]
    const result=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:inventory,selectedSites:multiple,
      readSwitchesForSite:async(site)=>site==='nonexistent-control'?[]:
        [switchRecord('CX01')],
      impossibleSiteName:'nonexistent-control',
    })
    expect(result.recoveredSwitchCount).toBe(0)
    expect(result.ambiguousSwitchCount).toBe(1)
  })

  it('does not call provider API when all switches already have explicit site evidence',async()=>{
    const read=vi.fn()
    const result=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:[switchRecord('SW1',{site:'HQ',site_id:5})],
      selectedSites:sites,readSwitchesForSite:read,
    })
    expect(result.attempted).toBe(false)
    expect(read).not.toHaveBeenCalled()
  })
})
