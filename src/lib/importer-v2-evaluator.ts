import { createHash } from 'node:crypto'

export const IMPORTER_V2_FIELDS = [
  'customer',
  'businessUnit',
  'site',
  'deviceName',
  'hostname',
  'sourceId',
  'serialNumber',
  'macAddress',
  'vendor',
  'productFamily',
  'softwarePlatform',
  'model',
  'deviceType',
  'managementAddress',
  'currentFirmware',
  'firmwareVersion',
  'softwareVersion',
  'notes',
] as const

export type ImporterV2Field = (typeof IMPORTER_V2_FIELDS)[number]
export type ImporterV2Confidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type ImporterV2DecisionSource =
  | 'MANUAL_OVERRIDE'
  | 'REMEMBERED_EXACT_MAPPING'
  | 'PROFILE_RULE'
  | 'DETERMINISTIC_PARSER'
  | 'EXACT_CATALOG_MATCH'
  | 'NON_BINDING_SUGGESTION'
  | 'UNRESOLVED'
export type ImporterV2RowStatus =
  | 'VALID'
  | 'WARNING'
  | 'NEEDS_REVIEW'
  | 'NEW'
  | 'UPDATE'
  | 'UNCHANGED'
  | 'EXCLUDED'

export type ImporterV2CanonicalValue = {
  id: string
  label: string
  aliases?: readonly string[]
}

export type ImporterV2ProposedValue = {
  id: string | null
  label: string
}

export type ImporterV2Condition = {
  field: ImporterV2Field
  operator: 'EQUALS' | 'STARTS_WITH' | 'CONTAINS'
  value: string
}

type ImporterV2Candidate = {
  id: string
  field: ImporterV2Field
  when: ImporterV2Condition
  target: ImporterV2ProposedValue
  confidence?: ImporterV2Confidence
  explanation: string
}

export type ImporterV2ManualOverride = {
  id: string
  rowFingerprint: string
  field: ImporterV2Field
  target: ImporterV2ProposedValue
  explanation: string
}

export type ImporterV2RememberedMapping = {
  id: string
  field: ImporterV2Field
  normalizedInput: string
  target: ImporterV2ProposedValue
  explanation: string
}

export type ImporterV2ProfileRule = ImporterV2Candidate & {
  active: boolean
}

export type ImporterV2ParserDefinition = ImporterV2Candidate & {
  parserVersion: string
}

export type ImporterV2Suggestion = ImporterV2Candidate & {
  confidence: ImporterV2Confidence
}

export type ImporterV2RulesSnapshot = {
  version: string
  manualOverrides: readonly ImporterV2ManualOverride[]
  rememberedMappings: readonly ImporterV2RememberedMapping[]
  profileRules: readonly ImporterV2ProfileRule[]
}

export type ImporterV2ParserSnapshot = {
  version: string
  definitions: readonly ImporterV2ParserDefinition[]
}

export type ImporterV2SuggestionSnapshot = {
  version: string
  suggestions: readonly ImporterV2Suggestion[]
}

export type ImporterV2CatalogSnapshot = {
  version: string
  values: Partial<Record<ImporterV2Field, readonly ImporterV2CanonicalValue[]>>
}

export type ImporterV2ProfileSnapshot = {
  id: string
  version: string
  sourceAdapterId: string
  provider: string
  requiredFields: readonly ImporterV2Field[]
  warnWhenUnresolvedFields: readonly ImporterV2Field[]
}

export type ImporterV2InclusionDecision = {
  status: 'EXCLUDED'
  source: 'MANUAL_OVERRIDE' | 'PROFILE_RULE'
  decisionId: string
  explanation: string
}

export type ImporterV2CanonicalComparison = {
  recordId: string
  values: Partial<Record<ImporterV2Field, ImporterV2ProposedValue | null>>
}

export type ImporterV2StagedRow = {
  rowNumber: number
  sourceRecordKey?: string | null
  rawValues: Partial<Record<ImporterV2Field, string | null>>
  inclusionDecision?: ImporterV2InclusionDecision | null
  comparison?: ImporterV2CanonicalComparison | null
}

