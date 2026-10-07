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

function configuredTenantScopes(
  configuration: AuvikInventoryConnectionConfiguration,
) {
  if (configuration.tenants.length === 0) {
    throw new Error(
      'Configure at least one Auvik tenant scope before synchronizing inventory.',
    )
  }
  return configuration.tenants
}

export async function runAuvikInventorySync(
  sourceId: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
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
  const tenantScopes = configuredTenantScopes(connection.configuration)

  const tenants = []
  for (const context of tenantScopes) {
    const devices = await listAuvikDevicesV2({
      region: connection.configuration.region,
      credentials,
      tenantId: context.tenantId,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    })
    tenants.push({ context, devices })
  }

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

  const result = await stageImporterV2NormalizedSource({
    source: normalized.source,
    profile: auvikApiRuntimeImporterProfile({
      sourceId: connection.id,
    }),
    rows: normalized.rows,
    directHierarchyFields: ['customer', 'businessUnit', 'site'],
    isFullInventoryExport: true,
  })
  const automation = await initializeImporterV2WorkspaceAutomation(
    result.batch.id,
  )
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
      deviceCount: normalized.rows.length,
    },
  }
}
