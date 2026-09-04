import { createHash } from 'node:crypto'
import type {
  ImporterV2Field,
  ImporterV2FieldDecision,
  ImporterV2FieldIssue,
  ImporterV2RememberedMapping,
  ImporterV2RowStatus,
} from '@/lib/importer-v2-evaluator'
import {
  evaluateImporterV2WithFirmware,
  type ImporterV2FirmwareEvaluatedRow,
  type ImporterV2FirmwareEvaluationInput,
  type ImporterV2FirmwareEvaluationResult,
} from '@/lib/importer-v2-firmware-evaluation'
import { compileImporterV2RuleSet } from '@/lib/importer-v2-rule-compiler'
import { evaluateImporterV2RuleRows } from '@/lib/importer-v2-rule-engine'
import type {
  ImporterV2ExactMappingDefinition,
  ImporterV2RuleFieldOutcome,
  ImporterV2RuleRowEvaluation,
  ImporterV2RuleSetSnapshot,
} from '@/lib/importer-v2-rule-types'

export type ImporterV2RuleEvaluationInput = ImporterV2FirmwareEvaluationInput & {
  ruleSet: ImporterV2RuleSetSnapshot
  exactMappings?: readonly ImporterV2ExactMappingDefinition[]
}

export type ImporterV2RuleEvaluatedRow = ImporterV2FirmwareEvaluatedRow & {
  ruleEvaluation: ImporterV2RuleRowEvaluation
}

export type ImporterV2RuleEvaluationResult = Omit<
  ImporterV2FirmwareEvaluationResult,
  'evaluationFingerprint' | 'rows' | 'ruleVersion'