export type ImporterV2EvaluationInput = {
  profile: ImporterV2ProfileSnapshot
  catalog: ImporterV2CatalogSnapshot
  rules: ImporterV2RulesSnapshot
  parsers: ImporterV2ParserSnapshot
  suggestions: ImporterV2SuggestionSnapshot
  rows: readonly ImporterV2StagedRow[]
}

export type ImporterV2FieldIssue = {
  rowNumber: number
  rowFingerprint: string
  field: ImporterV2Field
  severity: 'WARNING' | 'ERROR'
  code:
    | 'REQUIRED_FIELD_UNRESOLVED'
    | 'OPTIONAL_FIELD_UNRESOLVED'
    | 'AMBIGUOUS_DECISION'
  message: string
}

export type ImporterV2FieldDecision = {
  source: ImporterV2DecisionSource
  confidence: ImporterV2Confidence
  explanation: string
  requiresConfirmation: boolean
  matchedRuleId: string | null
  matchedRuleVersion: string | null
  matchedParserId: string | null
  matchedParserVersion: string | null
  matchedCatalogValueId: string | null
  matchedCatalogVersion: string | null
  matchedSuggestionId: string | null
  matchedSuggestionVersion: string | null
}

export type ImporterV2EvaluatedField = {
  field: ImporterV2Field
  rawValue: string | null
  normalizedValue: string | null
  proposedValue: ImporterV2ProposedValue | null
  decision: ImporterV2FieldDecision
  issues: readonly ImporterV2FieldIssue[]
}

export type ImporterV2EvaluatedRow = {
  rowNumber: number
  sourceFingerprint: string
  rawValues: Record<ImporterV2Field, string | null>
  normalizedValues: Record<ImporterV2Field, string | null>
  proposedCanonicalValues: Record<
    ImporterV2Field,
    ImporterV2ProposedValue | null
  >
  fields: Record<ImporterV2Field, ImporterV2EvaluatedField>
  issues: readonly ImporterV2FieldIssue[]
  statuses: readonly ImporterV2RowStatus[]
  inclusion: 'INCLUDED' | 'EXCLUDED'
  inclusionDecision: ImporterV2InclusionDecision | null
  comparisonRecordId: string | null
}

export type ImporterV2EvaluationResult = {
  evaluationFingerprint: string
  profileVersion: string
  catalogVersion: string
  ruleVersion: string
  parserVersion: string
  suggestionVersion: string
  rows: readonly ImporterV2EvaluatedRow[]
}

type DecisionResolution = {
  proposedValue: ImporterV2ProposedValue | null
  decision: ImporterV2FieldDecision
  ambiguous?: boolean
}

function normalized(value: string | null | undefined) {
  if (value === null || value === undefined) return null
  const result = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return result || null
}

