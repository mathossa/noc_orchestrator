import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks=vi.hoisted(()=>({
  credentials:vi.fn(),
  refreshContext:vi.fn(),
  listDevices:vi.fn(),
  stage:vi.fn(),
  automation:vi.fn(),
  publish:vi.fn(),
  begin:vi.fn(),
  complete:vi.fn(),
  fail:vi.fn(),
}))
vi.mock('@/lib/aruba-classic-integration-store',()=>({
  getClassicCentralConnectionCredentials:mocks.credentials,
  classicCentralRefreshContext:mocks.refreshContext,
}))
vi.mock('@/lib/aruba-classic-central-api-client',()=>({
  ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE:'aruba-central-classic',
  listClassicCentralDevices:mocks.listDevices,
}))
vi.mock('@/lib/importer-v2-ingestion-store',()=>({stageImporterV2NormalizedSource:mocks.stage}))
vi.mock('@/lib/importer-v2-workspace-maintenance',()=>({initializeImporterV2WorkspaceAutomation:mocks.automation}))
vi.mock('@/lib/importer-v2-auto-publication',()=>({autoPublishImporterV2SafeValidRows:mocks.publish}))
vi.mock('@/lib/inventory-sync-run-store',()=>({
  beginInventorySyncRun:mocks.begin,
  completeInventorySyncRun:mocks.complete,
  failInventorySyncRun:mocks.fail,
}))

import {runClassicCentralInventorySync} from '@/lib/aruba-classic-inventory-sync'

describe('Classic Central shared inventory sync',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    mocks.begin.mockResolvedValue({id:'run-1'})
    mocks.complete.mockResolvedValue({id:'run-1',status:'SUCCEEDED'})
    mocks.refreshContext.mockResolvedValue({
      credentials:{clientId:'id',clientSecret:'secret'},
      refreshToken:'refresh',
      onTokensRotated:async()=>undefined,
    })
    mocks.credentials.mockResolvedValue({
      connection:{
        id:'source-1',name:'Aruba Classic',enabled:true,
        sourceAdapterId:'aruba-central-classic:source-1',
        connectionTest:{status:'SUCCESS'},
        configuration:{
          version:1,variant:'CLASSIC',baseUrl:'https://eu-apigw.central.arubanetworks.com',
          customer:'Customer A',businessUnit:null,
          sites:[
            {siteName:'HQ',enabled:true,site:'Main Site'},
            {siteName:'Branch',enabled:false,site:'Branch'},
          ],
        },
      },
      credentials:{clientId:'id',clientSecret:'secret',accessToken:'access',refreshToken:'refresh'},
    })
    mocks.listDevices.mockResolvedValue([
      {kind:'AP',raw:{serial:'AP01',site:'HQ',model:'AP-515',status:'Down',firmware_version:'8.10.0.14'}},
      {kind:'SWITCH',raw:{serial:'SW01',site:'Branch',model:'2930F'}},
      {kind:'AP',raw:{serial:'AP02',site:'Unmapped'}},
    ])
    mocks.stage.mockResolvedValue({batch:{id:'batch-1'},profile:{id:'source-1'},evaluation:{}})
    mocks.automation.mockResolvedValue({})
    mocks.publish.mockResolvedValue({
      publishedLogicalDeviceCount:1,
      remainingIncludedRows:0,
      reconciliationRequired:false,
    })
  })

  it('stages selected site only and never treats subset as full inventory',async()=>{
    const result=await runClassicCentralInventorySync('source-1')
    expect(mocks.stage).toHaveBeenCalledWith(expect.objectContaining({
      source:expect.objectContaining({provider:'ARUBA',adapterType:'aruba-central-classic'}),
      isFullInventoryExport:false,
      rows:[expect.objectContaining({
        rawValues:expect.objectContaining({
          customer:'Customer A',site:'Main Site',sourceId:'AP01',currentFirmware:'8.10.0.14',
        }),
        sourceEvidence:expect.objectContaining({variant:'CLASSIC'}),
      })],
    }))
    expect(result.source).toMatchObject({
      deviceCount:1,observedDeviceCount:3,selectedSiteCount:1,partial:false,
    })
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      fetchedCount:3,stagedCount:1,autoPublishedCount:1,reviewRequiredCount:0,
    }))
  })

  it('runs scheduled sync without requiring interactive reconciliation',async()=>{
    mocks.publish.mockResolvedValueOnce({
      publishedLogicalDeviceCount:1,remainingIncludedRows:2,reconciliationRequired:true,
    })
    await runClassicCentralInventorySync('source-1',{trigger:'SCHEDULED'})
    expect(mocks.begin).toHaveBeenCalledWith('source-1','SCHEDULED')
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      reviewRequiredCount:2,
      metadata:expect.objectContaining({unattended:true,skippedForReview:2}),
    }))
  })

  it('fails closed before staging on a partial Classic API failure',async()=>{
    mocks.listDevices.mockRejectedValueOnce(new Error('Classic Central device list failed'))
    await expect(runClassicCentralInventorySync('source-1')).rejects.toThrow('device list failed')
    expect(mocks.stage).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.fail).toHaveBeenCalledWith('run-1',expect.any(Error))
  })

  it('requires at least one enabled scope and successful tested connection',async()=>{
    const record=await mocks.credentials()
    mocks.credentials.mockResolvedValueOnce({
      ...record,connection:{
        ...record.connection,
        configuration:{...record.connection.configuration,sites:record.connection.configuration.sites.map((s:{siteName:string})=>({...s,enabled:false}))},
      },
    })
    await expect(runClassicCentralInventorySync('source-1')).rejects.toThrow('Enable at least one')
    expect(mocks.listDevices).not.toHaveBeenCalled()
  })
})