> & {
  evaluationFingerprint: string
  ruleBookId: string
  ruleRevisionId: string
  ruleVersion: number
  rows: readonly ImporterV2RuleEvaluatedRow[]
  ruleCandidateChecks: number
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

function mappingApplies(
  mapping: ImporterV2ExactMappingDefinition,
  input: ImporterV2RuleEvaluationInput,
) {
  if (!mapping.isActive) return false
  if (mapping.provider.toLocaleLowerCase('en-US') !== input.profile.provider.toLocaleLowerCase('en-US')) {
    return false
  }
  return !mapping.profileId || mapping.profileId === input.profile.id
}

function rememberedMappings(
  input: ImporterV2RuleEvaluationInput,
): readonly ImporterV2RememberedMapping[] {
  const persisted = (input.exactMappings ?? [])
    .filter((mapping) => mappingApplies(mapping, input))
    .map((mapping) => ({
      id: mapping.id,
      field: mapping.field,
      normalizedInput: mapping.normalizedInput,
      target: mapping.target,
      explanation: mapping.explanation,
    }))
  return [...input.rules.rememberedMappings, ...persisted]
}

function ruleDecision(outcome: ImporterV2RuleFieldOutcome): ImporterV2FieldDecision {
  const trace = outcome.applied[0]
  return {
    source: 'PROFILE_RULE',
    confidence: 'HIGH',
    explanation: outcome.ignored
      ? `Importer rule ${trace.ruleName} intentionally ignores source field ${outcome.field}.`
      : `Importer rule ${trace.ruleName} produced this staged value.`,
    requiresConfirmation: true,
    matchedRuleId: trace.ruleId,
    matchedRuleVersion: String(trace.ruleVersion),
    matchedParserId: null,
    matchedParserVersion: null,
    matchedCatalogValueId: null,
    matchedCatalogVersion: null,
    matchedSuggestionId: null,
    matchedSuggestionVersion: null,
  }
}

function filteredIssues(
  issues: readonly ImporterV2FieldIssue[],
  field: ImporterV2Field,
  outcome: ImporterV2RuleFieldOutcome,
) {
  return issues.filter((issue) => {
    if (issue.field !== field) return true
    if (outcome.mappedTarget) return false
    if (
      (outcome.ignored || outcome.effectiveValue === null) &&
      issue.code === 'OPTIONAL_FIELD_UNRESOLVED'
    ) {
      return false
    }
    return true
  })
}

function statusesForRuleEvaluation(
  base: readonly ImporterV2RowStatus[],
  ruleEvaluation: ImporterV2RuleRowEvaluation,
) {
  if (ruleEvaluation.effectiveRow.inclusionDecision) return ['EXCLUDED'] as const
  const statuses = new Set(base)
  if (
    ruleEvaluation.applied.length > 0 ||
    ruleEvaluation.conflicts.length > 0 ||
    ruleEvaluation.deviceMatch
  ) {
    statuses.delete('VALID')
    statuses.add('NEEDS_REVIEW')
  }
  return [...statuses]
}

function overlayRuleOutcomes(
  base: ImporterV2FirmwareEvaluatedRow,
  ruleEvaluation: ImporterV2RuleRowEvaluation,
): ImporterV2RuleEvaluatedRow {
  const fields = { ...base.fields }
  let issues = [...base.issues]
  const proposedCanonicalValues = { ...base.proposedCanonicalValues }

  for (const [field, outcome] of Object.entries(ruleEvaluation.fields) as [
    ImporterV2Field,
    ImporterV2RuleFieldOutcome | undefined,
  ][]) {
    if (!outcome || outcome.applied.length === 0) continue
    issues = filteredIssues(issues, field, outcome)
    const fieldIssues = filteredIssues(base.fields[field].issues, field, outcome)
    const proposedValue = outcome.mappedTarget ?? base.fields[field].proposedValue
    fields[field] = {
      ...base.fields[field],
      rawValue: outcome.originalValue,
      normalizedValue: outcome.effectiveValue,
      proposedValue: outcome.ignored ? null : proposedValue,
      decision: ruleDecision(outcome),
      issues: fieldIssues,
    }
    proposedCanonicalValues[field] = outcome.ignored ? null : proposedValue
  }

  return {
    ...base,
    fields,
    issues,
    proposedCanonicalValues,
    statuses: statusesForRuleEvaluation(base.statuses, ruleEvaluation),
    inclusion: ruleEvaluation.effectiveRow.inclusionDecision
      ? 'EXCLUDED'
      : base.inclusion,
    inclusionDecision:
      ruleEvaluation.effectiveRow.inclusionDecision ?? base.inclusionDecision,
    ruleEvaluation,
  }
}

/**
 * Canonical Importer v2 rule-aware evaluation boundary.
 *
 * Generalized rules run against the immutable staged source snapshot first.
 * Their effective values then flow through the existing generic evaluator and
 * the deterministic firmware interpreter from Issue #48. Legacy profileRules
 * are deliberately removed so two rule engines never compete.
 */
export function evaluateImporterV2WithRules(
  input: ImporterV2RuleEvaluationInput,
): ImporterV2RuleEvaluationResult {
  const compiled = compileImporterV2RuleSet(input.ruleSet)
  const context = {
    profileId: input.profile.id,
    provider: input.profile.provider,
    sourceAdapterId: input.profile.sourceAdapterId,
  }
  const ruleRows = evaluateImporterV2RuleRows(compiled, input.rows, context)

  const firmwareInput: ImporterV2FirmwareEvaluationInput = {
    profile: input.profile,
    catalog: input.catalog,
    rules: {
      version: `${input.rules.version}|rulebook:${input.ruleSet.version}`,
      manualOverrides: input.rules.manualOverrides,
      rememberedMappings: rememberedMappings(input),
      profileRules: [],
    },
    parsers: input.parsers,
    suggestions: input.suggestions,
    rows: ruleRows.map((row) => row.effectiveRow),
    firmwareContext: input.firmwareContext,
    providerMetadataByRow: input.providerMetadataByRow,
  }
  const base = evaluateImporterV2WithFirmware(firmwareInput)
  const rows = base.rows.map((row, index) =>
    overlayRuleOutcomes(row, ruleRows[index]),
  )
  const ruleCandidateChecks = ruleRows.reduce(
    (sum, row) => sum + row.candidateRuleCount,
    0,
  )

  return {
    ...base,
    evaluationFingerprint: fingerprint({
      baseEvaluationFingerprint: base.evaluationFingerprint,
      ruleBookId: input.ruleSet.ruleBookId,
      ruleRevisionId: input.ruleSet.revisionId,
      ruleVersion: input.ruleSet.version,
      ruleRows: ruleRows.map((row) => ({
        rowNumber: row.rowNumber,
        applied: row.applied.map((trace) => ({
          ruleId: trace.ruleId,
          ruleVersion: trace.ruleVersion,
          actionIndex: trace.actionIndex,
        })),
        conflicts: row.conflicts,
      })),
    }),
    ruleBookId: input.ruleSet.ruleBookId,
    ruleRevisionId: input.ruleSet.revisionId,
    ruleVersion: input.ruleSet.version,
    rows,
    ruleCandidateChecks,
  }
}
