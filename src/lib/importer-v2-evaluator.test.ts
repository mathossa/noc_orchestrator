import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  evaluateImporterV2,
  importerV2SourceFingerprint,
  type ImporterV2DecisionSource,
  type ImporterV2EvaluationInput,
  type ImporterV2ProfileSnapshot,
  type ImporterV2StagedRow,
} from '@/lib/importer-v2-evaluator'
import { IMPORTER_V2_REGRESSION_FIXTURES } from '@/lib/importer-v2-regression-fixtures'

const profile: ImporterV2ProfileSnapshot = {
  id: 'profile-1',
  version: 'profile-v1',
  sourceAdapterId: 'synthetic-adapter',
  provider: 'SyntheticCMDB',
  requiredFields: [],
  warnWhenUnresolvedFields: [],
}

const row: ImporterV2StagedRow = {
  rowNumber: 2,
  sourceRecordKey: 'source-device-1',
  rawValues: { vendor: '  Acme   Networks  ' },
}

function baseInput(): ImporterV2EvaluationInput {
  return {
    profile: { ...profile },
    catalog: {
      version: 'catalog-v1',
      values: {
        vendor: [{ id: 'catalog-vendor', label: 'Acme Networks' }],
      },
    },
    rules: {
      version: 'rules-v1',
      manualOverrides: [],
      rememberedMappings: [],
      profileRules: [],
    },
    parsers: { version: 'parsers-v1', definitions: [] },
    suggestions: { version: 'suggestions-v1', suggestions: [] },
    rows: [{ ...row, rawValues: { ...row.rawValues } }],
  }
}

function precedenceInput(): ImporterV2EvaluationInput {
  const input = baseInput()
  const rowFingerprint = importerV2SourceFingerprint(
    input.rows[0],
    input.profile,
  )
  input.rules.manualOverrides = [
    {
      id: 'manual-1',
      rowFingerprint,
      field: 'vendor',
      target: { id: 'manual-vendor', label: 'Manual Vendor' },
      explanation: 'The importer explicitly chose this vendor.',
    },
  ]
  input.rules.rememberedMappings = [
    {
      id: 'remembered-1',
      field: 'vendor',
      normalizedInput: 'Acme Networks',
      target: { id: 'remembered-vendor', label: 'Remembered Vendor' },
      explanation: 'A previously confirmed exact mapping matches.',
    },
  ]
  input.rules.profileRules = [
    {
      id: 'profile-rule-1',
      active: true,
      field: 'vendor',
      when: { field: 'vendor', operator: 'EQUALS', value: 'Acme Networks' },
      target: { id: 'profile-vendor', label: 'Profile Vendor' },
      explanation: 'An active profile rule matches.',
    },
  ]
  input.parsers.definitions = [
    {
      id: 'parser-1',
      parserVersion: 'vendor-parser-v3',
      field: 'vendor',
      when: { field: 'vendor', operator: 'EQUALS', value: 'Acme Networks' },
      target: { id: 'parser-vendor', label: 'Parsed Vendor' },
      explanation: 'The deterministic vendor parser matches.',
    },
  ]
  input.suggestions.suggestions = [
    {
      id: 'suggestion-1',
      field: 'vendor',
      when: { field: 'vendor', operator: 'EQUALS', value: 'Acme Networks' },
      target: { id: 'suggested-vendor', label: 'Suggested Vendor' },
      confidence: 'LOW',
      explanation: 'A non-binding similarity suggestion matches.',
    },
  ]
  return input
}

