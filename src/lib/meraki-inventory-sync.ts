import { listMerakiOrganizationDevices } from '@/lib/meraki-api-client'
import {
  getMerakiInventoryConnectionCredentials,
  type MerakiInventoryConnectionConfiguration,
} from '@/lib/meraki-integration-store'
import { normalizeInventorySourceDefinition } from '@/lib/inventory-source-adapter'
import {
  stageImporterV2NormalizedSource,
  type ImporterV2NormalizedSourceProfile,
} from '@/lib/importer-v2-ingestion-store'
import { IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE } from '@/lib/importer-v2-hierarchy'
import {
  MERAKI_API_PROVIDER,
  MERAKI_DASHBOARD_API_ADAPTER_TYPE,
  merakiDashboardInventorySourceAdapter,
} from '@/lib/importer-v2-meraki-api'
import { initializeImporterV2WorkspaceAutomation } from '@/lib/importer-v2-workspace-maintenance'
import { autoPublishImporterV2SafeValidRows } from '@/lib/importer-v2-auto-publication'

export function merakiApiRuntimeImporterProfile(input: {
  sourceId: string
  version?: string
}): ImporterV2NormalizedSourceProfile {
  return {
    id: input.sourceId,
    version: input.version ?? 'meraki-dashboard-api-v1-profile-v1',
    hierarchyTemplate: structuredClone(
      IMPORTER_V2_CUSTOMER_BUSINESS_UNIT_SITE_TEMPLATE,
    ),
    deviceTypePolicy: {
      version: 'meraki-dashboard-api-v1-device-types-v1',
      defaultAction: 'INCLUDE',
      rules: [],
    },
    defaults: {},
    exactValueAliases: [],
  }
}

function configuredOrganizations(
  configuration: MerakiInventoryConnectionConfiguration,
) {
  if (configuration.organizations.length === 0) {
    throw new Error(
      'Configure at least one Meraki organization before synchronizing inventory.',
    )
  }
  return configuration.organizations
}

export async function runMerakiInventorySync(
  sourceId: string,
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  } = {},
) {
  const { connection, credentials } =
    await getMerakiInventoryConnectionCredentials(sourceId)
  if (!connection.enabled) {
    throw new Error(
      'Enable the Meraki connection after a successful connection test before synchronizing inventory.',
    )
  }
  if (connection.connectionTest.status !== 'SUCCESS') {
    throw new Error(
      'Test the Meraki connection successfully before synchronizing inventory.',
    )
  }

  const scopes = configuredOrganizations(connection.configuration)
  const organizations = []
  const failures: Array<{ organizationId: string; error: string }> = []

  for (const context of scopes) {
    try {
      const fetched = await listMerakiOrganizationDevices({
        environment: connection.configuration.environment,
        credentials,
        organizationId: context.organizationId,
        fetchImpl: options.fetchImpl,
        signal: options.signal,
      })
      const allowedNetworkIds = new Set(context.networks.map((network) => network.networkId))
      const devices =
        allowedNetworkIds.size === 0
          ? fetched
          : fetched.filter((device) => allowedNetworkIds.has(device.networkId))
      organizations.push({ context, devices })
    } catch (error) {
      failures.push({
        organizationId: context.organizationId,
        error:
          error instanceof Error
            ? error.message
            : 'Meraki organization inventory failed.',
      })
    }
  }

  if (organizations.length === 0 && failures.length > 0) {
    throw new Error(
      \`Meraki inventory failed for all configured organizations: \${failures
        .map((failure) => failure.organizationId)
        .join(', ')}.\`,
    )
  }

  const source = normalizeInventorySourceDefinition({
    id: connection.id,
    provider: MERAKI_API_PROVIDER,
    adapterType: MERAKI_DASHBOARD_API_ADAPTER_TYPE,
    sourceAdapterId: connection.sourceAdapterId,
    name: connection.name,
    enabled: connection.enabled,
    configuration: connection.configuration,
    metadata: {
      connectionType: 'MERAKI_DASHBOARD_API_V1',
    },
  })
  const normalized = await merakiDashboardInventorySourceAdapter.loadAndNormalize({
    source,
    input: { organizations },
  })

  const result = await stageImporterV2NormalizedSource({
    source: normalized.source,
    profile: merakiApiRuntimeImporterProfile({ sourceId: connection.id }),
    rows: normalized.rows,
    directHierarchyFields: ['customer', 'businessUnit', 'site'],
    isFullInventoryExport: failures.length === 0,
  })
  const automation = await initializeImporterV2WorkspaceAutomation(result.batch.id)
  const autoPublication = await autoPublishImporterV2SafeValidRows(result.batch.id)

  return {
    ...result,
    automation,
    autoPublication,
    source: {
      id: connection.id,
      sourceAdapterId: connection.sourceAdapterId,
      organizationCount: organizations.length,
      configuredOrganizationCount: scopes.length,
      deviceCount: normalized.rows.length,
      partial: failures.length > 0,
      failures,
    },
  }
}
