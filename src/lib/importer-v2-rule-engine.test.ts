import { describe, expect, it } from 'vitest'
import { compileImporterV2RuleSet } from '@/lib/importer-v2-rule-compiler'
import {
  evaluateImporterV2RuleRow,
  evaluateImporterV2RuleRows,
} from '@/lib/importer-v2-rule-engine'
import type {
  ImporterV2RuleDefinition,
  ImporterV2RuleSetSnapshot,
} from '@/lib/importer-v2-rule-types'

const context = {
  profileId: 'profile-auvik',
  provider: 'Auvik',
  sourceAdapterId: 'xlsx-tabular-v1',
}

function rule(
  id: string,
  overrides: Partial<ImporterV2RuleDefinition> = {},
): ImporterV2RuleDefinition {
  return {
    id,
    version: 1,
    name: id,
    priority: 100,
    status: 'ACTIVE',
    scope: {},
    when: {
      kind: 'CONDITION',
      field: 'vendor',
      operator: 'NORMALIZED_EXACT',
      value: 'Cisco',
    },
    actions: [{ type: 'SET_FIELD', field: 'vendor', value: 'Cisco Systems' }],
    ...overrides,
  }
}

function snapshot(rules: readonly ImporterV2RuleDefinition[]): ImporterV2RuleSetSnapshot {
  return {
    ruleBookId: 'book-1',
    revisionId: 'revision-3',
    version: 3,
    rules,
  }
}

