import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  rowFindMany: vi.fn(),
  rowGroupBy: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique },
    deviceImportStagedRow: {
      findMany: mocks.rowFindMany,
      groupBy: mocks.rowGroupBy,
    },
  },
}))

import { GET } from '@/app/api/v1/device-import/batches/[batchId]/rows/review/route'

describe('ignored import rows review route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ id: 'batch-1' })
    mocks.rowFindMany.mockResolvedValue([
      { id: 'row-1', rowNumber: 4, status: 'IGNORED', statusReason: 'vendor = Meraki', statusSource: 'PROFILE_RULE', mappedData: { model: 'MS225-24P' } },
    ])
    mocks.rowGroupBy.mockResolvedValue([
      { status: 'IGNORED', _count: { _all: 1 } },
    ])
  })

  it('returns ignored rows with their reason so they can be inspected and restored', async () => {
    const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ batchId: 'batch-1' }) })
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        counts: { IGNORED: 1 },
        rows: [expect.objectContaining({ rowNumber: 4, statusReason: 'vendor = Meraki' })],
      },
    })
  })
})
