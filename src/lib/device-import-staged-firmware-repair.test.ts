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
    deviceImportBatch: {
      findUnique: mocks.batchFindUnique,
      update: mocks.batchUpdate,
    },
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

describe('staged running-firmware repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ id: 'batch-1', status: 'STAGED', settings: {} })
    mocks.batchUpdate.mockResolvedValue({})
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
    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: {
        settings: expect.objectContaining({ _runningFirmwareRepairVersion: 2 }),
      },
    })
  })

  it('replaces Cisco ROMMON with the raw running Software Version', async () => {
    mocks.rowFindMany.mockResolvedValue([
      {
        id: 'row-rommon',
        rowNumber: 12,
        mappedData: {
          vendor: 'Cisco',
          model: 'Cisco C9800-L-F',
          currentFirmware: '16.12(3r)',
          firmwareVersion: '16.12(3r)',
          softwareVersion: '17.12.5',
        },
      },
    ])
    mocks.rowUpdate.mockReturnValue({ operation: 'update' })

    await expect(
      repairPlaceholderDeviceImportFirmware('batch-1'),
    ).resolves.toEqual({ repaired: 1 })
    expect(mocks.refreshAffected).toHaveBeenCalledWith('batch-1', [
      expect.objectContaining({
        delta: -1,
        mappedData: expect.objectContaining({ currentFirmware: '16.12(3r)' }),
      }),
      expect.objectContaining({
        delta: 1,
        mappedData: expect.objectContaining({ currentFirmware: '17.12.5' }),
      }),
    ])
  })

  it('does not rescan rows after this repair version has already run', async () => {
    mocks.batchFindUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'STAGED',
      settings: { _runningFirmwareRepairVersion: 2 },
    })

    await expect(
      repairPlaceholderDeviceImportFirmware('batch-1'),
    ).resolves.toEqual({ repaired: 0 })
    expect(mocks.rowFindMany).not.toHaveBeenCalled()
    expect(mocks.batchUpdate).not.toHaveBeenCalled()
  })
})
