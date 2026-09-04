import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  transaction: vi.fn(),
  snapshotCreate: vi.fn(),
  snapshotRowCreateMany: vi.fn(),
  crosswalkUpsert: vi.fn(),
  deviceUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2DeviceCrosswalk: { findMany: mocks.findMany },
    importerV2SourceSnapshot: { findFirst: mocks.findFirst },
    device: { update: mocks.deviceUpdate },
    $transaction: mocks.transaction,
  },
}))

import {
  findImporterV2IdentityCandidates,
  getLatestSuccessfulImporterV2SourceSnapshot,
  recordSuccessfulImporterV2Publication,
} from '@/lib/importer-v2-identity-store'

describe('Importer v2 identity persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        importerV2SourceSnapshot: { create: mocks.snapshotCreate },
        importerV2SourceSnapshotRow: { createMany: mocks.snapshotRowCreateMany },
        importerV2DeviceCrosswalk: { upsert: mocks.crosswalkUpsert },
      }),
    )
  })

  it('queries provider crosswalks only by normalized durable identity signals', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'crosswalk-1',
        canonicalDeviceId: 'device-1',
        sourceId: 'Auvik-1',
        serialNumber: 'cn123',
        macAddress: 'aa-bb-cc-dd-ee-ff',
      },
    ])

    const result = await findImporterV2IdentityCandidates({
      provider: 'Auvik',
      sourceAdapterId: 'auvik-api-v1',
      identifiers: {
        sourceId: 'Auvik-1',
        serialNumber: 'CN123',
        macAddress: 'AA:BB:CC:DD:EE:FF',
      },
    })

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        provider: 'Auvik',
        OR: [
          { normalizedSourceId: 'Auvik-1' },
          { normalizedSerialNumber: 'CN123' },
          { normalizedMacAddress: 'AABBCCDDEEFF' },
        ],
      },
      orderBy: [{ canonicalDeviceId: 'asc' }, { id: 'asc' }],
    })
    expect(result[0]).toMatchObject({ canonicalDeviceId: 'device-1' })
  })

  it('loads the latest successful source snapshot independent of workbook filename', async () => {
    const publishedAt = new Date('2026-09-04T09:00:00Z')
    mocks.findFirst.mockResolvedValue({
      id: 'snapshot-1',
      provider: 'Auvik',
      sourceAdapterId: 'xlsx-tabular-v1',
      profileVersion: '2',
      evaluationFingerprint: 'evaluation-1',
      isFullInventoryExport: true,
      publishedAt,
      rows: [
        {
          rowNumber: 2,
          canonicalDeviceId: 'device-1',
          sourceId: 'source-1',
          serialNumber: 'SER-1',
          macAddress: null,
          values: { deviceName: 'switch-1' },
        },
      ],
    })

    const result = await getLatestSuccessfulImporterV2SourceSnapshot({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx-tabular-v1',
    })

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { provider: 'Auvik', sourceAdapterId: 'xlsx-tabular-v1' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    })
    expect(result?.rows[0]?.identifiers.sourceId).toBe('source-1')
  })

  it('stores crosswalks and the successful snapshot in one transaction without mutating devices', async () => {
    mocks.snapshotCreate.mockResolvedValue({ id: 'snapshot-1' })
    mocks.snapshotRowCreateMany.mockResolvedValue({ count: 2 })
    mocks.crosswalkUpsert.mockResolvedValue({ id: 'crosswalk-1' })
    const publishedAt = new Date('2026-09-04T09:30:00Z')

    const result = await recordSuccessfulImporterV2Publication({
      provider: 'Auvik',
      sourceAdapterId: 'xlsx-tabular-v1',
      profileVersion: '2',
      evaluationFingerprint: 'evaluation-2',
      isFullInventoryExport: true,
      publishedAt,
      rows: [
        {
          rowNumber: 2,
          canonicalDeviceId: 'device-1',
          sourceRecordKey: 'source-1',
          rowFingerprint: 'row-1',
          identifiers: {
            sourceId: 'source-1',
            serialNumber: 'ser-1',
            macAddress: 'aa:bb:cc:dd:ee:ff',
          },
          values: { deviceName: 'switch-1', currentFirmware: '10.13.1000' },
        },
        {
          rowNumber: 3,
          canonicalDeviceId: null,
          sourceRecordKey: 'ignored-row',
          rowFingerprint: 'row-2',
          identifiers: { sourceId: 'ignored-row' },
          values: { deviceName: 'ignored' },
        },
      ],
    })

    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.snapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        evaluationFingerprint: 'evaluation-2',
        publishedAt,
      }),
      select: { id: true },
    })
    expect(mocks.snapshotRowCreateMany).toHaveBeenCalledTimes(1)
    expect(mocks.crosswalkUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.crosswalkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_canonicalDeviceId: {
            provider: 'Auvik',
            canonicalDeviceId: 'device-1',
          },
        },
        create: expect.objectContaining({
          sourceAdapterId: 'xlsx-tabular-v1',
          normalizedSerialNumber: 'SER-1',
          normalizedMacAddress: 'AABBCCDDEEFF',
        }),
      }),
    )
    expect(mocks.deviceUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ snapshotId: 'snapshot-1', crosswalksPersisted: 1 })
  })
})