function matchKey(value: string | null | undefined) {
  return normalized(value)?.toLocaleLowerCase('en-US') ?? null
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

function fingerprint(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function completeRawValues(
  row: ImporterV2StagedRow,
): Record<ImporterV2Field, string | null> {
  return Object.fromEntries(
    IMPORTER_V2_FIELDS.map((field) => [field, row.rawValues[field] ?? null]),
  ) as Record<ImporterV2Field, string | null>
}

function completeNormalizedValues(
  rawValues: Record<ImporterV2Field, string | null>,
): Record<ImporterV2Field, string | null> {
  return Object.fromEntries(
    IMPORTER_V2_FIELDS.map((field) => [field, normalized(rawValues[field])]),
  ) as Record<ImporterV2Field, string | null>
}

export function importerV2SourceFingerprint(
  row: ImporterV2StagedRow,
  profile: ImporterV2ProfileSnapshot,
) {
  return fingerprint({
    provider: profile.provider,
    sourceAdapterId: profile.sourceAdapterId,
    sourceRecordKey: row.sourceRecordKey ?? null,
    rawValues: completeRawValues(row),
  })
}

function conditionMatches(
  condition: ImporterV2Condition,
  normalizedValues: Record<ImporterV2Field, string | null>,
) {
  const actual = matchKey(normalizedValues[condition.field])
  const expected = matchKey(condition.value)
  if (!actual || !expected) return false
  if (condition.operator === 'EQUALS') return actual === expected
  if (condition.operator === 'STARTS_WITH') return actual.startsWith(expected)
  return actual.includes(expected)
}

function specificity(condition: ImporterV2Condition) {
  const length = matchKey(condition.value)?.length ?? 0
  if (condition.operator === 'EQUALS') return 3_000 + length
  if (condition.operator === 'STARTS_WITH') return 2_000 + length
  return 1_000 + length
}

function targetKey(target: ImporterV2ProposedValue) {
  return `${target.id ?? ''}:${matchKey(target.label) ?? ''}`
}

function strongestCandidate<T extends ImporterV2Candidate>(
  candidates: readonly T[],
) {
  const ordered = candidates.toSorted(
    (left, right) =>
      specificity(right.when) - specificity(left.when) ||
      left.id.localeCompare(right.id),
  )
  const best = ordered[0]
  if (!best) return { candidate: null, ambiguous: false }
  const bestSpecificity = specificity(best.when)
  const equallySpecific = ordered.filter(
    (candidate) => specificity(candidate.when) === bestSpecificity,
  )
  return {
    candidate: best,
    ambiguous:
      new Set(equallySpecific.map((candidate) => targetKey(candidate.target)))
        .size > 1,
  }
}

function decision(
  source: ImporterV2DecisionSource,
  confidence: ImporterV2Confidence,
  explanation: string,
  evidence: Partial<ImporterV2FieldDecision> = {},
): ImporterV2FieldDecision {
  return {
    source,
    confidence,
    explanation,
    requiresConfirmation:
      source !== 'MANUAL_OVERRIDE' && source !== 'UNRESOLVED',
    matchedRuleId: null,
    matchedRuleVersion: null,
    matchedParserId: null,
    matchedParserVersion: null,
    matchedCatalogValueId: null,
    matchedCatalogVersion: null,
    matchedSuggestionId: null,
    matchedSuggestionVersion: null,
    ...evidence,
  }
}

function ambiguousDecision(layer: string): DecisionResolution {
  return {
    proposedValue: null,
    ambiguous: true,
    decision: decision(
      'UNRESOLVED',
      'LOW',
      `Multiple equally specific ${layer} candidates propose different values.`,
    ),
  }
}

function resolveField(
  field: ImporterV2Field,
  rowFingerprint: string,
  normalizedValues: Record<ImporterV2Field, string | null>,
  input: ImporterV2EvaluationInput,
): DecisionResolution {
  const manual = input.rules.manualOverrides
    .filter(
      (override) =>
        override.rowFingerprint === rowFingerprint && override.field === field,
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
  if (new Set(manual.map((override) => targetKey(override.target))).size > 1) {
    return ambiguousDecision('manual override')
  }
  if (manual[0]) {
    return {
      proposedValue: { ...manual[0].target },
      decision: decision('MANUAL_OVERRIDE', 'HIGH', manual[0].explanation, {
        matchedRuleId: manual[0].id,
        matchedRuleVersion: input.rules.version,
      }),
    }
  }

  const valueKey = matchKey(normalizedValues[field])
  const remembered = input.rules.rememberedMappings
    .filter(
      (mapping) =>
        mapping.field === field &&
        matchKey(mapping.normalizedInput) === valueKey &&
        valueKey,
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
  if (
    new Set(remembered.map((mapping) => targetKey(mapping.target))).size > 1
  ) {
    return ambiguousDecision('remembered mapping')
  }
  if (remembered[0]) {
    return {
      proposedValue: { ...remembered[0].target },
      decision: decision(
        'REMEMBERED_EXACT_MAPPING',
        'HIGH',
        remembered[0].explanation,
        {
          matchedRuleId: remembered[0].id,
          matchedRuleVersion: input.rules.version,
        },
      ),
    }
  }

  const profileRule = strongestCandidate(
    input.rules.profileRules.filter(
      (rule) =>
        rule.active &&
        rule.field === field &&
        conditionMatches(rule.when, normalizedValues),
    ),
  )
  if (profileRule.ambiguous) return ambiguousDecision('profile rule')
  if (profileRule.candidate) {
    return {
      proposedValue: { ...profileRule.candidate.target },
      decision: decision(
        'PROFILE_RULE',
        profileRule.candidate.confidence ?? 'MEDIUM',
        profileRule.candidate.explanation,
        {
          matchedRuleId: profileRule.candidate.id,
          matchedRuleVersion: input.rules.version,
        },
      ),
    }
  }

  const parser = strongestCandidate(
    input.parsers.definitions.filter(
      (definition) =>
        definition.field === field &&
        conditionMatches(definition.when, normalizedValues),
    ),
  )
  if (parser.ambiguous) return ambiguousDecision('deterministic parser')
  if (parser.candidate) {
    return {
      proposedValue: { ...parser.candidate.target },
      decision: decision(
        'DETERMINISTIC_PARSER',
        parser.candidate.confidence ?? 'MEDIUM',
        parser.candidate.explanation,
        {
          matchedParserId: parser.candidate.id,
          matchedParserVersion: parser.candidate.parserVersion,
        },
      ),
    }
  }

  const catalogMatches = (input.catalog.values[field] ?? [])
    .filter((candidate) =>
      [candidate.label, ...(candidate.aliases ?? [])].some(
        (label) => matchKey(label) === valueKey,
      ),
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
  if (new Set(catalogMatches.map((candidate) => candidate.id)).size > 1) {
    return ambiguousDecision('catalog')
  }
  if (catalogMatches[0]) {
    return {
      proposedValue: {
        id: catalogMatches[0].id,
        label: catalogMatches[0].label,
      },
      decision: decision(
        'EXACT_CATALOG_MATCH',
        'HIGH',
        `The normalized source value exactly matches catalog value “${catalogMatches[0].label}”.`,
        {
          matchedCatalogValueId: catalogMatches[0].id,
          matchedCatalogVersion: input.catalog.version,
        },
      ),
    }
  }

  const suggestion = strongestCandidate(
    input.suggestions.suggestions.filter(
      (candidate) =>
        candidate.field === field &&
        conditionMatches(candidate.when, normalizedValues),
    ),
  )
  if (suggestion.ambiguous) return ambiguousDecision('suggestion')
  if (suggestion.candidate) {
    return {
      proposedValue: { ...suggestion.candidate.target },
      decision: decision(
        'NON_BINDING_SUGGESTION',
        suggestion.candidate.confidence,
        suggestion.candidate.explanation,
        {
          matchedSuggestionId: suggestion.candidate.id,
          matchedSuggestionVersion: input.suggestions.version,
        },
      ),
    }
  }

  const normalizedValue = normalizedValues[field]
  return {
    proposedValue: normalizedValue
      ? { id: null, label: normalizedValue }
      : null,
    decision: decision(
      'UNRESOLVED',
      'LOW',
      normalizedValue
        ? 'No confirmed mapping, rule, parser, or exact catalog match resolved this value.'
        : 'The source did not provide a value.',
    ),
  }
}

function fieldIssues(
  rowNumber: number,
  rowFingerprint: string,
  field: ImporterV2Field,
  resolution: DecisionResolution,
  input: ImporterV2EvaluationInput,
): ImporterV2FieldIssue[] {
  if (resolution.ambiguous) {
    return [
      {
        rowNumber,
        rowFingerprint,
        field,
        severity: 'ERROR',
        code: 'AMBIGUOUS_DECISION',
        message: resolution.decision.explanation,
      },
    ]
  }

  if (resolution.decision.source !== 'UNRESOLVED') return []
  if (input.profile.requiredFields.includes(field)) {
    return [
      {
        rowNumber,
        rowFingerprint,
        field,
        severity: 'ERROR',
        code: 'REQUIRED_FIELD_UNRESOLVED',
        message: `${field} must be resolved before this row can be published.`,
      },
    ]
  }
  if (input.profile.warnWhenUnresolvedFields.includes(field)) {
    return [
      {
        rowNumber,
        rowFingerprint,
        field,
        severity: 'WARNING',
        code: 'OPTIONAL_FIELD_UNRESOLVED',
        message: `${field} is unknown and remains available for review.`,
      },
    ]
  }
  return []
}

function sameCanonicalValue(
  proposed: ImporterV2ProposedValue,
  existing: ImporterV2ProposedValue | null | undefined,
) {
  if (!existing) return false
  if (proposed.id && existing.id) return proposed.id === existing.id
  return matchKey(proposed.label) === matchKey(existing.label)
}

function changeStatus(
  comparison: ImporterV2CanonicalComparison | null | undefined,
  fields: Record<ImporterV2Field, ImporterV2EvaluatedField>,
): 'NEW' | 'UPDATE' | 'UNCHANGED' {
  if (!comparison) return 'NEW'
  const changed = IMPORTER_V2_FIELDS.some((field) => {
    const proposed = fields[field].proposedValue
    return proposed
      ? !sameCanonicalValue(proposed, comparison.values[field])
      : false
  })
  return changed ? 'UPDATE' : 'UNCHANGED'
}

function evaluateRow(
  row: ImporterV2StagedRow,
  input: ImporterV2EvaluationInput,
): ImporterV2EvaluatedRow {
  const rawValues = completeRawValues(row)
  const normalizedValues = completeNormalizedValues(rawValues)
  const sourceFingerprint = importerV2SourceFingerprint(row, input.profile)
  const evaluatedFields = {} as Record<
    ImporterV2Field,
    ImporterV2EvaluatedField
  >
  for (const field of IMPORTER_V2_FIELDS) {
    const resolution = resolveField(
      field,
      sourceFingerprint,
      normalizedValues,
      input,
    )
    const issues = fieldIssues(
      row.rowNumber,
      sourceFingerprint,
      field,
      resolution,
      input,
    )
    evaluatedFields[field] = {
      field,
      rawValue: rawValues[field],
      normalizedValue: normalizedValues[field],
      proposedValue: resolution.proposedValue,
      decision: resolution.decision,
      issues,
    }
  }
  const issues = IMPORTER_V2_FIELDS.flatMap(
    (field) => evaluatedFields[field].issues,
  )
  const inclusionDecision = row.inclusionDecision
    ? { ...row.inclusionDecision }
    : null
  const inclusion = inclusionDecision ? 'EXCLUDED' : 'INCLUDED'

  if (inclusion === 'EXCLUDED') {
    return {
      rowNumber: row.rowNumber,
      sourceFingerprint,
      rawValues,
      normalizedValues,
      proposedCanonicalValues: Object.fromEntries(
        IMPORTER_V2_FIELDS.map((field) => [
          field,
          evaluatedFields[field].proposedValue,
        ]),
      ) as Record<ImporterV2Field, ImporterV2ProposedValue | null>,
      fields: evaluatedFields,
      issues,
      statuses: ['EXCLUDED'],
      inclusion,
      inclusionDecision,
      comparisonRecordId: row.comparison?.recordId ?? null,
    }
  }

  const statuses = new Set<ImporterV2RowStatus>()
  const needsReview =
    issues.some((issue) => issue.severity === 'ERROR') ||
    IMPORTER_V2_FIELDS.some(
      (field) => evaluatedFields[field].decision.requiresConfirmation,
    )
  if (needsReview) statuses.add('NEEDS_REVIEW')
  if (issues.some((issue) => issue.severity === 'WARNING'))
    statuses.add('WARNING')
  if (!needsReview && statuses.size === 0) statuses.add('VALID')
  statuses.add(changeStatus(row.comparison, evaluatedFields))

  return {
    rowNumber: row.rowNumber,
    sourceFingerprint,
    rawValues,
    normalizedValues,
    proposedCanonicalValues: Object.fromEntries(
      IMPORTER_V2_FIELDS.map((field) => [
        field,
        evaluatedFields[field].proposedValue,
      ]),
    ) as Record<ImporterV2Field, ImporterV2ProposedValue | null>,
    fields: evaluatedFields,
    issues,
    statuses: [...statuses],
    inclusion,
    inclusionDecision,
    comparisonRecordId: row.comparison?.recordId ?? null,
  }
}

export function evaluateImporterV2(
  input: ImporterV2EvaluationInput,
): ImporterV2EvaluationResult {
  const rows = input.rows.map((row) => evaluateRow(row, input))
  return {
    evaluationFingerprint: fingerprint({
      profile: input.profile,
      catalog: input.catalog,
      rules: input.rules,
      parsers: input.parsers,
      suggestions: input.suggestions,
      rows: input.rows,
    }),
    profileVersion: input.profile.version,
    catalogVersion: input.catalog.version,
    ruleVersion: input.rules.version,
    parserVersion: input.parsers.version,
    suggestionVersion: input.suggestions.version,
    rows,
  }
}
