import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConnectionCredentials: vi.fn(),
  listDevices: vi.fn(),
  stageNormalized: vi.fn(),
  initializeAutomation: vi.fn(),
  autoPublishValid: vi.fn(),
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
    expect(result.source).toEqual({
      id: 'source-1',
      sourceAdapterId: 'auvik-api-v2:source-1',
      tenantCount: 2,
      deviceCount: 2,
    })
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
