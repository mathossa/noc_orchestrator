import { describe, expect, it } from 'vitest'
import { previewImporterV2RuleChange } from '@/lib/importer-v2-rule-preview'
import type { ImporterV2RuleDefinition } from '@/lib/importer-v2-rule-types'

const base = {
  ruleBookId: 'book',
  revisionId: 'rev-1',
  version: 1,
  rules: [],
}
const context = {
  profileId: 'profile',
  provider: 'Auvik',
  sourceAdapterId: 'xlsx',
}

function candidate(overrides: Partial<ImporterV2RuleDefinition> = {}): ImporterV2RuleDefinition {
  return {
    id: 'candidate',
    version: 1,
    name: 'Candidate',
    priority: 100,
    status: 'DRAFT',
    scope: { providers: ['Auvik'] },
    when: {
      kind: 'CONDITION',
      field: 'vendor',
      operator: 'NORMALIZED_EXACT',
      value: 'Cisco',
    },
    actions: [{ type: 'SET_FIELD', field: 'productFamily', value: 'Catalyst' }],
    ...overrides,
  }
}

describe('Importer v2 rule preview', () => {
  it('shows scope counts, examples and changed fields before activation', () => {
    const preview = previewImporterV2RuleChange({
      baseRuleSet: base,
      candidateRule: candidate(),
      context,
      rows: [
        { rowNumber: 1, rawValues: { customer: 'DHL', site: 'Alkmaar', vendor: 'Cisco', model: 'C9300' } },
        { rowNumber: 2, rawValues: { customer: 'DHL', site: 'Amersfoort', vendor: 'Cisco', model: 'C9200' } },
        { rowNumber: 3, rawValues: { customer: 'Other', site: 'X', vendor: 'Aruba', model: '6200F' } },
      ],
    })

    expect(preview.matchedRowCount).toBe(2)
    expect(preview.changedFields).toEqual(['productFamily'])
    expect(preview.affectedCustomers).toEqual(['DHL'])
    expect(preview.affectedSites).toEqual(['Alkmaar', 'Amersfoort'])
    expect(preview.affectedModels).toEqual(['C9200', 'C9300'])
    expect(preview.examples).toHaveLength(2)
    expect(preview.examples[0].after.productFamily).toBe('Catalyst')
  })

  it('requires explicit confirmation for broad or excluding rules', () => {
    const preview = previewImporterV2RuleChange({
      baseRuleSet: base,
      candidateRule: candidate({
        scope: {},
        actions: [{ type: 'EXCLUDE_ROW', reason: 'Not managed' }],
      }),
      context,
      rows: Array.from({ length: 120 }, (_, index) => ({
        rowNumber: index + 1,
        rawValues: { vendor: 'Cisco' },
      })),
    })

    expect(preview.excludedRowCount).toBe(120)
    expect(preview.requiresExplicitConfirmation).toBe(true)
    expect(preview.confirmationReasons).toEqual(
      expect.arrayContaining([
        'The rule can exclude rows from import.',
        'The rule has no explicit inventory/source scope.',
      ]),
    )
  })

  it('surfaces equal-priority conflicts and evaluates a replacement without stale prior output', () => {
    const oldCandidate = candidate({
      status: 'ACTIVE',
      actions: [{ type: 'SET_FIELD', field: 'productFamily', value: 'Old family' }],
    })
    const competing: ImporterV2RuleDefinition = {
      ...candidate(),
      id: 'competing',
      name: 'Competing',
      status: 'ACTIVE',
      actions: [{ type: 'SET_FIELD', field: 'productFamily', value: 'Other family' }],
    }
    const preview = previewImporterV2RuleChange({
      baseRuleSet: { ...base, rules: [oldCandidate, competing] },
      candidateRule: candidate({
        version: 2,
        actions: [{ type: 'SET_FIELD', field: 'productFamily', value: 'New family' }],
      }),
      context,
      rows: [{ rowNumber: 1, rawValues: { vendor: 'Cisco' } }],
    })

    expect(preview.matchedRowCount).toBe(1)
    expect(preview.conflicts).toHaveLength(1)
    expect(preview.conflicts[0].ruleIds).toEqual(['candidate', 'competing'])
    expect(JSON.stringify(preview)).not.toContain('Old family')
    expect(preview.requiresExplicitConfirmation).toBe(true)
  })
})
