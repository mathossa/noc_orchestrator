import type {
  ImporterV2Field,
  ImporterV2ProposedValue,
  ImporterV2StagedRow,
} from '@/lib/importer-v2-evaluator'
import {
  importerV2RuleActionFields,
  importerV2RuleActionSlots,
} from '@/lib/importer-v2-rule-compiler'
import {
  importerV2RuleExpressionMatches,
  importerV2RuleKey,
  importerV2RuleScopeMatches,
  importerV2RuleSpecificity,
  normalizeImporterV2RuleText,
} from '@/lib/importer-v2-rule-matcher'
import type {
  ImporterV2CompiledRuleSet,
  ImporterV2RuleAction,
  ImporterV2RuleApplicationTrace,
  ImporterV2RuleConflict,
  ImporterV2RuleContext,
  ImporterV2RuleDefinition,
  ImporterV2RuleFieldOutcome,
  ImporterV2RuleRowEvaluation,
} from '@/lib/importer-v2-rule-types'

type RuleMatch = {
  rule: ImporterV2RuleDefinition
  conditions: ImporterV2RuleApplicationTrace['conditions']
  specificity: number
}

type ActionContender = {
  match: RuleMatch
  action: ImporterV2RuleAction
  actionIndex: number
  slots: readonly string[]
}

function completeValues(
  row: ImporterV2StagedRow,
): Partial<Record<ImporterV2Field, string | null>> {
  return { ...row.rawValues }
}

function rowAnchorKeys(
  row: ImporterV2StagedRow,
  context: ImporterV2RuleContext,
): readonly string[] {
  const values = completeValues(row)
  const keys = new Set<string>()
  const add = (kind: string, value: string | null | undefined) => {
    const normalized = importerV2RuleKey(value)
    if (normalized) keys.add(`scope:${kind}:${normalized}`)
  }
  add('profile', context.profileId)
  add('provider', context.provider)
  add('adapter', context.sourceAdapterId)
  add('customer', values.customer)
  add('businessUnit', values.businessUnit)
  add('site', values.site)
  add('vendor', values.vendor)
  add('model', values.model)
  add('productFamily', values.productFamily)
  add('deviceType', values.deviceType)

  for (const [field, value] of Object.entries(values) as [
    ImporterV2Field,
    string | null | undefined,
  ][]) {
    const normalized = importerV2RuleKey(value)
    if (normalized) keys.add(`field:${field}:${normalized}`)
  }
  return [...keys]
}

function candidateIndexes(
  compiled: ImporterV2CompiledRuleSet,
  row: ImporterV2StagedRow,
  context: ImporterV2RuleContext,
) {
  const indexes = new Set<number>(compiled.broadRuleIndexes)
  for (const key of rowAnchorKeys(row, context)) {
    for (const index of compiled.anchorIndex.get(key) ?? []) indexes.add(index)
  }
  return [...indexes].sort((left, right) => left - right)
}

function matchRules(
  compiled: ImporterV2CompiledRuleSet,
  row: ImporterV2StagedRow,
  context: ImporterV2RuleContext,
): { matches: readonly RuleMatch[]; candidateRuleCount: number } {
  const values = completeValues(row)
  const indexes = candidateIndexes(compiled, row, context)
  const matches: RuleMatch[] = []

  for (const index of indexes) {
    const rule = compiled.activeRules[index]
    const actionFields = importerV2RuleActionFields(rule.actions)
    if (!importerV2RuleScopeMatches(rule.scope, context, values, actionFields)) {
      continue
    }
    const expression = importerV2RuleExpressionMatches(rule.when, values)
    if (!expression.matched) continue
    matches.push({
      rule,
      conditions: expression.conditions,
      specificity: importerV2RuleSpecificity(rule),
    })
  }

  return { matches, candidateRuleCount: indexes.length }
}

function actionSignature(action: ImporterV2RuleAction) {
  if (action.type === 'MAP_VALUE') {
    return `${action.type}:${action.field}:${action.target.id ?? ''}:${importerV2RuleKey(action.target.label) ?? ''}`
  }
  if (action.type === 'SET_FIELD') {
    return `${action.type}:${action.field}:${normalizeImporterV2RuleText(action.value) ?? ''}`
  }
  if (action.type === 'CLEAR_FIELD' || action.type === 'IGNORE_FIELD') {
    return `${action.type}:${action.field}`
  }
  if (action.type === 'EXCLUDE_ROW') {
    return `${action.type}:${importerV2RuleKey(action.reason) ?? ''}`
  }
  if (action.type === 'MATCH_DEVICE') return `${action.type}:${action.deviceId}`
  if (action.type === 'TRANSFORM_VALUE') {
    return [
      action.type,
      action.field,
      action.transform,
      action.search ?? '',
      action.replacement ?? '',
    ].join(':')
  }
  return [
    action.type,
    action.sourceField,
    action.delimiter,
    ...action.targetFields,
  ].join(':')
}

