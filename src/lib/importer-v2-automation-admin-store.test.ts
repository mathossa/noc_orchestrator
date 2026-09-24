import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActive: vi.fn(),
  replace: vi.fn(),
  deactivateExact: vi.fn(),
}))

vi.mock('@/lib/importer-v2-rule-store', () => ({
  getActiveImporterV2RuleSet: mocks.getActive,
  replaceImporterV2RuleSet: mocks.replace,
  deactivateImporterV2ExactMapping: mocks.deactivateExact,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

import {
  deactivateImporterV2ManagedExactMapping,
  mutateImporterV2ManagedRule,
} from '@/lib/importer-v2-automation-admin-store'

const rule = {
  id: 'wizard-bad-platform',
  version: 1,
  name: 'model: contains Aruba AP → softwarePlatform',
  priority: 100,
  status: 'ACTIVE' as const,
  scope: {
    providers: ['AUVIK'],
    profileIds: ['profile-1'],
    sourceAdapterIds: ['xlsx'],
    sourceFields: ['softwarePlatform' as const],
  },
  when: {
    kind: 'CONDITION' as const,
    field: 'model' as const,
    operator: 'CONTAINS' as const,
    value: 'Aruba AP',
  },
  actions: [
    {
      type: 'MAP_VALUE' as const,
      field: 'softwarePlatform' as const,
      target: { id: null, label: 'AOS-8, AOS-10' },
    },
  ],
}

describe('Importer v2 automation administration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActive.mockResolvedValue({
      ruleBookId: 'book-1',
      revisionId: 'revision-28',
      version: 28,
      rules: [rule],
    })
    mocks.replace.mockResolvedValue({
      ruleBookId: 'book-1',
      revisionId: 'revision-29',
      version: 29,
      rules: [],
    })
  })

  it('removes a rule by creating the next active revision without rewriting history', async () => {
    await mutateImporterV2ManagedRule({
      ruleBookId: 'book-1',
      ruleId: rule.id,
      action: 'REMOVE',
      createdByUserId: 'user-1',
    })

    expect(mocks.replace).toHaveBeenCalledWith('book-1', {
      rules: [],
      createdByUserId: 'user-1',
      reason:
        'Removed importer automation “model: contains Aruba AP → softwarePlatform” from Import automation settings.',
      activate: true,
    })
  })

  it('disables a rule in a new revision instead of deleting the definition', async () => {
    await mutateImporterV2ManagedRule({
      ruleBookId: 'book-1',
      ruleId: rule.id,
      action: 'DISABLE',
    })

    expect(mocks.replace).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({
        activate: true,
        rules: [
          expect.objectContaining({
            id: rule.id,
            status: 'DISABLED',
          }),
        ],
      }),
    )
  })

  it('deactivates remembered mappings through the versioned mapping store', async () => {
    mocks.deactivateExact.mockResolvedValue({
      mappingKey: 'mapping-1',
      version: 3,
      isActive: false,
    })

    await deactivateImporterV2ManagedExactMapping({
      mappingKey: 'mapping-1',
      createdByUserId: 'user-1',
    })

    expect(mocks.deactivateExact).toHaveBeenCalledWith({
      mappingKey: 'mapping-1',
      createdByUserId: 'user-1',
      explanation:
        'Deactivated remembered exact mapping from Import automation settings.',
    })
  })
})
