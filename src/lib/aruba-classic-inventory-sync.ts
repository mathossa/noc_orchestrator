import {
  listClassicCentralDevices,
  type ClassicCentralDeviceKind,
  type ClassicCentralDeviceObservation,
} from '@/lib/aruba-classic-central-api-client'
import { filterClassicCentralDevicesBySelectedSites } from '@/lib/aruba-classic-site-scope'
import { recoverClassicSwitchSitesFromVerifiedQueries } from '@/lib/aruba-classic-switch-site-recovery'
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

export type ArubaClassicDeviceKindCounts = Record<ClassicCentralDeviceKind, number>

export function countClassicCentralDeviceKinds(
  rows: readonly ClassicCentralDeviceObservation[],
): ArubaClassicDeviceKindCounts {
  const totals: ArubaClassicDeviceKindCounts = { AP: 0, SWITCH: 0, GATEWAY: 0 }
  for (const row of rows) totals[row.kind] += 1
  return totals
}

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
    // A customer tenant may have more sites than this NOC integration. Never
    // bypass the saved site selection, even if an old connection was stored
    // with the removed ALL_DEVICES flag.
    const customer = connection.configuration.customer?.trim()
    if (!customer) {
      throw new Error('Select the NOC customer before enabling Aruba inventory sync.')
    }
    const enabledSites=connection.configuration.sites.filter(site=>site.enabled)
    if(enabledSites.length===0) {
      throw new Error('Select and save at least one Aruba Central site before syncing.')
    }
    const refresh=await classicCentralRefreshContext(sourceId,credentials)
    const fetched=await listClassicCentralDevices({
      configuration:connection.configuration,
      accessToken:credentials.accessToken,
      refresh,
      fetchImpl:options.fetchImpl,
      signal:options.signal,
    })
    const recovery=await recoverClassicSwitchSitesFromVerifiedQueries({
      observations:fetched,
      selectedSites:connection.configuration.sites,
      // Every probe uses the newest encrypted token, because a prior request
      // can have rotated the Classic refresh token on HTTP 401.
      readSwitchesForSite:async (siteName:string)=>{
        const latest=await getClassicCentralConnectionCredentials(sourceId)
        return listClassicCentralDevices({
          configuration:latest.connection.configuration,
          accessToken:latest.credentials.accessToken,
          refresh:await classicCentralRefreshContext(sourceId,latest.credentials),
          switchSite:siteName,
          fetchImpl:options.fetchImpl,
          signal:options.signal,
        })
      },
    })
    const selection=filterClassicCentralDevicesBySelectedSites(
      recovery.observations,connection.configuration.sites,
    )
    const devices=selection.devices
    const fetchedByType=countClassicCentralDeviceKinds(fetched)
    const selectedByType=countClassicCentralDeviceKinds(devices)
    const excludedByType: ArubaClassicDeviceKindCounts = {
      AP:fetchedByType.AP-selectedByType.AP,
      SWITCH:fetchedByType.SWITCH-selectedByType.SWITCH,
      GATEWAY:fetchedByType.GATEWAY-selectedByType.GATEWAY,
    }
    const sitesByName=Object.fromEntries(enabledSites.flatMap(scope=>
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
        scopeMode:'SELECTED_SITES',
        selectedSiteCount:enabledSites.length,
        excludedFromScopeCount:selection.excludedCount,
        unassignedSiteCount:selection.withoutSiteCount,
        conflictingSiteCount:selection.conflictedSiteCount,
        fetchedByType,
        selectedByType,
        excludedByType,
        switchSiteRecovery:{
          attempted:recovery.attempted,
          serverFilterVerified:recovery.serverFilterVerified,
          recoveredSwitchCount:recovery.recoveredSwitchCount,
          ambiguousSwitchCount:recovery.ambiguousSwitchCount,
          queriedSiteCount:recovery.queriedSiteCount,
          unmatchedQueryRowCount:recovery.unmatchedQueryRowCount,
        },
        unattended:options.trigger==='SCHEDULED',
        skippedForReview:autoPublication.remainingIncludedRows??0,
      },
    })
    return {
      ...staged,automation,autoPublication,syncRun,
      source:{
        id:sourceId,sourceAdapterId:connection.sourceAdapterId,
        deviceCount:devices.length,observedDeviceCount:fetched.length,
        selectedSiteCount:enabledSites.length,scopeMode:'SELECTED_SITES',
        excludedFromScopeCount:selection.excludedCount,
        unassignedSiteCount:selection.withoutSiteCount,
        conflictingSiteCount:selection.conflictedSiteCount,
        fetchedByType,
        selectedByType,
        excludedByType,
        switchSiteRecovery:{
          attempted:recovery.attempted,
          serverFilterVerified:recovery.serverFilterVerified,
          recoveredSwitchCount:recovery.recoveredSwitchCount,
          ambiguousSwitchCount:recovery.ambiguousSwitchCount,
          queriedSiteCount:recovery.queriedSiteCount,
          unmatchedQueryRowCount:recovery.unmatchedQueryRowCount,
        },
        partial:false,
      },
    }
  } catch(error) {
    await failInventorySyncRun(run.id,error)
    throw error
  }
}
