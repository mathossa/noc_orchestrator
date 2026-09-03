import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  rowFindMany: vi.fn(),
  applyRowAction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique },
    deviceImportStagedRow: { findMany: mocks.rowFindMany },
  },
}))

vi.mock('@/lib/device-import-staged-rules', () => ({
  applyDeviceImportRowAction: mocks.applyRowAction,
}))

import { applyDeviceImportBlockedRepair } from '@/lib/device-import-staged-repairs'

function row(rowNumber: number, customer: string, site: string, model = 'AP205H') {
  return {
    rowNumber,
    mappedData: {
      customer,
      site,
      model,
    },
  }
}

describe('blocked multi-platform repairs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ id: 'batch-1', status: 'PARTIAL' })
    mocks.rowFindMany.mockResolvedValue([
      row(10, 'Customer A', 'Site 1'),
      row(11, 'Customer A', 'Site 1'),
      row(12, 'Customer A', 'Site 2'),
      row(13, 'Customer B', 'Site 1'),
      row(14, 'Customer A', 'Site 1', 'AP315'),
    ])
    mocks.applyRowAction.mockResolvedValue({ affected: 1, workspace: {} })
  })

  it('applies a platform only to the same customer, site and model', async () => {
    await applyDeviceImportBlockedRepair({
      batchId: 'batch-1',
      scope: 'SAME_SITE_MODEL_AS_ROW',
      action: 'SET_FIELD',
      editField: 'platform',
      editValue: 'AOS-8',
      sampleRowNumber: 10,
    })

    expect(mocks.applyRowAction).toHaveBeenCalledWith({
      batchId: 'batch-1',
      action: 'SET_FIELD',
      editField: 'platform',
      editValue: 'AOS-8',
      rowNumbers: [10, 11],
    })
  })

  it('applies a platform across sites only for the same customer and model', async () => {
    await applyDeviceImportBlockedRepair({
      batchId: 'batch-1',
      scope: 'SAME_CUSTOMER_MODEL_AS_ROW',
      action: 'SET_FIELD',
      editField: 'platform',
      editValue: 'AOS-10',
      sampleRowNumber: 10,
    })

    expect(mocks.applyRowAction).toHaveBeenCalledWith({
      batchId: 'batch-1',
      action: 'SET_FIELD',
      editField: 'platform',
      editValue: 'AOS-10',
      rowNumbers: [10, 11, 12],
    })
  })
})
