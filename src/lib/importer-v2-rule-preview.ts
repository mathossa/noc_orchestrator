import type { ImporterV2Field, ImporterV2StagedRow } from '@/lib/importer-v2-evaluator'
import { compileImporterV2RuleSet } from '@/lib/importer-v2-rule-compiler'
import { evaluateImporterV2RuleRows } from '@/lib/importer-v2-rule-engine'
import { normalizeImporterV2RuleText } from '@/lib/importer-v2-rule-matcher'
import type {
  ImporterV2RuleContext,
  ImporterV2RuleDefinition,
  ImporterV2RulePreview,
  ImporterV2RuleSetSnapshot,
} from '@/lib/importer-v2-rule-types'

function unique(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.map(normalizeImporterV2RuleText).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
}

function isBroad(rule: ImporterV2RuleDefinition) {
  return !Object.values(rule.scope).some(
    (value) => Array.isArray(value) && value.length > 0,
  )
}

export function previewImporterV2RuleChange(input: {
  baseRuleSet: ImporterV2RuleSetSnapshot
  candidateRule: ImporterV2RuleDefinition
  rows: readonly ImporterV2StagedRow[]
  context: ImporterV2RuleContext
  sampleLimit?: number
}): ImporterV2RulePreview {
  const withoutCandidate = input.baseRuleSet.rules.filter(
    (rule) => rule.id !== input.candidateRule.id,
  )
  const candidateSnapshot: ImporterV2RuleSetSnapshot = {
    ...input.baseRuleSet,
    rules: [...withoutCandidate, { ...input.candidateRule, status: 'ACTIVE' }],
  }
  const compiled = compileImporterV2RuleSet(candidateSnapshot)
  const evaluated = evaluateImporterV2RuleRows(compiled, input.rows, input.context)

  const relevant = evaluated.filter((row) =>
    row.applied.some((trace) => trace.ruleId === input.candidateRule.id) ||
    row.conflicts.some((conflict) => conflict.ruleIds.includes(input.candidateRule.id)),
  )
  const changedFields = new Set<ImporterV2Field>()
  for (const row of relevant) {
    for (const [field, outcome] of Object.entries(row.fields) as [
      ImporterV2Field,
      (typeof row.fields)[ImporterV2Field],
    ][]) {
      if (!outcome) continue
      if (outcome.applied.some((trace) => trace.ruleId === input.candidateRule.id)) {
        changedFields.add(field)
      }
    }
  }

  const allConflicts = relevant.flatMap((row) => row.conflicts)
  const conflictKey = (conflict: (typeof allConflicts)[number]) =>
    `${conflict.slot}:${conflict.priority}:${conflict.specificity}:${conflict.ruleIds.join(',')}`
  const conflicts = [...new Map(allConflicts.map((conflict) => [conflictKey(conflict), conflict])).values()]

  const confirmationReasons: string[] = []
  if (input.candidateRule.actions.some((action) => action.type === 'EXCLUDE_ROW')) {
    confirmationReasons.push('The rule can exclude rows from import.')
  }
  if (isBroad(input.candidateRule)) {
    confirmationReasons.push('The rule has no explicit inventory/source scope.')
  }
  if (relevant.length >= Math.max(100, Math.ceil(input.rows.length * 0.25))) {
    confirmationReasons.push('The rule affects a broad share of the staged batch.')
  }
  if (conflicts.length > 0) {
    confirmationReasons.push('The rule conflicts with an equal-priority rule.')
  }

  const sampleLimit = Math.max(1, Math.min(input.sampleLimit ?? 8, 25))
  return {
    matchedRowCount: relevant.length,
    excludedRowCount: relevant.filter((row) => row.excluded).length,
    changedFields: [...changedFields].sort((a, b) => a.localeCompare(b)),
    affectedCustomers: unique(relevant.map((row) => row.originalRow.rawValues.customer)),
    affectedSites: unique(relevant.map((row) => row.originalRow.rawValues.site)),
    affectedModels: unique(relevant.map((row) => row.originalRow.rawValues.model)),
    conflicts,
    examples: relevant.slice(0, sampleLimit).map((row) => ({
      rowNumber: row.rowNumber,
      before: { ...row.originalRow.rawValues },
      after: { ...row.effectiveRow.rawValues },
      excluded: row.excluded,
      conflicts: row.conflicts,
    })),
    requiresExplicitConfirmation: confirmationReasons.length > 0,
    confirmationReasons,
  }
}
