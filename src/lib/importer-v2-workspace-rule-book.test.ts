import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  batchUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2RuleBook: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
    importerV2WorkspaceBatch: {
      update: mocks.batchUpdate,
    },
  },
}))

import {
  ensureImporterV2WorkspaceRuleBook,
  findImporterV2WorkspaceRuleBook,
} from '@/lib/importer-v2-workspace-rule-book'

describe('Importer v2 workspace rule-book continuity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('finds legacy provider-cased rule books case-insensitively', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'legacy-book',
        name: 'Importer v2 · Auvik · profile-1',
        activeRevisionVersion: 28,
        updatedAt: new Date('2026-09-23T12:00:00Z'),
      },
    ])

    const book = await findImporterV2WorkspaceRuleBook({
      provider: 'AUVIK',
      profileId: 'profile-1',
    })

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        name: {
          equals: 'Importer v2 · AUVIK · profile-1',
          mode: 'insensitive',
        },
      },
      orderBy: [
        { activeRevisionVersion: 'desc' },
        { updatedAt: 'desc' },
      ],
    })
    expect(book?.id).toBe('legacy-book')
  })

  it('reattaches a batch to the richer legacy rule book instead of an empty replacement', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'legacy-book',
        name: 'Importer v2 · Auvik · profile-1',
        activeRevisionVersion: 28,
        updatedAt: new Date('2026-09-23T12:00:00Z'),
      },
      {
        id: 'new-empty-book',
        name: 'Importer v2 · AUVIK · profile-1',
        activeRevisionVersion: 1,
        updatedAt: new Date('2026-09-24T10:00:00Z'),
      },
    ])
    mocks.findUnique.mockResolvedValue({
      id: 'new-empty-book',
      name: 'Importer v2 · AUVIK · profile-1',
      activeRevisionVersion: 1,
      updatedAt: new Date('2026-09-24T10:00:00Z'),
    })
    mocks.batchUpdate.mockResolvedValue({})

    const id = await ensureImporterV2WorkspaceRuleBook({
      batchId: 'batch-1',
      provider: 'AUVIK',
      profileId: 'profile-1',
      currentRuleBookId: 'new-empty-book',
    })

    expect(id).toBe('legacy-book')
    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { ruleBookId: 'legacy-book' },
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
