import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import type {
  ImporterV2RuleCondition,
  ImporterV2RuleContext,
  ImporterV2RuleDefinition,
  ImporterV2RuleExpression,
  ImporterV2RuleMatchedCondition,
  ImporterV2RuleScope,
} from '@/lib/importer-v2-rule-types'

export function normalizeImporterV2RuleText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

export function importerV2RuleKey(value: string | null | undefined) {
  return normalizeImporterV2RuleText(value)?.toLocaleLowerCase('en-US') ?? null
}

function comparable(
  value: string | null,
  caseSensitive: boolean | undefined,
): string | null {
  if (!value) return null
  return caseSensitive ? value : value.toLocaleLowerCase('en-US')
}

function wildcardMatch(value: string, pattern: string) {
  // Safe glob matcher: '*' matches zero or more characters, '?' one character.
  // No regular-expression execution is involved, so arbitrary backtracking and
  // regex features cannot be injected by a user-authored rule.
  let valueIndex = 0
  let patternIndex = 0
  let starIndex = -1
  let starValueIndex = -1

  while (valueIndex < value.length) {
    if (
      patternIndex < pattern.length &&
      (pattern[patternIndex] === '?' || pattern[patternIndex] === value[valueIndex])
    ) {
      valueIndex += 1
      patternIndex += 1
      continue
    }
    if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
      starIndex = patternIndex
      starValueIndex = valueIndex
      patternIndex += 1
      continue
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1
      starValueIndex += 1
      valueIndex = starValueIndex
      continue
    }
    return false
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
    patternIndex += 1
  }
  return patternIndex === pattern.length
}

function versionPatternValue(value: string) {
  return value.trim().replace(/^v(?=\d)/i, '').replace(/[_-]+/g, '.')
}

export function importerV2RuleConditionMatches(
  condition: ImporterV2RuleCondition,
  values: Readonly<Partial<Record<ImporterV2Field, string | null>>>,
): { matched: boolean; trace: ImporterV2RuleMatchedCondition } {
  const rawActual = values[condition.field] ?? null
  const normalizedActual = normalizeImporterV2RuleText(rawActual)
  const normalizedExpected = normalizeImporterV2RuleText(condition.value)

  let matched = false
  if (condition.operator === 'EXACT') {
    const actual = comparable(rawActual, condition.caseSensitive)
    const expected = comparable(condition.value, condition.caseSensitive)
    matched = actual !== null && expected !== null && actual === expected
  } else if (condition.operator === 'NORMALIZED_EXACT') {
    const actual = comparable(normalizedActual, condition.caseSensitive)
    const expected = comparable(normalizedExpected, condition.caseSensitive)
    matched = actual !== null && expected !== null && actual === expected
  } else if (condition.operator === 'CONTAINS') {
    const actual = comparable(normalizedActual, condition.caseSensitive)
    const expected = comparable(normalizedExpected, condition.caseSensitive)
    matched = actual !== null && expected !== null && actual.includes(expected)
  } else if (condition.operator === 'PREFIX') {
    const actual = comparable(normalizedActual, condition.caseSensitive)
    const expected = comparable(normalizedExpected, condition.caseSensitive)
    matched = actual !== null && expected !== null && actual.startsWith(expected)
  } else if (condition.operator === 'PATTERN') {
    const actual = comparable(normalizedActual, condition.caseSensitive)
    const expected = comparable(normalizedExpected, condition.caseSensitive)
    matched = actual !== null && expected !== null && wildcardMatch(actual, expected)
  } else {
    const actual = comparable(
      normalizedActual ? versionPatternValue(normalizedActual) : null,
      condition.caseSensitive,
    )
    const expected = comparable(
      normalizedExpected ? versionPatternValue(normalizedExpected) : null,
      condition.caseSensitive,
    )
    matched = actual !== null && expected !== null && wildcardMatch(actual, expected)
  }

  return {
    matched,
    trace: {
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual: rawActual,
      matched,
    },
  }
}

