import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IMPORTER_V2_FIELDS,
  type ImporterV2Field,
  type ImporterV2FieldDecision,
  type ImporterV2StagedRow,
} from '@/lib/importer-v2-evaluator'

const mocks = vi.hoisted(() => ({
  evaluateFirmware: vi.fn(),
}))

vi.mock('@/lib/importer-v2-firmware-evaluation', () => ({
  evaluateImporterV2WithFirmware: mocks.evaluateFirmware,
}))

import {
  evaluateImporterV2WithRules,
  type ImporterV2RuleEvaluationInput,
} from '@/lib/importer-v2-rule-evaluation'
import type { ImporterV2FirmwareEvaluationInput } from '@/lib/importer-v2-firmware-evaluation'

const unresolvedDecision: ImporterV2FieldDecision = {
  source: 'UNRESOLVED',
  confidence: 'LOW',
  explanation: 'Unresolved',
  requiresConfirmation: false,
  matchedRuleId: null,
  matchedRuleVersion: null,
  matchedParserId: null,
  matchedParserVersion: null,
  matchedCatalogValueId: null,
  matchedCatalogVersion: null,
  matchedSuggestionId: null,
  matchedSuggestionVersion: null,
}

function complete(values: Partial<Record<ImporterV2Field, string | null>>) {
  return Object.fromEntries(
    IMPORTER_V2_FIELDS.map((field) => [field, values[field] ?? null]),
  ) as Record<ImporterV2Field, string | null>
}

function installFirmwareResult() {
  mocks.evaluateFirmware.mockImplementation((input: ImporterV2FirmwareEvaluationInput) => ({
    evaluationFingerprint: 'firmware-fingerprint',
    profileVersion: input.profile.version,
    catalogVersion: input.catalog.version,
    ruleVersion: input.rules.version,
    parserVersion: input.parsers.version,
    suggestionVersion: input.suggestions.version,
    firmwareInterpreterVersion: '1.0.0',
    firmwareCompatibilityVersion: input.firmwareContext.compatibilityVersion,
    firmwareProofGroups: [],
    rows: input.rows.map((row: ImporterV2StagedRow) => {
      const rawValues = complete(row.rawValues)
      const fields = Object.fromEntries(
        IMPORTER_V2_FIELDS.map((field) => [
          field,
          {
            field,
            rawValue: rawValues[field],
            normalizedValue: rawValues[field],
            proposedValue: rawValues[field]
              ? { id: null, label: rawValues[field] as string }
              : null,
            decision: unresolvedDecision,
            issues: [],
          },
        ]),
      )
      return {
        rowNumber: row.rowNumber,
        sourceFingerprint: `fp-${row.rowNumber}`,
        rawValues,
        normalizedValues: rawValues,
        proposedCanonicalValues: Object.fromEntries(
          IMPORTER_V2_FIELDS.map((field) => [
            field,
            rawValues[field] ? { id: null, label: rawValues[field] } : null,
          ]),
        ),
        fields,
        issues: [],
        statuses: ['VALID', 'NEW'],
        inclusion: row.inclusionDecision ? 'EXCLUDED' : 'INCLUDED',
        inclusionDecision: row.inclusionDecision ?? null,
        comparisonRecordId: null,
        firmware: { interpreterVersion: '1.0.0' },
      }
    }),
  }))
}

function input(): ImporterV2RuleEvaluationInput {
  return {
    profile: {
      id: 'profile-1',
      version: '4',
      sourceAdapterId: 'xlsx',
      provider: 'Auvik',
      requiredFields: [],
      warnWhenUnresolvedFields: [],
    },
    catalog: { version: 'cat-1', values: {} },
    rules: {
      version: 'legacy-rules',
      manualOverrides: [],
      rememberedMappings: [],
      profileRules: [
        {
          id: 'legacy-profile-rule',
          field: 'vendor',
          when: { field: 'vendor', operator: 'EQUALS', value: 'Cisco' },
          target: { id: null, label: 'Legacy' },
          explanation: 'Must not compete',
          active: true,
        },
      ],
    },
    parsers: { version: 'parser-1', definitions: [] },
    suggestions: { version: 'suggestion-1', suggestions: [] },
    firmwareContext: { compatibilityVersion: 'compat-1', compatibilityRules: [] },
    rows: [
      {
        rowNumber: 1,
        rawValues: {
          vendor: 'Cisco',
          productFamily: 'raw-family',
          firmwareVersion: '17.5(1r)',
          softwareVersion: '17.15.5',
        },
      },
    ],
    ruleSet: {
      ruleBookId: 'book',
      revisionId: 'revision-2',
      version: 2,
      rules: [],
    },
    exactMappings: [],
  }
}

