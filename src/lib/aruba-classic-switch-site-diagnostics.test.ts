import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  refresh: vi.fn(),
  list: vi.fn(),
}))
vi.mock('@/lib/aruba-classic-integration-store', () => ({
  getClassicCentralConnectionCredentials: mocks.credentials,
  classicCentralRefreshContext: mocks.refresh,
}))
vi.mock('@/lib/aruba-classic-central-api-client', () => ({
  listClassicCentralDevices: mocks.list,
}))
import { diagnoseClassicCentralSwitchSites } from '@/lib/aruba-classic-switch-site-diagnostics'

describe('Classic Central read-only switch site diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials.mockResolvedValue({
      connection: {
        configuration: {
          variant:'CLASSIC',baseUrl:'https://eu-apigw.central.arubanetworks.com',
          sites:[
            {siteId:'12',siteName:'HQ',site:'NOC HQ',enabled:true},
            {siteId:'38',siteName:'Branch',site:'NOC Branch',enabled:false},
          ],
        },
      },
      credentials:{accessToken:'ACCESS',refreshToken:'REFRESH',clientId:'ID',clientSecret:'SECRET'},
    })
    mocks.refresh.mockResolvedValue({
      refreshToken:'REFRESH',credentials:{clientId:'ID',clientSecret:'SECRET'},
      onTokensRotated:async()=>undefined,
    })
  })

  it('identifies switches whose monitoring response omits site fields but are returned by the site-filtered API', async()=>{
    mocks.list.mockImplementation(async (input:{switchSite?:string}) => {
      if (!input.switchSite) {
        return [
          {kind:'AP',raw:{serial:'AP01',site:'HQ'}},
          {kind:'SWITCH',raw:{serial:'SW01',stack_id:'STK01'}},
          {kind:'SWITCH',raw:{serial:'SW02',site:'Branch',site_id:38}},
        ]
      }
      if (input.switchSite==='HQ') {
        return [{kind:'SWITCH',raw:{serial:'SW01',stack_id:'STK01'}}]
      }
      return []
    })
    const result=await diagnoseClassicCentralSwitchSites('source-1')
    expect(result).toMatchObject({
      fetchedSwitchCount:2,
      selectedByCurrentFilter:0,
      excludedByCurrentFilter:2,
      missingSiteEvidenceCount:1,
      siteQueryHonored:true,
      siteChecks:[{siteName:'HQ',switchCount:1,
        overlapWithUnfiltered:1,missingSiteEvidenceCount:1,contradictoryEvidenceCount:0}],
    })
    expect(result.observedSwitchSites).toEqual([
      {siteName:null,siteId:null,count:1,stackedCount:1},
      {siteName:'Branch',siteId:'38',count:1,stackedCount:0},
    ])
    expect(mocks.list).toHaveBeenCalledTimes(3)
  })

  it('flags unreliable server-side site filtering and declines to probe matches', async()=>{
    mocks.list.mockImplementation(async (input:{switchSite?:string}) => {
      if (!input.switchSite) return [{kind:'SWITCH',raw:{serial:'SW01'}}]
      return [{kind:'SWITCH',raw:{serial:'SW01'}}]
    })
    const result=await diagnoseClassicCentralSwitchSites('source-1')
    expect(result.siteQueryHonored).toBe(false)
    expect(result.siteChecks).toEqual([])
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('requires saved site scope and cannot stage or publish devices', async()=>{
    const loaded=await mocks.credentials()
    mocks.credentials.mockResolvedValueOnce({
      ...loaded,connection:{
        configuration:{...loaded.connection.configuration,sites:[]},
      },
    })
    await expect(diagnoseClassicCentralSwitchSites('source-1'))
      .rejects.toThrow('Save at least one')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('shows contradictory site evidence on a switch returned by the selected-site API', async()=>{
    mocks.list.mockImplementation(async (input:{switchSite?:string}) => {
      if (!input.switchSite) return [{kind:'SWITCH',raw:{serial:'SW01',site:'Branch',site_id:38}}]
      if (input.switchSite==='HQ') return [{kind:'SWITCH',raw:{serial:'SW01',site:'Branch',site_id:38}}]
      return []
    })
    const result=await diagnoseClassicCentralSwitchSites('source-1')
    expect(result.siteChecks[0].contradictoryEvidenceCount).toBe(1)
    expect(result.selectedByCurrentFilter).toBe(0)
  })
})
