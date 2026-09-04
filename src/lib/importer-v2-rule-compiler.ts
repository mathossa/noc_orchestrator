import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import {
  importerV2RuleConditionCount,
  importerV2RuleKey,
  normalizeImporterV2RuleText,
  validateImporterV2RuleExpression,
} from '@/lib/importer-v2-rule-matcher'
import type {
  ImporterV2CompiledRuleSet,
  ImporterV2RuleAction,
  ImporterV2RuleDefinition,
  ImporterV2RuleExpression,
  ImporterV2RuleSetSnapshot,
} from '@/lib/importer-v2-rule-types'

function actionFields(action: ImporterV2RuleAction): readonly ImporterV2Field[] {
  if (action.type === 'EXCLUDE_ROW' || action.type === 'MATCH_DEVICE') return []
  if (action.type === 'SPLIT_HIERARCHY') {
    return [action.sourceField, ...action.targetFields]
  }
  return [action.field]
}

export function importerV2RuleActionFields(
  actions: readonly ImporterV2RuleAction[],
): readonly ImporterV2Field[] {
  return [...new Set(actions.flatMap(actionFields))]
}

function actionSlots(action: ImporterV2RuleAction): readonly string[] {
  if (action.type === 'EXCLUDE_ROW') return ['row:inclusion']
  if (action.type === 'MATCH_DEVICE') return ['row:device-match']
  if (action.type === 'SPLIT_HIERARCHY') {
    return action.targetFields.map((field) => `field:${field}`)
  }
  return [`field:${action.field}`]
}

export function importerV2RuleActionSlots(
  action: ImporterV2RuleAction,
): readonly string[] {
  return actionSlots(action)
}

function conditionAnchors(
  expression: ImporterV2RuleExpression,
): readonly { field: ImporterV2Field; value: string }[] {
  if (expression.kind === 'CONDITION') {
    if (
      expression.operator !== 'EXACT' &&
      expression.operator !== 'NORMALIZED_EXACT'
    ) {
      return []
    }
    const key = importerV2RuleKey(expression.value)
    return key ? [{ field: expression.field, value: key }] : []
  }

  // A condition from an AND group is a safe anchor because every matching row
  // must satisfy it. OR groups cannot supply one mandatory branch.
  if (expression.operator === 'OR') return []
  return expression.items.flatMap(conditionAnchors)
}

function scopeAnchor(
  rule: ImporterV2RuleDefinition,
): { kind: string; value: string } | null {
  const scopeOrder: readonly [string, readonly string[] | undefined][] = [
    ['profile', rule.scope.profileIds],
    ['provider', rule.scope.providers],
    ['adapter', rule.scope.sourceAdapterIds],
    ['customer', rule.scope.customers],
    ['businessUnit', rule.scope.businessUnits],
    ['site', rule.scope.sites],
    ['vendor', rule.scope.vendors],
    ['model', rule.scope.models],
    ['productFamily', rule.scope.productFamilies],
    ['deviceType', rule.scope.deviceTypes],
  ]

  for (const [kind, values] of scopeOrder) {
    if (!values || values.length !== 1) continue
    const value = importerV2RuleKey(values[0])
    if (value) return { kind, value }
  }
  return null
}

function ruleAnchor(rule: ImporterV2RuleDefinition): string | null {
  const scoped = scopeAnchor(rule)
  if (scoped) return `scope:${scoped.kind}:${scoped.value}`

  const condition = conditionAnchors(rule.when)[0]
  return condition ? `field:${condition.field}:${condition.value}` : null
}

function pushIndex(index: Map<string, number[]>, key: string, ruleIndex: number) {
  const existing = index.get(key)
  if (existing) existing.push(ruleIndex)
  else index.set(key, [ruleIndex])
}

export function validateImporterV2RuleDefinition(
  rule: ImporterV2RuleDefinition,
): readonly string[] {
  const errors: string[] = []
  if (!normalizeImporterV2RuleText(rule.id)) errors.push('Rule id is required.')
  if (!normalizeImporterV2RuleText(rule.name)) errors.push('Rule name is required.')
  if (!Number.isInteger(rule.version) || rule.version < 1) {
    errors.push(`Rule ${rule.id} version must be a positive integer.`)
  }
  if (!Number.isInteger(rule.priority)) {
    errors.push(`Rule ${rule.id} priority must be an integer.`)
  }
  if (rule.actions.length === 0) {
    errors.push(`Rule ${rule.id} must contain at least one action.`)
  }
  errors.push(...validateImporterV2RuleExpression(rule.when))

  const occupied = new Set<string>()
  for (const action of rule.actions) {
    if (
      action.type !== 'EXCLUDE_ROW' &&
      action.type !== 'MATCH_DEVICE' &&
      action.type !== 'SPLIT_HIERARCHY' &&
      action.field === 'currentFirmware'
    ) {
      errors.push(
        `Rule ${rule.id} cannot write derived currentFirmware; act on firmwareVersion/softwareVersion and let the Issue #48 interpreter derive running firmware.`,
      )
    }
    for (const slot of actionSlots(action)) {
      if (occupied.has(slot)) {
        errors.push(`Rule ${rule.id} contains more than one action for ${slot}.`)
      }
      occupied.add(slot)
    }
    if (action.type === 'SPLIT_HIERARCHY') {
      if (!action.delimiter) {
        errors.push(`Rule ${rule.id} SPLIT_HIERARCHY requires a delimiter.`)
      }
      if (action.targetFields.length < 2) {
        errors.push(
          `Rule ${rule.id} SPLIT_HIERARCHY requires at least two target fields.`,
        )
      }
      if (new Set(action.targetFields).size !== action.targetFields.length) {
        errors.push(
          `Rule ${rule.id} SPLIT_HIERARCHY target fields must be unique.`,
        )
      }
    }
    if (action.type === 'TRANSFORM_VALUE' && action.transform === 'REPLACE_LITERAL') {
      if (!action.search) {
        errors.push(
          `Rule ${rule.id} REPLACE_LITERAL transform requires a non-empty search value.`,
        )
      }
    }
    if (action.type === 'MAP_VALUE' && !normalizeImporterV2RuleText(action.target.label)) {
      errors.push(`Rule ${rule.id} MAP_VALUE requires a target label.`)
    }
  }
  return errors
}

export function compileImporterV2RuleSet(
  snapshot: ImporterV2RuleSetSnapshot,
): ImporterV2CompiledRuleSet {
  const ids = new Set<string>()
  const activeRules = snapshot.rules.filter((rule) => rule.status === 'ACTIVE')
  for (const rule of snapshot.rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate importer rule id: ${rule.id}`)
    ids.add(rule.id)
    const errors = validateImporterV2RuleDefinition(rule)
    if (errors.length > 0) {
      throw new Error(`Invalid importer rule ${rule.id}: ${errors.join(' ')}`)
    }
  }

  const anchorIndex = new Map<string, number[]>()
  const broadRuleIndexes: number[] = []
  activeRules.forEach((rule, index) => {
    const anchor = ruleAnchor(rule)
    if (anchor) pushIndex(anchorIndex, anchor, index)
    else broadRuleIndexes.push(index)
  })

  return {
    snapshot,
    activeRules,
    broadRuleIndexes,
    anchorIndex,
  }
}

export function importerV2RuleComplexity(rule: ImporterV2RuleDefinition) {
  return {
    conditionCount: importerV2RuleConditionCount(rule.when),
    actionCount: rule.actions.length,
    indexed: Boolean(ruleAnchor(rule)),
  }
}