describe('Importer v2 rule-aware evaluation facade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installFirmwareResult()
  })

  it('replaces the legacy profile-rule engine and overlays canonical MAP_VALUE proof', () => {
    const value = input()
    value.ruleSet.rules = [
      {
        id: 'map-family',
        version: 3,
        name: 'Map Catalyst family',
        priority: 100,
        status: 'ACTIVE',
        scope: { providers: ['Auvik'] },
        when: {
          kind: 'CONDITION',
          field: 'vendor',
          operator: 'NORMALIZED_EXACT',
          value: 'Cisco',
        },
        actions: [
          {
            type: 'MAP_VALUE',
            field: 'productFamily',
            target: { id: 'family-catalyst', label: 'Catalyst' },
          },
        ],
      },
    ]
    value.exactMappings = [
      {
        id: 'exact-1',
        mappingKey: 'key',
        version: 1,
        provider: 'Auvik',
        profileId: null,
        field: 'vendor',
        normalizedInput: 'Cisco Systems',
        target: { id: 'vendor-cisco', label: 'Cisco' },
        explanation: 'Confirmed exact alias',
        isActive: true,
      },
    ]

    const result = evaluateImporterV2WithRules(value)
    const firmwareInput = mocks.evaluateFirmware.mock.calls[0][0]

    expect(firmwareInput.rules.profileRules).toEqual([])
    expect(firmwareInput.rules.rememberedMappings).toHaveLength(1)
    expect(firmwareInput.rows[0].rawValues.productFamily).toBe('Catalyst')
    expect(result.rows[0].fields.productFamily.proposedValue).toEqual({
      id: 'family-catalyst',
      label: 'Catalyst',
    })
    expect(result.rows[0].fields.productFamily.decision).toMatchObject({
      source: 'PROFILE_RULE',
      matchedRuleId: 'map-family',
      matchedRuleVersion: '3',
      requiresConfirmation: true,
    })
    expect(result.rows[0].ruleEvaluation.fields.productFamily?.originalValue).toBe('raw-family')
  })

  it('keeps ignored source evidence in the rule trace without excluding the row', () => {
    const value = input()
    value.ruleSet.rules = [
      {
        id: 'ignore-boot',
        version: 1,
        name: 'Ignore boot firmware field',
        priority: 100,
        status: 'ACTIVE',
        scope: {},
        when: {
          kind: 'CONDITION',
          field: 'vendor',
          operator: 'NORMALIZED_EXACT',
          value: 'Cisco',
        },
        actions: [{ type: 'IGNORE_FIELD', field: 'firmwareVersion' }],
      },
    ]

    const result = evaluateImporterV2WithRules(value)
    const firmwareInput = mocks.evaluateFirmware.mock.calls[0][0]

    expect(firmwareInput.rows[0].rawValues.firmwareVersion).toBeNull()
    expect(result.rows[0].inclusion).toBe('INCLUDED')
    expect(result.rows[0].ruleEvaluation.originalRow.rawValues.firmwareVersion).toBe('17.5(1r)')
    expect(result.rows[0].ruleEvaluation.fields.firmwareVersion?.ignored).toBe(true)
  })

  it('never silently accepts MATCH_DEVICE output', () => {
    const value = input()
    value.ruleSet.rules = [
      {
        id: 'match-device',
        version: 1,
        name: 'Known source device',
        priority: 100,
        status: 'ACTIVE',
        scope: {},
        when: {
          kind: 'CONDITION',
          field: 'vendor',
          operator: 'NORMALIZED_EXACT',
          value: 'Cisco',
        },
        actions: [
          {
            type: 'MATCH_DEVICE',
            deviceId: 'device-123',
            explanation: 'Known reusable match pattern',
          },
        ],
      },
    ]

    const result = evaluateImporterV2WithRules(value)

    expect(result.rows[0].ruleEvaluation.deviceMatch).toEqual({
      deviceId: 'device-123',
      explanation: 'Known reusable match pattern',
      ruleId: 'match-device',
      ruleVersion: 1,
      requiresConfirmation: true,
    })
    expect(result.rows[0].statuses).toContain('NEEDS_REVIEW')
  })
})
