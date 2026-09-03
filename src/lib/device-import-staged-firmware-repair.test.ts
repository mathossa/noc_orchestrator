import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  rowFindMany: vi.fn(),
  rowUpdate: vi.fn(),
  transaction: vi.fn(),
  refreshAffected: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique },
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

describe('staged placeholder firmware repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ id: 'batch-1', status: 'STAGED' })
    mocks.transaction.mockResolvedValue([])
    mocks.refreshAffected.mockResolvedValue({})
  })

  it('replaces 0.1 with the version extracted from raw Software Version', async () => {
    mocks.rowFindMany.mockResolvedValue([
      {
        id: 'row-1',
        rowNumber: 7,
        mappedData: {
          currentFirmware: '0.1',
          firmwareVersion: '0.1',
          softwareVersion: 'Dublin 17.12.04',
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
        mappedData: expect.objectContaining({ currentFirmware: '17.12.04' }),
      },
    })
    expect(mocks.refreshAffected).toHaveBeenCalledWith('batch-1', [
      expect.objectContaining({
        rowNumber: 7,
        delta: -1,
        mappedData: expect.objectContaining({ currentFirmware: '0.1' }),
      }),
      expect.objectContaining({
        rowNumber: 7,
        delta: 1,
        mappedData: expect.objectContaining({ currentFirmware: '17.12.04' }),
      }),
    ])
  })
})