describe('Importer v2 scoped rule engine', () => {
  it('supports nested AND/OR conditions and narrow source/inventory scope', () => {
    const compiled = compileImporterV2RuleSet(
      snapshot([
        rule('aruba-ap', {
          scope: {
            providers: ['Auvik'],
            customers: ['DHL'],
            deviceTypes: ['Access Point'],
          },
          when: {
            kind: 'GROUP',
            operator: 'AND',
            items: [
              {
                kind: 'CONDITION',
                field: 'vendor',
                operator: 'NORMALIZED_EXACT',
                value: 'Aruba',
              },
              {
                kind: 'GROUP',
                operator: 'OR',
                items: [
                  {
                    kind: 'CONDITION',
                    field: 'model',
                    operator: 'PREFIX',
                    value: 'AP-5',
                  },
                  {
                    kind: 'CONDITION',
                    field: 'model',
                    operator: 'PATTERN',
                    value: 'IAP-5??',
                  },
                ],
              },
            ],
          },
          actions: [
            {
              type: 'MAP_VALUE',
              field: 'productFamily',
              target: { id: 'family-ap500', label: 'AP500' },
            },
          ],
        }),
      ]),
    )

    const matched = evaluateImporterV2RuleRow(
      compiled,
      {
        rowNumber: 1,
        rawValues: {
          customer: 'DHL',
          vendor: ' Aruba ',
          model: 'AP-515',
          deviceType: 'Access Point',
        },
      },
      context,
    )
    const missed = evaluateImporterV2RuleRow(
      compiled,
      {
        rowNumber: 2,
        rawValues: {
          customer: 'Other',
          vendor: 'Aruba',
          model: 'AP-515',
          deviceType: 'Access Point',
        },
      },
      context,
    )

    expect(matched.fields.productFamily?.mappedTarget).toEqual({
      id: 'family-ap500',
      label: 'AP500',
    })
    expect(matched.applied[0]).toMatchObject({
      ruleId: 'aruba-ap',
      ruleVersion: 1,
      priority: 100,
    })
    expect(matched.applied[0].conditions).toHaveLength(3)
    expect(missed.applied).toHaveLength(0)
  })

  it('uses explicit priority and leaves equal-tier conflicting outputs unresolved', () => {
    const compiled = compileImporterV2RuleSet(
      snapshot([
        rule('low', {
          priority: 10,
          actions: [{ type: 'SET_FIELD', field: 'vendor', value: 'Low' }],
        }),
        rule('high-a', {
          priority: 20,
          actions: [{ type: 'SET_FIELD', field: 'vendor', value: 'A' }],
        }),
        rule('high-b', {
          priority: 20,
          actions: [{ type: 'SET_FIELD', field: 'vendor', value: 'B' }],
        }),
        rule('high-c', {
          priority: 20,
          actions: [{ type: 'SET_FIELD', field: 'vendor', value: 'C' }],
        }),
      ]),
    )

    const evaluated = evaluateImporterV2RuleRow(
      compiled,
      { rowNumber: 1, rawValues: { vendor: 'Cisco' } },
      context,
    )

    expect(evaluated.effectiveRow.rawValues.vendor).toBe('Cisco')
    expect(evaluated.conflicts).toHaveLength(1)
    expect(evaluated.conflicts[0].ruleIds).toEqual([
      'high-a',
      'high-b',
      'high-c',
    ])
    expect(evaluated.applied).toHaveLength(0)
  })

  it('distinguishes IGNORE_FIELD from explicit EXCLUDE_ROW', () => {
    const ignore = compileImporterV2RuleSet(
      snapshot([
        rule('ignore-firmware', {
          actions: [{ type: 'IGNORE_FIELD', field: 'firmwareVersion' }],
        }),
      ]),
    )
    const ignored = evaluateImporterV2RuleRow(
      ignore,
      {
        rowNumber: 1,
        rawValues: { vendor: 'Cisco', firmwareVersion: '17.5(1r)' },
      },
      context,
    )
    expect(ignored.excluded).toBe(false)
    expect(ignored.fields.firmwareVersion?.ignored).toBe(true)
    expect(ignored.effectiveRow.rawValues.firmwareVersion).toBeNull()

    const exclude = compileImporterV2RuleSet(
      snapshot([
        rule('exclude-row', {
          actions: [{ type: 'EXCLUDE_ROW', reason: 'Source row is not a managed device.' }],
        }),
      ]),
    )
    const excluded = evaluateImporterV2RuleRow(
      exclude,
      { rowNumber: 2, rawValues: { vendor: 'Cisco' } },
      context,
    )
    expect(excluded.excluded).toBe(true)
    expect(excluded.effectiveRow.inclusionDecision).toEqual({
      status: 'EXCLUDED',
      source: 'PROFILE_RULE',
      decisionId: 'exclude-row@1',
      explanation: 'Source row is not a managed device.',
    })
  })

  it('supports safe wildcard/version matching, transforms, hierarchy splits and device-match proposals', () => {
    const compiled = compileImporterV2RuleSet(
      snapshot([
        rule('shape-row', {
          when: {
            kind: 'GROUP',
            operator: 'AND',
            items: [
              {
                kind: 'CONDITION',
                field: 'model',
                operator: 'PATTERN',
                value: 'C9???-*',
              },
              {
                kind: 'CONDITION',
                field: 'softwareVersion',
                operator: 'VERSION_MATCH',
                value: '17.15.*',
              },
            ],
          },
          actions: [
            {
              type: 'TRANSFORM_VALUE',
              field: 'hostname',
              transform: 'LOWERCASE',
            },
            {
              type: 'SPLIT_HIERARCHY',
              sourceField: 'notes',
              delimiter: ' / ',
              targetFields: ['customer', 'businessUnit', 'site'],
            },
            {
              type: 'MATCH_DEVICE',
              deviceId: 'device-123',
              explanation: 'Confirmed provider grouping pattern.',
            },
          ],
        }),
      ]),
    )

    const evaluated = evaluateImporterV2RuleRow(
      compiled,
      {
        rowNumber: 1,
        rawValues: {
          vendor: 'Cisco',
          model: 'C9300-24P',
          softwareVersion: 'v17_15_5',
          hostname: 'SWITCH-01',
          notes: 'DHL / eCom / Alkmaar',
        },
      },
      context,
    )

    expect(evaluated.effectiveRow.rawValues).toMatchObject({
      hostname: 'switch-01',
      customer: 'DHL',
      businessUnit: 'eCom',
      site: 'Alkmaar',
    })
    expect(evaluated.deviceMatch).toMatchObject({
      deviceId: 'device-123',
      requiresConfirmation: true,
    })
  })

  it('indexes mandatory exact conditions instead of evaluating every rule for every row', () => {
    const rules = Array.from({ length: 200 }, (_, index) =>
      rule(`model-${index}`, {
        when: {
          kind: 'CONDITION',
          field: 'model',
          operator: 'NORMALIZED_EXACT',
          value: `MODEL-${index}`,
        },
        actions: [{ type: 'SET_FIELD', field: 'productFamily', value: `FAMILY-${index}` }],
      }),
    )
    const rows = Array.from({ length: 12_000 }, (_, index) => ({
      rowNumber: index + 1,
      rawValues: { model: `MODEL-${index % 200}` },
    }))

    const evaluated = evaluateImporterV2RuleRows(
      compileImporterV2RuleSet(snapshot(rules)),
      rows,
      context,
    )
    const candidateChecks = evaluated.reduce(
      (sum, row) => sum + row.candidateRuleCount,
      0,
    )

    expect(candidateChecks).toBe(12_000)
    expect(candidateChecks).toBeLessThan(rows.length * rules.length / 50)
    expect(evaluated[11_999].effectiveRow.rawValues.productFamily).toBe('FAMILY-199')
  })
  it('keeps derived currentFirmware owned by the deterministic interpreter', () => {
    expect(() =>
      compileImporterV2RuleSet(
        snapshot([
          rule('bad-derived-write', {
            actions: [
              { type: 'SET_FIELD', field: 'currentFirmware', value: '17.15.5' },
            ],
          }),
        ]),
      ),
    ).toThrow(/cannot write derived currentFirmware/)
  })

})
