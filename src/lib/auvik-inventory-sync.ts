import { listAuvikDevicesV2 } from '@/lib/auvik-api-client'
import {
  getAuvikInventoryConnectionCredentials,
  type AuvikInventoryConnectionConfiguration,
} from '@/lib/auvik-integration-store'
import { normalizeInventorySourceDefinition } from '@/lib/inventory-source-adapter'
import {
  stageImporterV2NormalizedSource,
  type ImporterV2NormalizedSourceProfile,
} from '@/lib/importer-v2-ingestion-store'
import { IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE } from '@/lib/importer-v2-hierarchy'
import {
  AUVIK_API_PROVIDER,
  AUVIK_API_V2_ADAPTER_TYPE,
  auvikApiV2InventorySourceAdapter,
} from '@/lib/importer-v2-auvik-api'
import { initializeImporterV2WorkspaceAutomation } from '@/lib/importer-v2-workspace-maintenance'
import { autoPublishImporterV2SafeValidRows } from '@/lib/importer-v2-auto-publication'
import {
  beginInventorySyncRun,
  completeInventorySyncRun,
  failInventorySyncRun,
  updateInventorySyncRunProgress,
  type InventorySyncTrigger,
} from '@/lib/inventory-sync-run-store'

export function auvikApiRuntimeImporterProfile(input: {
  sourceId: string
  version?: string
}): ImporterV2NormalizedSourceProfile {
  return {
    id: input.sourceId,
    version: input.version ?? 'auvik-api-v2-profile-v1',
    hierarchyTemplate: structuredClone(
      IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
    ),
    deviceTypePolicy: {
      version: 'auvik-api-v2-device-types-v1',
      defaultAction: 'INCLUDE',
      rules: [],
    },
    defaults: {},
    exactValueAliases: [],
  }
}

export type AuvikSyncProgress = {
  phase: 'FETCHING' | 'NORMALIZING' | 'STAGING' | 'AUTOMATION' | 'PUBLISHING'
  tenantsCompleted: number
  tenantsTotal: number
  tenantsFailed: number
}

/** Bound Auvik fan-out to protect the provider's shared MSP API quota. */
const MAX_PARALLEL_AUVIK_TENANTS = 4

export function configuredAuvikTenantScopes(
  configuration: AuvikInventoryConnectionConfiguration,
) {
  const enabled = configuration.tenants.filter(
    (tenant) =>
      tenant.enabled !== false &&
      !((tenant.tenantType ?? '')
        .toLocaleLowerCase('en-US')
        .includes('multi')),
  )
  if (enabled.length === 0) {
    throw new Error(
      'Configure at least one Auvik tenant scope before synchronizing inventory.',
    )
  }
  return enabled
}