function traceFor(contender: ActionContender): ImporterV2RuleApplicationTrace {
  return {
    ruleId: contender.match.rule.id,
    ruleVersion: contender.match.rule.version,
    ruleName: contender.match.rule.name,
    priority: contender.match.rule.priority,
    actionIndex: contender.actionIndex,
    action: contender.action,
    conditions: contender.match.conditions,
  }
}

function contenderOrder(left: ActionContender, right: ActionContender) {
  return (
    right.match.rule.priority - left.match.rule.priority ||
    right.match.specificity - left.match.specificity ||
    left.match.rule.id.localeCompare(right.match.rule.id) ||
    right.match.rule.version - left.match.rule.version ||
    left.actionIndex - right.actionIndex
  )
}

function chooseSlotWinners(contenders: readonly ActionContender[]) {
  const bySlot = new Map<string, ActionContender[]>()
  for (const contender of contenders) {
    for (const slot of contender.slots) {
      const existing = bySlot.get(slot)
      if (existing) existing.push(contender)
      else bySlot.set(slot, [contender])
    }
  }

  const winningKeysBySlot = new Map<string, Set<string>>()
  const conflicts: ImporterV2RuleConflict[] = []

  for (const [slot, values] of bySlot) {
    const ordered = [...values].sort(contenderOrder)
    const first = ordered[0]
    const tier = ordered.filter(
      (candidate) =>
        candidate.match.rule.priority === first.match.rule.priority &&
        candidate.match.specificity === first.match.specificity,
    )
    const signatures = new Set(tier.map((candidate) => actionSignature(candidate.action)))
    if (signatures.size > 1) {
      conflicts.push({
        slot,
        priority: first.match.rule.priority,
        specificity: first.match.specificity,
        ruleIds: [...new Set(tier.map((candidate) => candidate.match.rule.id))],
        actionIndexes: tier.map((candidate) => candidate.actionIndex),
        explanation:
          `Equal-priority importer rules propose incompatible actions for ${slot}; ` +
          'no action is applied for this slot.',
      })
      continue
    }

    // Equivalent same-tier actions are all traced. Lower tiers cannot override.
    winningKeysBySlot.set(
      slot,
      new Set(
        tier.map(
          (candidate) => `${candidate.match.rule.id}:${candidate.actionIndex}`,
        ),
      ),
    )
  }

  // Multi-slot actions (SPLIT_HIERARCHY) are atomic: they win only if they are
  // the selected winner in every slot they occupy.
  const winners = contenders.filter((candidate) => {
    const key = `${candidate.match.rule.id}:${candidate.actionIndex}`
    return candidate.slots.every((slot) => winningKeysBySlot.get(slot)?.has(key))
  })

  return { winners: winners.sort(contenderOrder), conflicts }
}

function transformValue(value: string | null, action: Extract<ImporterV2RuleAction, { type: 'TRANSFORM_VALUE' }>) {
  if (value === null) return null
  if (action.transform === 'TRIM') return value.trim()
  if (action.transform === 'LOWERCASE') return value.toLocaleLowerCase('en-US')
  if (action.transform === 'UPPERCASE') return value.toLocaleUpperCase('en-US')
  if (action.transform === 'NORMALIZE_WHITESPACE') {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  }
  return value.split(action.search ?? '').join(action.replacement ?? '')
}

function fieldOutcome(
  field: ImporterV2Field,
  original: string | null,
  effective: string | null,
  mappedTarget: ImporterV2ProposedValue | null,
  ignored: boolean,
  applied: readonly ImporterV2RuleApplicationTrace[],
): ImporterV2RuleFieldOutcome {
  return { field, originalValue: original, effectiveValue: effective, mappedTarget, ignored, applied }
}

