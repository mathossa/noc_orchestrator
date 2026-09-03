import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  batchUpdate: vi.fn(),
  rowFindMany: vi.fn(),
  rowUpdate: vi.fn(),
  transaction: vi.fn(),
  refreshAffected: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique, update: mocks.batchUpdate },
    deviceImportStagedRow: {
      findMany: mocks.rowFindMany,
      update: mocks.rowUpdate,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/device-import-staged-rules', () => ({
  refreshAffectedReferences: mocks.refreshAffected,
}))

import { repairPlaceholderDeviceImportFirmware } from '@/lib/device-import-staged-firmware-repair'

describe('staged placeholder firmware clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ id: 'batch-1', status: 'STAGED', settings: {} })
    mocks.batchUpdate.mockResolvedValue({})
    mocks.transaction.mockResolvedValue([])
    mocks.refreshAffected.mockResolvedValue({})
  })

  it('clears an unresolved placeholder when no meaningful Software Version exists', async () => {
    mocks.rowFindMany.mockResolvedValue([
      {
        id: 'row-1',
        rowNumber: 9,
        mappedData: {
          currentFirmware: '0',
          firmwareVersion: '0',
          softwareVersion: null,
        },
      },
    ])
    mocks.rowUpdate.mockReturnValue({ operation: 'update' })

    await expect(
      repairPlaceholderDeviceImportFirmware('batch-1'),
    ).resolves.toEqual({ repaired: 1 })
    expect(mocks.rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: {
        mappedData: expect.objectContaining({ currentFirmware: null }),
      },
    })
    expect(mocks.refreshAffected).toHaveBeenCalledWith('batch-1', [
      expect.objectContaining({
        rowNumber: 9,
        delta: -1,
        mappedData: expect.objectContaining({ currentFirmware: '0' }),
      }),
      expect.objectContaining({
        rowNumber: 9,
        delta: 1,
        mappedData: expect.objectContaining({ currentFirmware: null }),
      }),
    ])
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'batch-1' } }))
  })
})
