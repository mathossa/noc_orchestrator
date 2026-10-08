import { listClassicCentralDevices } from '@/lib/aruba-classic-central-api-client'
import {
  classicCentralRefreshContext,
  getClassicCentralConnectionCredentials,
} from '@/lib/aruba-classic-integration-store'
import { arubaClassicCentralInventorySourceAdapter } from '@/lib/importer-v2-aruba-classic-central'
import { normalizeInventorySourceDefinition } from '@/lib/inventory-source-adapter'
import {
  stageImporterV2NormalizedSource,
  type ImporterV2NormalizedSourceProfile,
} from '@/lib/importer-v2-ingestion-store'
import { IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE } from '@/lib/importer-v2-hierarchy'
import { ARUBA_CENTRAL_PROVIDER } from '@/lib/importer-v2-aruba-central'
import { ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE } from '@/lib/aruba-classic-central-api-client'
import { initializeImporterV2WorkspaceAutomation } from '@/lib/importer-v2-workspace-maintenance'
import { autoPublishImporterV2SafeValidRows } from '@/lib/importer-v2-auto-publication'
import {
  beginInventorySyncRun,
  completeInventorySyncRun,
  failInventorySyncRun,
  type InventorySyncTrigger,
} from '@/lib/inventory-sync-run-store'

export function classicCentralRuntimeImporterProfile(sourceId:string):ImporterV2NormalizedSourceProfile {
  return {
    id:sourceId,version:'aruba-classic-central-profile-v1',
    hierarchyTemplate:structuredClone(IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE),
    deviceTypePolicy:{
      version:'aruba-classic-device-types-v1',defaultAction:'INCLUDE',rules:[],
    },
    defaults:{},exactValueAliases:[],
  }
}

export async function runClassicCentralInventorySync(
  sourceId:string,
  options:{ fetchImpl?:typeof fetch; signal?:AbortSignal; trigger?:InventorySyncTrigger }={},
) {
  const run=await beginInventorySyncRun(sourceId,options.trigger??'MANUAL')
  try {
    const {connection,credentials}=await getClassicCentralConnectionCredentials(sourceId)
    if (!connection.enabled || connection.connectionTest.status !== 'SUCCESS') {
      throw new Error('Enable and successfully test the Classic Central connection before syncing.')
    }
    const enabledSites=connection.configuration.sites.filter((site)=>site.enabled)
    const allDevices=connection.configuration.scopeMode==='ALL_DEVICES'
    if (!allDevices && enabledSites.length===0) {
      throw new Error('Enable at least one Classic Central site, or explicitly choose all tenant devices, before syncing.')
    }
    const refresh=await classicCentralRefreshContext(sourceId,credentials)
    const fetched=await listClassicCentralDevices({
      configuration:connection.configuration,
      accessToken:credentials.accessToken,
      refresh,
      fetchImpl:options.fetchImpl,
      signal:options.signal,
    })
    // All-device listing and explicit scope filtering avoid assuming all
    // Central sites belong to one customer. Never treat a subset as a full export.
    const selected=new Map(enabledSites.map((site)=>[site.siteName.toLowerCase(),site]))
    const devices=allDevices?fetched:fetched.filter((device)=>{
      const raw=device.raw
      const site=[raw.site,raw.site_name,raw.siteName]
        .find((value)=>typeof value==='string'&&value.trim())
      return typeof site==='string'&&selected.has(site.trim().toLowerCase())
    })
    const sitesByName=Object.fromEntries((allDevices?connection.configuration.sites:enabledSites).flatMap((scope)=>
      scope.site ? [[scope.siteName,scope.site]] : []))
    const source=normalizeInventorySourceDefinition({
      id:connection.id,provider:ARUBA_CENTRAL_PROVIDER,
      adapterType:ARUBA_CLASSIC_CENTRAL_ADAPTER_TYPE,
      sourceAdapterId:connection.sourceAdapterId,
      name:connection.name,enabled:connection.enabled,
      configuration:connection.configuration,
      metadata:{connectionType:'ARUBA_CENTRAL_CLASSIC'},
    })
    const normalized=await arubaClassicCentralInventorySourceAdapter.loadAndNormalize({
      source,
      input:{
        devices,
        context:{
          customer:connection.configuration.customer,
          businessUnit:connection.configuration.businessUnit,
          sitesByName,
        },
      },
    })
    const staged=await stageImporterV2NormalizedSource({
      source:normalized.source,
      profile:classicCentralRuntimeImporterProfile(sourceId),
      rows:normalized.rows,
      directHierarchyFields:['customer','businessUnit','site'],
      // The adapter only publishes selected site scopes. Scope deselection
      // never deletes or ages out canonical records.
      isFullInventoryExport:false,
    })
    const automation=await initializeImporterV2WorkspaceAutomation(staged.batch.id)
    const autoPublication=await autoPublishImporterV2SafeValidRows(staged.batch.id)
    const syncRun=await completeInventorySyncRun({
      runId:run.id,status:'SUCCEEDED',batchId:staged.batch.id,
      fetchedCount:fetched.length,stagedCount:devices.length,
      autoPublishedCount:autoPublication.publishedLogicalDeviceCount??0,
      reviewRequiredCount:autoPublication.remainingIncludedRows??0,
      metadata:{
        scopeMode:connection.configuration.scopeMode,
        selectedSiteCount:enabledSites.length,
        excludedFromScopeCount:fetched.length-devices.length,
        unattended:options.trigger==='SCHEDULED',
        skippedForReview:autoPublication.remainingIncludedRows??0,
      },
    })
    return {
      ...staged,automation,autoPublication,syncRun,
      source:{
        id:sourceId,sourceAdapterId:connection.sourceAdapterId,
        deviceCount:devices.length,observedDeviceCount:fetched.length,
        selectedSiteCount:enabledSites.length,scopeMode:connection.configuration.scopeMode,partial:false,
      },
    }
  } catch(error) {
    await failInventorySyncRun(run.id,error)
    throw error
  }
}