async function runAuvikInventorySyncCore(
  sourceId: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    onProgress?: (progress: AuvikSyncProgress) => Promise<void>
  } = {},
) {
  const { connection, credentials } =
    await getAuvikInventoryConnectionCredentials(sourceId)
  if (!connection.enabled) {
    throw new Error(
      'Enable the Auvik connection after a successful connection test before synchronizing inventory.',
    )
  }
  if (connection.connectionTest.status !== 'SUCCESS') {
    throw new Error(
      'Test the Auvik connection successfully before synchronizing inventory.',
    )
  }
  const tenantScopes = configuredAuvikTenantScopes(connection.configuration)

  // Reserve fixed slots to preserve configured tenant ordering across
  // concurrent requests (and therefore deterministic staged row identity).
  const successful: Array<{
    context: (typeof tenantScopes)[number]
    devices: Awaited<ReturnType<typeof listAuvikDevicesV2>>
  } | null> = Array.from({ length: tenantScopes.length }, () => null)
  const errors: Array<{ tenantId: string; error: string } | null> =
    Array.from({ length: tenantScopes.length }, () => null)
  let nextIndex = 0
  let completed = 0
  let failed = 0
  await options.onProgress?.({
    phase: 'FETCHING', tenantsCompleted: 0,
    tenantsTotal: tenantScopes.length, tenantsFailed: 0,
  })
  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= tenantScopes.length) return
      const context = tenantScopes[index]
      try {
        const devices = await listAuvikDevicesV2({
          region: connection.configuration.region,
          credentials,
          tenantId: context.tenantId,
          fetchImpl: options.fetchImpl,
          signal: options.signal,
        })
        successful[index] = { context, devices }
      } catch (error) {
        errors[index] = {
          tenantId: context.tenantId,
          error: error instanceof Error ? error.message : 'Auvik tenant inventory failed.',
        }
        failed += 1
      }
      completed += 1
      if (completed % 10 === 0 || completed === tenantScopes.length) {
        await options.onProgress?.({
          phase: 'FETCHING', tenantsCompleted: completed,
          tenantsTotal: tenantScopes.length, tenantsFailed: failed,
        })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL_AUVIK_TENANTS, tenantScopes.length) }, () => worker()),
  )
  const tenants = successful.filter((item): item is NonNullable<typeof item> => item !== null)
  const failures = errors.filter((item): item is NonNullable<typeof item> => item !== null)
  if (tenants.length === 0 && failures.length > 0) {
    throw new Error(`Auvik inventory failed for all enabled tenants: ${failures.map((failure) => failure.tenantId).join(', ')}.`)
  }

  const reportPhase = async (phase: AuvikSyncProgress['phase']) => {
    await options.onProgress?.({
      phase, tenantsCompleted: completed,
      tenantsTotal: tenantScopes.length, tenantsFailed: failed,
    })
  }
  await reportPhase('NORMALIZING')
  const source = normalizeInventorySourceDefinition({
    id: connection.id,
    provider: AUVIK_API_PROVIDER,
    adapterType: AUVIK_API_V2_ADAPTER_TYPE,
    sourceAdapterId: connection.sourceAdapterId,
    name: connection.name,
    enabled: connection.enabled,
    configuration: connection.configuration,
    metadata: {
      connectionType: 'AUVIK_API_V2',
    },
  })
  const normalized = await auvikApiV2InventorySourceAdapter.loadAndNormalize({
    source,
    input: { tenants },
  })

  await reportPhase('STAGING')
  const result = await stageImporterV2NormalizedSource({
    source: normalized.source,
    profile: auvikApiRuntimeImporterProfile({
      sourceId: connection.id,
    }),
    rows: normalized.rows,
    directHierarchyFields: ['customer', 'businessUnit', 'site'],
    isFullInventoryExport: failures.length === 0,
  })
  await reportPhase('AUTOMATION')
  const automation = await initializeImporterV2WorkspaceAutomation(
    result.batch.id,
  )
  await reportPhase('PUBLISHING')
  const autoPublication = await autoPublishImporterV2SafeValidRows(
    result.batch.id,
  )

  return {
    ...result,
    automation,
    autoPublication,
    source: {
      id: connection.id,
      sourceAdapterId: connection.sourceAdapterId,
      tenantCount: tenants.length,
      configuredTenantCount: tenantScopes.length,
      deviceCount: normalized.rows.length,
      partial: failures.length > 0,
      failures,
    },
  }
}

/** Both manual requests and scheduled jobs use the same durable run ledger. */
export async function runAuvikInventorySync(
  sourceId: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    trigger?: InventorySyncTrigger
  } = {},
) {
  const run = await beginInventorySyncRun(sourceId, options.trigger ?? 'MANUAL')
  try {
    const result = await runAuvikInventorySyncCore(sourceId, {
      ...options,
      onProgress: (progress) => updateInventorySyncRunProgress(run.id, progress),
    })
    const syncRun = await completeInventorySyncRun({
      runId: run.id,
      status: result.source.partial ? 'PARTIAL' : 'SUCCEEDED',
      batchId: result.batch.id,
      fetchedCount: result.source.deviceCount,
      stagedCount: result.source.deviceCount,
      autoPublishedCount: result.autoPublication.publishedLogicalDeviceCount ?? 0,
      reviewRequiredCount: result.autoPublication.remainingIncludedRows ?? 0,
      errorCount: result.source.failures.length,
      failureSummary: result.source.failures,
      metadata: {
        tenantCount: result.source.tenantCount,
        configuredTenantCount: result.source.configuredTenantCount,
        unattended: options.trigger === 'SCHEDULED',
        skippedForReview: result.autoPublication.remainingIncludedRows ?? 0,
      },
    })
    return { ...result, syncRun }
  } catch (error) {
    await failInventorySyncRun(run.id, error)
    throw error
  }
}
