import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  batchUpdate: vi.fn(),
  referenceFindMany: vi.fn(),
  referenceDeleteMany: vi.fn(),
  referenceCreateMany: vi.fn(),
  transaction: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique, update: mocks.batchUpdate },
    deviceImportStagedReference: { findMany: mocks.referenceFindMany },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/device-import-staging-store', () => ({ refreshDeviceImportBatchReferences: mocks.refresh }))

import { repairDuplicateDeviceImportModelReferences } from '@/lib/device-import-staged-model-dedup'

describe('staged Model reference identity repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ status: 'STAGED', settings: {} })
    mocks.batchUpdate.mockResolvedValue({})
    mocks.referenceFindMany.mockResolvedValue([
      { id: 'one', sourceValue: 'Cisco WS-C2960X-24PS-L', normalizedSourceValue: 'cisco ws-c2960x-24ps-l', contextKey: 'vendor:cisco|type:switch', metadata: { vendorSourceValue: 'Cisco', vendorTargetId: 'vendor-cisco', deviceTypeSourceValue: 'Switch', deviceTypeTargetId: 'type-switch', rowNumbers: [10, 11] }, status: 'UNRESOLVED', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null, occurrenceCount: 2 },
      { id: 'two', sourceValue: 'Cisco WS-C2960X-24PS-L', normalizedSourceValue: 'cisco ws-c2960x-24ps-l', contextKey: 'vendor:cisco|type:stack', metadata: { vendorSourceValue: 'Cisco', vendorTargetId: 'vendor-cisco', deviceTypeSourceValue: 'Stack', deviceTypeTargetId: 'type-switch', rowNumbers: [12] }, status: 'LINKED', targetId: 'model-2960', suggestedTargetId: null, suggestionScore: null, resolutionSource: 'USER', occurrenceCount: 1 },
      { id: 'three', sourceValue: 'Cisco WS-C2960X-24PS-L', normalizedSourceValue: 'cisco ws-c2960x-24ps-l', contextKey: 'vendor:cisco|type:switches', metadata: { vendorSourceValue: 'Cisco', vendorTargetId: 'vendor-cisco', deviceTypeSourceValue: 'Switches', deviceTypeTargetId: 'type-switch', rowNumbers: [13, 14] }, status: 'UNRESOLVED', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null, occurrenceCount: 2 },
    ])
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      deviceImportStagedReference: { deleteMany: mocks.referenceDeleteMany, createMany: mocks.referenceCreateMany },
    }))
    mocks.referenceDeleteMany.mockResolvedValue({ count: 3 })
    mocks.referenceCreateMany.mockResolvedValue({ count: 1 })
    mocks.refresh.mockResolvedValue({})
  })

  it('merges duplicate type-scoped Model references and preserves the reviewed target', async () => {
    await expect(repairDuplicateDeviceImportModelReferences('batch-1')).resolves.toBe(1)
    expect(mocks.referenceDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['one', 'two', 'three'] } } })
    expect(mocks.referenceCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      id: 'one',
      contextKey: 'vendor:cisco',
      occurrenceCount: 5,
      status: 'LINKED',
      targetId: 'model-2960',
      resolutionSource: 'USER',
      metadata: expect.objectContaining({
        vendorTargetId: 'vendor-cisco',
        deviceTypeTargetId: 'type-switch',
        deviceTypeSourceValues: ['Switch', 'Stack', 'Switches'],
        rowNumbers: [10, 11, 12, 13, 14],
      }),
    })] })
    expect(mocks.refresh).toHaveBeenCalledWith('batch-1')
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'batch-1' } }))
  })
})
