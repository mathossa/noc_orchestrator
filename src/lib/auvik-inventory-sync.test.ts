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

vi.mock('@/lib/auvik-integration-store', () => ({
  getAuvikInventoryConnectionCredentials: mocks.getConnectionCredentials,
}))

vi.mock('@/lib/auvik-api-client', () => ({
  listAuvikDevicesV2: mocks.listDevices,
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

import { runAuvikInventorySync } from '@/lib/auvik-inventory-sync'

describe('Auvik inventory sync orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.beginRun.mockResolvedValue({ id: 'run-1' })
    mocks.completeRun.mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', trigger: 'MANUAL' })
    mocks.getConnectionCredentials.mockResolvedValue({
      connection: {
        id: 'source-1',
        name: 'Auvik production',
        enabled: true,
        provider: 'AUVIK',
        adapterType: 'auvik-api-v2',
        sourceAdapterId: 'auvik-api-v2:source-1',
        credentialsConfigured: true,
        connectionTest: {
          status: 'SUCCESS',
          testedAt: '2026-10-02T12:00:00.000Z',
          httpStatus: null,
          suggestedRegion: null,
        },
        configuration: {
          version: 1,
          region: 'eu1',
          tenants: [
            {
              tenantId: 'tenant-a',
              customer: 'Customer A',
              site: 'Site A',
            },
            {
              tenantId: 'tenant-b',
              customer: 'Customer B',
              site: 'Site B',
            },
          ],
        },
      },
      credentials: {
        username: 'service@example.com',
        apiKey: 'secret',
      },
    })
    mocks.listDevices.mockImplementation(
      async ({ tenantId }: { tenantId: string }) => [
        {
          type: 'device',
          id: `device-${tenantId}`,
          attributes: {
            deviceName: `SW-${tenantId}`,
            make: 'Cisco',
            model: 'C9300-24P',
            deviceTypeDescription: 'Switch',
          },
        },
      ],
    )
    mocks.stageNormalized.mockResolvedValue({
      batch: {
        id: 'batch-1',
        name: 'Auvik production',
        rowCount: 2,
        status: 'RECONCILING',
      },
      profile: {
        id: 'source-1',
        version: 'auvik-api-v2-profile-v1',
      },
      evaluation: {
        fingerprint: 'evaluation-1',
        firmwareInterpreterVersion: 'firmware-1',
        firmwareCompatibilityVersion: 'compat-1',
      },
    })
    mocks.initializeAutomation.mockResolvedValue({
      automaticDecisionsApplied: 0,
    })
    mocks.autoPublishValid.mockResolvedValue({
      status: 'PUBLISHED',
      publishedLogicalDeviceCount: 2,
      publishedRowCount: 2,
      remainingIncludedRows: 0,
      reconciliationRequired: false,
      blockedRowNumbers: [],
      error: null,
    })
  })

  it('fans out tenants and stages one shared Importer v2 batch', async () => {
    const result = await runAuvikInventorySync('source-1')

    expect(mocks.listDevices).toHaveBeenCalledTimes(2)
    expect(mocks.listDevices).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu1',
        tenantId: 'tenant-a',
      }),
    )
    expect(mocks.listDevices).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'eu1',
        tenantId: 'tenant-b',
      }),
    )

    expect(mocks.stageNormalized).toHaveBeenCalledTimes(1)
    expect(mocks.stageNormalized).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          id: 'source-1',
          provider: 'AUVIK',
          adapterType: 'auvik-api-v2',
          sourceAdapterId: 'auvik-api-v2:source-1',
        }),
        profile: expect.objectContaining({
          id: 'source-1',
        }),
        directHierarchyFields: ['customer', 'businessUnit', 'site'],
        isFullInventoryExport: true,
        rows: [
          expect.objectContaining({
            rowNumber: 1,
            rawValues: expect.objectContaining({
              customer: 'Customer A',
              site: 'Site A',
              sourceId: 'device-tenant-a',
            }),
          }),
          expect.objectContaining({
            rowNumber: 2,
            rawValues: expect.objectContaining({
              customer: 'Customer B',
              site: 'Site B',
              sourceId: 'device-tenant-b',
            }),
          }),
        ],
      }),
    )
    expect(mocks.initializeAutomation).toHaveBeenCalledWith('batch-1')
    expect(mocks.autoPublishValid).toHaveBeenCalledWith('batch-1')
    expect(result.autoPublication).toMatchObject({
      status: 'PUBLISHED',
      publishedLogicalDeviceCount: 2,
      reconciliationRequired: false,
    })
    expect(result.source).toMatchObject({
      id: 'source-1',
      sourceAdapterId: 'auvik-api-v2:source-1',
      tenantCount: 2,
      configuredTenantCount: 2,
      deviceCount: 2,
      partial: false,
      failures: [],
    })
    expect(mocks.beginRun).toHaveBeenCalledWith('source-1', 'MANUAL')
    expect(mocks.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1', status: 'SUCCEEDED', autoPublishedCount: 2,
    }))
  })

  it('skips disabled tenants and records a scheduled unattended run without human confirmation', async () => {
    const existing = await mocks.getConnectionCredentials()
    mocks.getConnectionCredentials.mockResolvedValueOnce({
      ...existing,
      connection: {
        ...existing.connection,
        configuration: {
          ...existing.connection.configuration,
          tenants: [
            { tenantId: 'tenant-a', enabled: true, customer: 'Customer A', site: 'Site A' },
            { tenantId: 'tenant-b', enabled: false, customer: 'Customer B', site: 'Site B' },
          ],
        },
      },
    })
    const result = await runAuvikInventorySync('source-1', { trigger: 'SCHEDULED' })
    expect(mocks.listDevices).toHaveBeenCalledTimes(1)
    expect(mocks.listDevices).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }))
    expect(mocks.beginRun).toHaveBeenCalledWith('source-1', 'SCHEDULED')
    expect(mocks.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'SUCCEEDED',
      metadata: expect.objectContaining({ unattended: true, tenantCount: 1 }),
    }))
    expect(result.source.tenantCount).toBe(1)
  })

  it('stages successful tenants only and marks a partial run as a non-full export', async () => {
    mocks.listDevices.mockRejectedValueOnce(new Error('Auvik API request failed with HTTP 503.'))
    const result = await runAuvikInventorySync('source-1', { trigger: 'SCHEDULED' })
    expect(result.source).toMatchObject({ partial: true, tenantCount: 1 })
    expect(result.source.failures).toEqual([
      { tenantId: 'tenant-a', error: 'Auvik API request failed with HTTP 503.' },
    ])
    expect(mocks.stageNormalized).toHaveBeenCalledWith(expect.objectContaining({
      isFullInventoryExport: false,
    }))
    expect(mocks.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PARTIAL', errorCount: 1,
    }))
  })

  it('marks unsuccessful runs failed rather than publishing incomplete information', async () => {
    mocks.listDevices.mockRejectedValue(new Error('Auvik unavailable'))
    await expect(runAuvikInventorySync('source-1', { trigger: 'SCHEDULED' }))
      .rejects.toThrow('Auvik inventory failed for all enabled tenants')
    expect(mocks.stageNormalized).not.toHaveBeenCalled()
    expect(mocks.failRun).toHaveBeenCalledWith('run-1', expect.any(Error))
  })

  it('refuses sync until the connection is tested and enabled', async () => {
    mocks.getConnectionCredentials.mockResolvedValueOnce({
      connection: {
        id: 'source-1',
        name: 'Auvik',
        enabled: false,
        sourceAdapterId: 'auvik-api-v2:source-1',
        connectionTest: {
          status: 'SUCCESS',
        },
        configuration: {
          version: 1,
          region: 'eu1',
          tenants: [{ tenantId: 'tenant-a' }],
        },
      },
      credentials: { username: 'service', apiKey: 'secret' },
    })

    await expect(runAuvikInventorySync('source-1')).rejects.toThrow(
      'Enable the Auvik connection',
    )
    expect(mocks.listDevices).not.toHaveBeenCalled()
  })
})