export function importerV2RuleExpressionMatches(
  expression: ImporterV2RuleExpression,
  values: Readonly<Partial<Record<ImporterV2Field, string | null>>>,
): { matched: boolean; conditions: readonly ImporterV2RuleMatchedCondition[] } {
  if (expression.kind === 'CONDITION') {
    const result = importerV2RuleConditionMatches(expression, values)
    return { matched: result.matched, conditions: [result.trace] }
  }

  const children = expression.items.map((item) =>
    importerV2RuleExpressionMatches(item, values),
  )
  const matched =
    expression.operator === 'AND'
      ? children.every((child) => child.matched)
      : children.some((child) => child.matched)
  return {
    matched,
    conditions: children.flatMap((child) => child.conditions),
  }
}

function matchesScopedValue(
  allowed: readonly string[] | undefined,
  actual: string | null | undefined,
) {
  if (!allowed || allowed.length === 0) return true
  const actualKey = importerV2RuleKey(actual)
  return Boolean(
    actualKey && allowed.some((value) => importerV2RuleKey(value) === actualKey),
  )
}

export function importerV2RuleScopeMatches(
  scope: ImporterV2RuleScope,
  context: ImporterV2RuleContext,
  values: Readonly<Partial<Record<ImporterV2Field, string | null>>>,
  actionFields: readonly ImporterV2Field[],
) {
  if (!matchesScopedValue(scope.profileIds, context.profileId)) return false
  if (!matchesScopedValue(scope.providers, context.provider)) return false
  if (!matchesScopedValue(scope.sourceAdapterIds, context.sourceAdapterId)) return false
  if (!matchesScopedValue(scope.customers, values.customer)) return false
  if (!matchesScopedValue(scope.businessUnits, values.businessUnit)) return false
  if (!matchesScopedValue(scope.sites, values.site)) return false
  if (!matchesScopedValue(scope.vendors, values.vendor)) return false
  if (!matchesScopedValue(scope.models, values.model)) return false
  if (!matchesScopedValue(scope.productFamilies, values.productFamily)) return false
  if (!matchesScopedValue(scope.deviceTypes, values.deviceType)) return false
  if (
    scope.sourceFields &&
    scope.sourceFields.length > 0 &&
    !actionFields.some((field) => scope.sourceFields?.includes(field))
  ) {
    return false
  }
  return true
}

function countExpressionNodes(expression: ImporterV2RuleExpression): number {
  if (expression.kind === 'CONDITION') return 1
  return 1 + expression.items.reduce((sum, item) => sum + countExpressionNodes(item), 0)
}

function scopeWeight(scope: ImporterV2RuleScope) {
  return Object.values(scope).reduce((sum, values) => {
    if (!Array.isArray(values) || values.length === 0) return sum
    return sum + 100 + Math.max(0, 20 - values.length)
  }, 0)
}

export function importerV2RuleSpecificity(rule: ImporterV2RuleDefinition) {
  return scopeWeight(rule.scope) + countExpressionNodes(rule.when)
}

export function importerV2RuleConditionCount(expression: ImporterV2RuleExpression): number {
  if (expression.kind === 'CONDITION') return 1
  return expression.items.reduce(
    (sum, item) => sum + importerV2RuleConditionCount(item),
    0,
  )
}

export function validateImporterV2RuleExpression(
  expression: ImporterV2RuleExpression,
  depth = 0,
): readonly string[] {
  const errors: string[] = []
  if (depth > 6) errors.push('Condition groups may be nested at most 6 levels.')
  if (expression.kind === 'CONDITION') {
    if (!normalizeImporterV2RuleText(expression.value)) {
      errors.push(`Condition on ${expression.field} requires a value.`)
    }
    if (
      (expression.operator === 'PATTERN' ||
        expression.operator === 'VERSION_MATCH') &&
      expression.value.length > 160
    ) {
      errors.push(`${expression.operator} patterns may be at most 160 characters.`)
    }
    return errors
  }
  if (expression.items.length === 0) {
    errors.push(`${expression.operator} condition group must contain at least one item.`)
  }
  for (const item of expression.items) {
    errors.push(...validateImporterV2RuleExpression(item, depth + 1))
  }
  return errors
}
