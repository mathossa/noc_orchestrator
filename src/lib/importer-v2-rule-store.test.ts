import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ruleBookCreate: vi.fn(),
  ruleBookFindUniqueOrThrow: vi.fn(),
  ruleBookUpdate: vi.fn(),
  revisionCreate: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionFindUniqueOrThrow: vi.fn(),
  revisionFindMany: vi.fn(),
  exactFindMany: vi.fn(),
  exactFindFirst: vi.fn(),
  exactUpdate: vi.fn(),
  exactCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    importerV2RuleBook: {
      create: mocks.ruleBookCreate,
      findUniqueOrThrow: mocks.ruleBookFindUniqueOrThrow,
      update: mocks.ruleBookUpdate,
    },
    importerV2RuleRevision: {
      create: mocks.revisionCreate,
      findFirst: mocks.revisionFindFirst,
      findUniqueOrThrow: mocks.revisionFindUniqueOrThrow,
      findMany: mocks.revisionFindMany,
    },
    importerV2ExactMapping: {
      findMany: mocks.exactFindMany,
      findFirst: mocks.exactFindFirst,
      update: mocks.exactUpdate,
      create: mocks.exactCreate,
    },
  }
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    },
  }
})

import {
  activateImporterV2RuleRevision,
  createImporterV2RuleBook,
  listActiveImporterV2ExactMappings,
  rememberImporterV2ExactMapping,
  replaceImporterV2RuleSet,
} from '@/lib/importer-v2-rule-store'

const firstRule = {
  id: 'rule-1',
  version: 1,
  name: 'Rule 1',
  priority: 100,
  status: 'ACTIVE' as const,
  scope: {},
  when: {
    kind: 'CONDITION' as const,
    field: 'vendor' as const,
    operator: 'NORMALIZED_EXACT' as const,
    value: 'Cisco',
  },
  actions: [{ type: 'SET_FIELD' as const, field: 'vendor' as const, value: 'Cisco Systems' }],
}

describe('Importer v2 rule persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a rule book with an immutable initial full revision', async () => {
    mocks.ruleBookCreate.mockResolvedValue({ id: 'book-1', name: 'Default', activeRevisionVersion: 1 })
    mocks.revisionCreate.mockResolvedValue({
      id: 'rev-1',
      ruleBookId: 'book-1',
      version: 1,
      rules: [firstRule],
      reason: 'Initial',
      createdByUserId: 'user-1',
      createdAt: new Date(),
    })

    const result = await createImporterV2RuleBook({
      id: 'book-1',
      name: 'Default',
      rules: [firstRule],
      createdByUserId: 'user-1',
      reason: 'Initial',
    })

    expect(result).toMatchObject({ ruleBookId: 'book-1', revisionId: 'rev-1', version: 1 })
    expect(mocks.revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ruleBookId: 'book-1',
        version: 1,
        rules: [firstRule],
      }),
    })
  })

  it('replaces the entire rule snapshot instead of merging stale rule output', async () => {
    mocks.revisionFindFirst.mockResolvedValue({ version: 3 })
    mocks.revisionCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'rev-4',
      ...data,
      createdAt: new Date(),
    }))
    mocks.ruleBookUpdate.mockResolvedValue({
      id: 'book-1',
      name: 'Default',
      activeRevisionVersion: 4,
    })

    const replacement = [{ ...firstRule, id: 'replacement', name: 'Replacement' }]
    await replaceImporterV2RuleSet('book-1', {
      rules: replacement,
      reason: 'Replace old rules',
    })

    expect(mocks.revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 4,
        rules: replacement,
      }),
    })
    const createData = mocks.revisionCreate.mock.calls[0][0].data
    expect(JSON.stringify(createData.rules)).not.toContain('rule-1')
  })

  it('can activate an older immutable revision as rollback', async () => {
    mocks.revisionFindUniqueOrThrow.mockResolvedValue({
      id: 'rev-2',
      ruleBookId: 'book-1',
      version: 2,
      rules: [firstRule],
      reason: 'Known good',
      createdByUserId: null,
      createdAt: new Date(),
    })
    mocks.ruleBookUpdate.mockResolvedValue({ id: 'book-1', name: 'Default', activeRevisionVersion: 2 })
    mocks.ruleBookFindUniqueOrThrow.mockResolvedValue({ id: 'book-1', name: 'Default', activeRevisionVersion: 2 })

    const rolledBack = await activateImporterV2RuleRevision('book-1', 2)

    expect(mocks.ruleBookUpdate).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: { activeRevisionVersion: 2 },
    })
    expect(rolledBack.version).toBe(2)
  })

  it('stores exact remembered aliases separately and versions replacements', async () => {
    mocks.exactFindFirst.mockResolvedValue({
      id: 'mapping-v1',
      mappingKey: 'key',
      version: 1,
      isActive: true,
    })
    mocks.exactUpdate.mockResolvedValue({})
    mocks.exactCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'mapping-v2', ...data }))

    const created = await rememberImporterV2ExactMapping({
      provider: 'Auvik',
      profileId: 'profile-1',
      field: 'vendor',
      normalizedInput: 'Cisco Systems, Inc.',
      target: { id: 'vendor-cisco', label: 'Cisco' },
      explanation: 'Confirmed exact alias',
    })

    expect(mocks.exactUpdate).toHaveBeenCalledWith({
      where: { id: 'mapping-v1' },
      data: { isActive: false },
    })
    expect(created).toMatchObject({ version: 2, isActive: true, field: 'vendor' })
  })

  it('loads profile-specific and provider-wide exact mappings without generalized rules', async () => {
    mocks.exactFindMany.mockResolvedValue([])
    await listActiveImporterV2ExactMappings({ provider: 'Auvik', profileId: 'profile-1' })
    expect(mocks.exactFindMany).toHaveBeenCalledWith({
      where: {
        provider: 'Auvik',
        isActive: true,
        OR: [{ profileId: null }, { profileId: 'profile-1' }],
      },
      orderBy: [{ field: 'asc' }, { normalizedInput: 'asc' }, { id: 'asc' }],
    })
  })
})