function vendorDecision(input: ImporterV2EvaluationInput) {
  return evaluateImporterV2(input).rows[0].fields.vendor
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

describe('Importer v2 pure staged evaluator', () => {
  it('keeps the evaluator free of persistence, store, API, and network dependencies', () => {
    const source = readFileSync(
      new URL('./importer-v2-evaluator.ts', import.meta.url),
      'utf8',
    )
    const imports = [
      ...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm),
    ].map((match) => match[1])

    expect(imports).toEqual(['node:crypto'])
    expect(source).not.toMatch(
      /@\/lib\/prisma|@\/lib\/.*store|\bfetch\(|\$transaction/,
    )
  })

  it('applies the documented decision precedence without overwriting raw evidence', () => {
    const layers: Array<{
      source: ImporterV2DecisionSource
      removeHigherLayers: (input: ImporterV2EvaluationInput) => void
      expectedId: string | null
    }> = [
      {
        source: 'MANUAL_OVERRIDE',
        removeHigherLayers: () => undefined,
        expectedId: 'manual-vendor',
      },
      {
        source: 'REMEMBERED_EXACT_MAPPING',
        removeHigherLayers: (input) => {
          input.rules.manualOverrides = []
        },
        expectedId: 'remembered-vendor',
      },
      {
        source: 'PROFILE_RULE',
        removeHigherLayers: (input) => {
          input.rules.manualOverrides = []
          input.rules.rememberedMappings = []
        },
        expectedId: 'profile-vendor',
      },
      {
        source: 'DETERMINISTIC_PARSER',
        removeHigherLayers: (input) => {
          input.rules.manualOverrides = []
          input.rules.rememberedMappings = []
          input.rules.profileRules = []
        },
        expectedId: 'parser-vendor',
      },
      {
        source: 'EXACT_CATALOG_MATCH',
        removeHigherLayers: (input) => {
          input.rules.manualOverrides = []
          input.rules.rememberedMappings = []
          input.rules.profileRules = []
          input.parsers.definitions = []
        },
        expectedId: 'catalog-vendor',
      },
      {
        source: 'NON_BINDING_SUGGESTION',
        removeHigherLayers: (input) => {
          input.rules.manualOverrides = []
          input.rules.rememberedMappings = []
          input.rules.profileRules = []
          input.parsers.definitions = []
          input.catalog.values.vendor = []
        },
        expectedId: 'suggested-vendor',
      },
      {
        source: 'UNRESOLVED',
        removeHigherLayers: (input) => {
          input.rules.manualOverrides = []
          input.rules.rememberedMappings = []
          input.rules.profileRules = []
          input.parsers.definitions = []
          input.catalog.values.vendor = []
          input.suggestions.suggestions = []
        },
        expectedId: null,
      },
    ]

    for (const layer of layers) {
      const input = precedenceInput()
      layer.removeHigherLayers(input)
      const field = vendorDecision(input)

      expect(field.decision.source).toBe(layer.source)
      expect(field.proposedValue?.id ?? null).toBe(layer.expectedId)
      expect(field.rawValue).toBe('  Acme   Networks  ')
      expect(field.normalizedValue).toBe('Acme Networks')
    }
  })

  it('exposes rule, parser, catalog, and suggestion version evidence', () => {
    const manual = vendorDecision(precedenceInput())
    expect(manual.decision).toMatchObject({
      matchedRuleId: 'manual-1',
      matchedRuleVersion: 'rules-v1',
    })

    const parserInput = precedenceInput()
    parserInput.rules.manualOverrides = []
    parserInput.rules.rememberedMappings = []
    parserInput.rules.profileRules = []
    const parser = vendorDecision(parserInput)
    expect(parser.decision).toMatchObject({
      matchedParserId: 'parser-1',
      matchedParserVersion: 'vendor-parser-v3',
    })

    const catalogInput = structuredClone(parserInput)
    catalogInput.parsers.definitions = []
    const catalog = vendorDecision(catalogInput)
    expect(catalog.decision).toMatchObject({
      matchedCatalogValueId: 'catalog-vendor',
      matchedCatalogVersion: 'catalog-v1',
    })

    const suggestionInput = structuredClone(catalogInput)
    suggestionInput.catalog.values.vendor = []
    const suggestion = vendorDecision(suggestionInput)
    expect(suggestion.decision).toMatchObject({
      matchedSuggestionId: 'suggestion-1',
      matchedSuggestionVersion: 'suggestions-v1',
    })
  })

  it('uses the most specific rule and rejects equally specific conflicting outcomes', () => {
    const input = baseInput()
    input.catalog.values.vendor = []
    input.rules.profileRules = [
      {
        id: 'contains',
        active: true,
        field: 'vendor',
        when: { field: 'vendor', operator: 'CONTAINS', value: 'Acme' },
        target: { id: 'contains-target', label: 'Contains target' },
        explanation: 'Contains rule.',
      },
      {
        id: 'exact',
        active: true,
        field: 'vendor',
        when: { field: 'vendor', operator: 'EQUALS', value: 'Acme Networks' },
        target: { id: 'exact-target', label: 'Exact target' },
        explanation: 'Exact rule.',
      },
    ]

    expect(vendorDecision(input).proposedValue?.id).toBe('exact-target')

    input.rules.profileRules = [
      ...input.rules.profileRules,
      {
        id: 'exact-conflict',
        active: true,
        field: 'vendor',
        when: { field: 'vendor', operator: 'EQUALS', value: 'Acme Networks' },
        target: { id: 'different-target', label: 'Different target' },
        explanation: 'Conflicting exact rule.',
      },
    ]
    const conflict = vendorDecision(input)

    expect(conflict.proposedValue).toBeNull()
    expect(conflict.issues).toEqual([
      expect.objectContaining({
        field: 'vendor',
        severity: 'ERROR',
        code: 'AMBIGUOUS_DECISION',
      }),
    ])
  })

  it('is deterministic, idempotent, and does not mutate frozen input snapshots', () => {
    const input = deepFreeze(precedenceInput())

    const first = evaluateImporterV2(input)
    const second = evaluateImporterV2(input)

    expect(second).toEqual(first)
    expect(second.evaluationFingerprint).toBe(first.evaluationFingerprint)
  })

  it('creates stable source fingerprints independent of raw object key order', () => {
    const first = importerV2SourceFingerprint(
      { rowNumber: 2, rawValues: { vendor: 'Acme', model: 'A-1' } },
      profile,
    )
    const second = importerV2SourceFingerprint(
      { rowNumber: 99, rawValues: { model: 'A-1', vendor: 'Acme' } },
      profile,
    )

    expect(second).toBe(first)
  })

  it('attaches optional warnings and required errors to their field without excluding rows', () => {
    const warningInput = baseInput()
    warningInput.profile.warnWhenUnresolvedFields = ['currentFirmware']
    const warningRow = evaluateImporterV2(warningInput).rows[0]

    expect(warningRow.fields.currentFirmware.issues).toEqual([
      expect.objectContaining({
        field: 'currentFirmware',
        severity: 'WARNING',
        code: 'OPTIONAL_FIELD_UNRESOLVED',
      }),
    ])
    expect(warningRow.statuses).toContain('WARNING')
    expect(warningRow.statuses).not.toContain('EXCLUDED')

    const requiredInput = baseInput()
    requiredInput.profile.requiredFields = ['currentFirmware']
    const requiredRow = evaluateImporterV2(requiredInput).rows[0]

    expect(requiredRow.fields.currentFirmware.issues).toEqual([
      expect.objectContaining({
        field: 'currentFirmware',
        severity: 'ERROR',
        code: 'REQUIRED_FIELD_UNRESOLVED',
      }),
    ])
    expect(requiredRow.statuses).toContain('NEEDS_REVIEW')
    expect(requiredRow.statuses).not.toContain('EXCLUDED')
  })

  it('only excludes a row through a separate explicit inclusion decision', () => {
    const input = baseInput()
    input.rows[0].inclusionDecision = {
      status: 'EXCLUDED',
      source: 'MANUAL_OVERRIDE',
      decisionId: 'exclude-1',
      explanation: 'The importer explicitly excluded this row.',
    }
    const evaluated = evaluateImporterV2(input).rows[0]

    expect(evaluated.inclusion).toBe('EXCLUDED')
    expect(evaluated.statuses).toEqual(['EXCLUDED'])
    expect(evaluated.inclusionDecision).toMatchObject({
      decisionId: 'exclude-1',
    })
  })

  it('supports New, Update, and Unchanged independently from review state', () => {
    const newInput = precedenceInput()
    const newStatuses = evaluateImporterV2(newInput).rows[0].statuses
    expect(newStatuses).toContain('VALID')
    expect(newStatuses).toContain('NEW')

    const unchangedInput = precedenceInput()
    unchangedInput.rows[0].comparison = {
      recordId: 'device-1',
      values: { vendor: { id: 'manual-vendor', label: 'Manual Vendor' } },
    }
    expect(evaluateImporterV2(unchangedInput).rows[0].statuses).toContain(
      'UNCHANGED',
    )

    const updateInput = precedenceInput()
    updateInput.rows[0].comparison = {
      recordId: 'device-1',
      values: { vendor: { id: 'old-vendor', label: 'Old Vendor' } },
    }
    expect(evaluateImporterV2(updateInput).rows[0].statuses).toContain('UPDATE')
  })

  it('keeps both firmware columns from the Issue #44 regression fixtures as raw evidence', () => {
    const fixtureRows: ImporterV2StagedRow[] =
      IMPORTER_V2_REGRESSION_FIXTURES.map((fixture) => ({
        rowNumber: fixture.rowNumber,
        sourceRecordKey: fixture.source.sourceId,
        rawValues: {
          customer: fixture.source.customer,
          businessUnit: fixture.source.businessUnit,
          site: fixture.source.site,
          deviceName: fixture.source.deviceName,
          sourceId: fixture.source.sourceId,
          serialNumber: fixture.source.serialNumber,
          macAddress: fixture.source.macAddress,
          vendor: fixture.source.vendor,
          productFamily: fixture.source.productFamily,
          softwarePlatform: fixture.source.softwarePlatform,
          model: fixture.source.model,
          deviceType: fixture.source.deviceType,
          firmwareVersion: fixture.source.firmwareVersion,
          softwareVersion: fixture.source.softwareVersion,
        },
      }))
    const input = baseInput()
    input.rows = fixtureRows
    const evaluated = evaluateImporterV2(input)

    expect(evaluated.rows).toHaveLength(IMPORTER_V2_REGRESSION_FIXTURES.length)
    for (const [index, evaluatedRow] of evaluated.rows.entries()) {
      expect(evaluatedRow.fields.firmwareVersion.rawValue).toBe(
        IMPORTER_V2_REGRESSION_FIXTURES[index].source.firmwareVersion,
      )
      expect(evaluatedRow.fields.softwareVersion.rawValue).toBe(
        IMPORTER_V2_REGRESSION_FIXTURES[index].source.softwareVersion,
      )
    }
  })

  it('records high, medium, and low confidence while requiring confirmation for suggestions', () => {
    const input = precedenceInput()
    input.rules.manualOverrides = []
    const remembered = vendorDecision(input)
    expect(remembered.decision).toMatchObject({
      confidence: 'HIGH',
      requiresConfirmation: true,
    })

    input.rules.rememberedMappings = []
    const rule = vendorDecision(input)
    expect(rule.decision).toMatchObject({
      confidence: 'MEDIUM',
      requiresConfirmation: true,
    })

    input.rules.profileRules = []
    input.parsers.definitions = []
    input.catalog.values.vendor = []
    const suggestion = vendorDecision(input)
    expect(suggestion.decision).toMatchObject({
      confidence: 'LOW',
      requiresConfirmation: true,
    })
  })
})
