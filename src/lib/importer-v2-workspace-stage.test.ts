import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  batchCreate: vi.fn(),
  rowCreateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

import { stageImporterV2Workspace } from '@/lib/importer-v2-workspace-store'

describe('Importer v2 workspace staging runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let sequence = 0
    mocks.batchCreate.mockImplementation(async ({ data }: { data: unknown }) => {
      sequence += 1
      return { id: `batch-${sequence}`, ...(data as object) }
    })
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          importerV2WorkspaceBatch: { create: mocks.batchCreate },
          importerV2WorkspaceRow: { createMany: mocks.rowCreateMany },
        }),
    )
  })

  it('creates a new workspace run when the same deterministic evaluation fingerprint is imported again', async () => {
    const input = {
      name: 'Auvik devices.xlsx',
      provider: 'Auvik',
      sourceAdapterId: 'auvik-xlsx',
      profileId: 'profile-1',
      profileVersion: '1',
      evaluationFingerprint: 'same-evaluation-fingerprint',
      rows: [],
    }

    const first = await stageImporterV2Workspace(input)
    const second = await stageImporterV2Workspace(input)

    expect(first.id).toBe('batch-1')
    expect(second.id).toBe('batch-2')
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(mocks.batchCreate).toHaveBeenCalledTimes(2)
    expect(mocks.batchCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          evaluationFingerprint: 'same-evaluation-fingerprint',
        }),
      }),
    )
    expect(mocks.batchCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          evaluationFingerprint: 'same-evaluation-fingerprint',
        }),
      }),
    )
  })
})
