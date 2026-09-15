import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  batch: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2WorkspaceRow: { findMany: mocks.read, updateMany: mocks.write },
    importerV2WorkspaceBatch: { update: mocks.batch },
  },
}))
import {
  recomputeImporterV2WorkspaceRows,
  recheckImporterV2Workspace,
} from './importer-v2-workspace-maintenance'
const row = (rowNumber: number) => ({
  id: `row-${rowNumber}`,
  rowNumber,
  reviewRevision: 3,
  inclusion: 'INCLUDED',
  evaluated: {
    rawValues: {},
    proposedCanonicalValues: {},
    fields: {},
    issues: [],
  },
  decisions: [],
  identityResolution: null,
  repeatClassification: null,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue([])
  mocks.write.mockResolvedValue({ count: 1 })
})
it('restricts a five-row correction to its persisted complete scope and pending rows', async () => {
  mocks.read.mockResolvedValueOnce([1, 2, 3, 4, 5].map(row))
  const result = await recheckImporterV2Workspace('batch', 'confirmed-scope')
  expect(result.checked).toBe(5)
  expect(mocks.write).toHaveBeenCalledTimes(5)
  for (const [query] of mocks.read.mock.calls) {
    expect(query.where).toMatchObject({
      batchId: 'batch',
      needsReevaluation: true,
      decisions: { some: { scopeToken: 'confirmed-scope' } },
    })
    expect(query.take).toBe(200)
  }
})
it('keyset-pages beyond row 100 and bounds concurrent writes to ten', async () => {
  mocks.read
    .mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => row(i + 1)))
    .mockResolvedValueOnce([row(201)])
  let active = 0
  let peak = 0
  mocks.write.mockImplementation(async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 0))
    active -= 1
    return { count: 1 }
  })
  expect(
    (await recomputeImporterV2WorkspaceRows({ batchId: 'batch' })).checked,
  ).toBe(201)
  expect(peak).toBeLessThanOrEqual(10)
  expect(mocks.read.mock.calls[1][0].where.rowNumber).toEqual({ gt: 200 })
})
it('does not clear a correction written after the read snapshot', async () => {
  mocks.read.mockResolvedValueOnce([row(1)])
  mocks.write.mockResolvedValue({ count: 0 })
  expect((await recheckImporterV2Workspace('batch')).checked).toBe(0)
  expect(mocks.write.mock.calls[0][0].where).toEqual({
    id: 'row-1',
    reviewRevision: 3,
  })
  expect(mocks.batch).not.toHaveBeenCalled()
})
it('uses actual automation decision rows, including an empty changed scope', async () => {
  await recomputeImporterV2WorkspaceRows({ batchId: 'batch', rowIds: [] })
  expect(mocks.read.mock.calls[0][0].where.id).toEqual({ in: [] })
  expect(mocks.write).not.toHaveBeenCalled()
})
