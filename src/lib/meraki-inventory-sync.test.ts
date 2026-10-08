import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConnectionCredentials: vi.fn(),
  listDevices: vi.fn(),
  stageNormalized: vi.fn(),
  initializeAutomation: vi.fn(),
  autoPublishValid: vi.fn(),
  beginRun: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}))

vi.mock('@/lib/inventory-sync-run-store', () => ({
  beginInventorySyncRun: mocks.beginRun,
  completeInventorySyncRun: mocks.completeRun,
  failInventorySyncRun: mocks.failRun,
}))

vi.mock('@/lib/meraki-integration-store', () => ({
  getMerakiInventoryConnectionCredentials: mocks.getConnectionCredentials,
}))
vi.mock('@/lib/meraki-api-client', () => ({
  listMerakiOrganizationDevices: mocks.listDevices,
}))
vi.mock('@/lib/importer-v2-ingestion-store', () => ({
  stageImporterV2NormalizedSource: mocks.stageNormalized,
}))
vi.mock('@/lib/importer-v2-workspace-maintenance', () => ({
  initializeImporterV2WorkspaceAutomation: mocks.initializeAutomation,
}))
vi.mock('@/lib/importer-v2-auto-publication', () => ({
  autoPublishImporterV2SafeValidRows: mocks.autoPublishValid,
}))

import { runMerakiInventorySync } from '@/lib/meraki-inventory-sync'

describe('Meraki inventory sync orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.beginRun.mockResolvedValue({ id: 'run-1' })
    mocks.completeRun.mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED' })
    mocks.getConnectionCredentials.mockResolvedValue({
      connection: {
        id: 'source-1',
        name: 'Meraki production',
        enabled: true,
        sourceAdapterId: 'meraki-dashboard-api-v1:source-1',
        connectionTest: { status: 'SUCCESS' },
        configuration: {
          version: 1,
          environment: 'global',
          organizations: [
            {
              organizationId: 'org-a',
              organizationName: 'Org A',
              customer: 'Customer A',
              businessUnit: null,
              networks: [
                { networkId: 'N1', networkName: 'Site A', site: 'Site A' },
              ],
            },
          ],
        },
      },
      credentials: { apiKey: 'secret' },
    })
    mocks.listDevices.mockResolvedValue([
      {
        networkId: 'N1',
        serial: 'Q1',
        model: 'MR36',
        productType: 'wireless',
      },
      {
        networkId: 'N2',
        serial: 'Q2',
        model: 'MR36',
        productType: 'wireless',
      },
    ])
    mocks.stageNormalized.mockResolvedValue({
      batch: { id: 'batch-1' },
      profile: { id: 'source-1' },
      evaluation: {},
    })
    mocks.initializeAutomation.mockResolvedValue({})
    mocks.autoPublishValid.mockResolvedValue({
      status: 'PUBLISHED',
      publishedLogicalDeviceCount: 1,
      remainingIncludedRows: 0,
      reconciliationRequired: false,
    })
  })

  it('filters configured networks and stages through the shared Importer v2 path', async () => {
    const result = await runMerakiInventorySync('source-1')
    expect(mocks.stageNormalized).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          provider: 'MERAKI',
          adapterType: 'meraki-dashboard-api-v1',
        }),
        isFullInventoryExport: true,
        rows: [
          expect.objectContaining({
            rawValues: expect.objectContaining({
              sourceId: 'Q1',
              serialNumber: 'Q1',
              site: 'Site A',
            }),
          }),
        ],
      }),
    )
    expect(result.source).toMatchObject({
      organizationCount: 1,
      deviceCount: 1,
      partial: false,
    })
  })

  it('marks partial multi-organization runs as non-full exports', async () => {
    const base = await mocks.getConnectionCredentials()
    mocks.getConnectionCredentials.mockResolvedValueOnce({
      ...base,
      connection: {
        ...base.connection,
        configuration: {
          ...base.connection.configuration,
          organizations: [
            ...base.connection.configuration.organizations,
            {
              organizationId: 'org-b',
              organizationName: 'Org B',
              customer: 'Customer B',
              businessUnit: null,
              networks: [],
            },
          ],
        },
      },
    })
    mocks.listDevices
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Meraki Dashboard API request failed with HTTP 503.'))

    const result = await runMerakiInventorySync('source-1')
    expect(mocks.stageNormalized).toHaveBeenCalledWith(
      expect.objectContaining({ isFullInventoryExport: false }),
    )
    expect(result.source.partial).toBe(true)
    expect(result.source.failures).toHaveLength(1)
  })
})