export function evaluateImporterV2RuleRow(
  compiled: ImporterV2CompiledRuleSet,
  row: ImporterV2StagedRow,
  context: ImporterV2RuleContext,
): ImporterV2RuleRowEvaluation {
  const { matches, candidateRuleCount } = matchRules(compiled, row, context)
  const contenders: ActionContender[] = matches.flatMap((match) =>
    match.rule.actions.map((action, actionIndex) => ({
      match,
      action,
      actionIndex,
      slots: importerV2RuleActionSlots(action),
    })),
  )
  const { winners, conflicts } = chooseSlotWinners(contenders)

  const originalValues = completeValues(row)
  const effectiveValues = { ...originalValues }
  const mappedTargets = new Map<ImporterV2Field, ImporterV2ProposedValue>()
  const ignoredFields = new Set<ImporterV2Field>()
  const appliedByField = new Map<ImporterV2Field, ImporterV2RuleApplicationTrace[]>()
  const applied: ImporterV2RuleApplicationTrace[] = []
  let excluded = false
  let exclusionDecision: ImporterV2RuleRowEvaluation['exclusionDecision'] = null
  let deviceMatch: ImporterV2RuleRowEvaluation['deviceMatch'] = null

  const addFieldTrace = (field: ImporterV2Field, trace: ImporterV2RuleApplicationTrace) => {
    const existing = appliedByField.get(field)
    if (existing) existing.push(trace)
    else appliedByField.set(field, [trace])
  }

  const winnerGroups = new Map<string, ActionContender[]>()
  for (const winner of winners) {
    const key = `${winner.slots.join(',')}|${actionSignature(winner.action)}`
    const existing = winnerGroups.get(key)
    if (existing) existing.push(winner)
    else winnerGroups.set(key, [winner])
  }

  for (const group of winnerGroups.values()) {
    const winner = group[0]
    const traces = group.map(traceFor)
    applied.push(...traces)
    const action = winner.action
    if (action.type === 'MAP_VALUE') {
      effectiveValues[action.field] = action.target.label
      mappedTargets.set(action.field, action.target)
      ignoredFields.delete(action.field)
      traces.forEach((trace) => addFieldTrace(action.field, trace))
    } else if (action.type === 'SET_FIELD') {
      effectiveValues[action.field] = action.value
      mappedTargets.delete(action.field)
      ignoredFields.delete(action.field)
      traces.forEach((trace) => addFieldTrace(action.field, trace))
    } else if (action.type === 'CLEAR_FIELD') {
      effectiveValues[action.field] = null
      mappedTargets.delete(action.field)
      ignoredFields.delete(action.field)
      traces.forEach((trace) => addFieldTrace(action.field, trace))
    } else if (action.type === 'IGNORE_FIELD') {
      effectiveValues[action.field] = null
      mappedTargets.delete(action.field)
      ignoredFields.add(action.field)
      traces.forEach((trace) => addFieldTrace(action.field, trace))
    } else if (action.type === 'TRANSFORM_VALUE') {
      effectiveValues[action.field] = transformValue(
        effectiveValues[action.field] ?? null,
        action,
      )
      mappedTargets.delete(action.field)
      ignoredFields.delete(action.field)
      traces.forEach((trace) => addFieldTrace(action.field, trace))
    } else if (action.type === 'SPLIT_HIERARCHY') {
      const source = effectiveValues[action.sourceField] ?? null
      const parts = source === null
        ? []
        : source.split(action.delimiter).map((part) => part.trim())
      action.targetFields.forEach((field, index) => {
        effectiveValues[field] = parts[index] || null
        mappedTargets.delete(field)
        ignoredFields.delete(field)
        traces.forEach((trace) => addFieldTrace(field, trace))
      })
    } else if (action.type === 'EXCLUDE_ROW') {
      excluded = true
      exclusionDecision = {
        ruleId: winner.match.rule.id,
        ruleVersion: winner.match.rule.version,
        explanation: action.reason,
      }
    } else {
      deviceMatch = {
        deviceId: action.deviceId,
        explanation: action.explanation,
        ruleId: winner.match.rule.id,
        ruleVersion: winner.match.rule.version,
        requiresConfirmation: true,
      }
    }
  }

  const fields: Partial<Record<ImporterV2Field, ImporterV2RuleFieldOutcome>> = {}
  const touchedFields = new Set<ImporterV2Field>([
    ...appliedByField.keys(),
    ...ignoredFields,
    ...mappedTargets.keys(),
  ])
  for (const field of touchedFields) {
    fields[field] = fieldOutcome(
      field,
      originalValues[field] ?? null,
      effectiveValues[field] ?? null,
      mappedTargets.get(field) ?? null,
      ignoredFields.has(field),
      appliedByField.get(field) ?? [],
    )
  }

  const effectiveRow: ImporterV2StagedRow = {
    ...row,
    rawValues: effectiveValues,
    inclusionDecision: excluded && exclusionDecision
      ? {
          status: 'EXCLUDED',
          source: 'PROFILE_RULE',
          decisionId: `${exclusionDecision.ruleId}@${exclusionDecision.ruleVersion}`,
          explanation: exclusionDecision.explanation,
        }
      : row.inclusionDecision ?? null,
  }

  return {
    rowNumber: row.rowNumber,
    originalRow: row,
    effectiveRow,
    fields,
    excluded,
    exclusionDecision,
    deviceMatch,
    applied,
    conflicts,
    candidateRuleCount,
  }
}

export function evaluateImporterV2RuleRows(
  compiled: ImporterV2CompiledRuleSet,
  rows: readonly ImporterV2StagedRow[],
  context: ImporterV2RuleContext,
) {
  return rows.map((row) => evaluateImporterV2RuleRow(compiled, row, context))
}
