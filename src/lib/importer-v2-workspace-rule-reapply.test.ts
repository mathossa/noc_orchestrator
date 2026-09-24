import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFind: vi.fn(),
  batchUpdate: vi.fn(),
  rowFindMany: vi.fn(),
  rowUpdateMany: vi.fn(),
  decisionFindMany: vi.fn(),
  decisionCreateMany: vi.fn(),
  decisionDeleteMany: vi.fn(),
  ensureRuleBook: vi.fn(),
  getActiveRuleSet: vi.fn(),
  topology: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importerV2WorkspaceBatch: {
      findUniqueOrThrow: mocks.batchFind,
      update: mocks.batchUpdate,
    },
    importerV2WorkspaceRow: {
      findMany: mocks.rowFindMany,
      updateMany: mocks.rowUpdateMany,
    },
    importerV2WorkspaceDecision: {
      findMany: mocks.decisionFindMany,
      createMany: mocks.decisionCreateMany,
      deleteMany: mocks.decisionDeleteMany,
    },
  },
}))

vi.mock('@/lib/importer-v2-workspace-rule-book', () => ({
  ensureImporterV2WorkspaceRuleBook: mocks.ensureRuleBook,
}))

vi.mock('@/lib/importer-v2-rule-store', () => ({
  getActiveImporterV2RuleSet: mocks.getActiveRuleSet,
}))

vi.mock('@/lib/importer-v2-stack-topology', () => ({
  automaticImporterV2StackTopologyDecisions: mocks.topology,
  importerV2TopologyFromDecisions: vi.fn(() => null),
}))

import { initializeImporterV2WorkspaceAutomation } from '@/lib/importer-v2-workspace-maintenance'

describe('Importer v2 saved-rule reapply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFind.mockResolvedValue({
      id: 'batch-1',
      provider: 'AUVIK',
      sourceAdapterId: 'xlsx',
      profileId: 'profile-1',
      ruleBookId: 'book-1',
    })
    mocks.ensureRuleBook.mockResolvedValue('book-1')
    mocks.getActiveRuleSet.mockResolvedValue({
      ruleBookId: 'book-1',
      revisionId: 'revision-29',
      version: 29,
      rules: [],
    })
    mocks.topology.mockReturnValue({
      decisions: [],
      groups: [],
    })
    mocks.rowFindMany
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          rowNumber: 1,
          sourceName: 'ap-1',
          hostname: null,
          customer: 'Customer',
          businessUnit: null,
          site: 'Site',
          deviceType: 'Access Point',
          evaluated: {
            rawValues: {
              model: 'Aruba AP-305',
              softwarePlatform: null,
            },
            proposedCanonicalValues: {},
            fields: {},
            issues: [],
          },
        },
      ])
      .mockResolvedValueOnce([])
    mocks.decisionFindMany.mockResolvedValue([
      {
        id: 'decision-old-rule',
        rowId: 'row-1',
        rowNumber: 1,
        field: 'softwarePlatform',
        action: 'SET_FIELD',
        value: { id: null, label: 'AOS-8, AOS-10' },
        scopeToken: 'AUTO_RULE:revision-28:old-rule',
      },
      {
        id: 'decision-manual',
        rowId: 'row-1',
        rowNumber: 1,
        field: 'site',
        action: 'SET_FIELD',
        value: { id: null, label: 'Site' },
        scopeToken: 'manual-scope',
      },
    ])
    mocks.decisionDeleteMany.mockResolvedValue({ count: 1 })
    mocks.decisionCreateMany.mockResolvedValue({ count: 0 })
  })

  it('removes obsolete automatic rule decisions but leaves manual decisions alone', async () => {
    const result = await initializeImporterV2WorkspaceAutomation('batch-1', true)

    expect(mocks.decisionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['decision-old-rule'] } },
    })
    expect(result.automaticRuleDecisionsRemoved).toBe(1)
    expect(result.automaticDecisionsApplied).toBe(0)
  })
})
