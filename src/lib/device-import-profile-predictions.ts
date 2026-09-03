import {
  extractFirmwareVersion,
  normalizeImportText,
} from '@/lib/device-import'

export const IMPORT_PREDICTION_FIELDS = [
  'vendor',
  'model',
  'deviceType',
  'platform',
  'firmware',
  'firmwareVersion',
  'softwareVersion',
] as const
export type ImportPredictionField = (typeof IMPORT_PREDICTION_FIELDS)[number]

export const IMPORT_PREDICTION_OPERATORS = [
  'EQUALS',
  'PREFIX',
  'CONTAINS',
] as const
export type ImportPredictionOperator =
  (typeof IMPORT_PREDICTION_OPERATORS)[number]

export type DeviceImportPredictionResult = {
  vendorTargetId?: string | null
  deviceTypeTargetId?: string | null
  productFamilyId?: string | null
  softwarePlatforms?: string[]
  preferredSoftwarePlatform?: string | null
  modelTransforms?: DeviceImportModelTransform[]
  firmwareTransforms?: DeviceImportFirmwareTransform[]
  firmwareSource?: DeviceImportFirmwareSource | null
  origin?: 'MANUAL' | 'LEARNED'
}

export type DeviceImportModelTransform = {
  operation: 'REMOVE_PREFIX' | 'REPLACE'
  value: string
  replacement?: string
}

export type DeviceImportFirmwareTransform = {
  operation: 'EXTRACT_VERSION' | 'REMOVE_PREFIX' | 'REPLACE'
  value?: string
  replacement?: string
}

export type DeviceImportFirmwareSource =
  'EFFECTIVE' | 'FIRMWARE_VERSION' | 'SOFTWARE_VERSION'

export type DeviceImportPredictionRule = {
  id?: string
  action: string
  field: string
  operator: string
  value: string
  normalizedValue: string
  result: unknown
  priority?: number
  isActive?: boolean
}

export type DeviceImportPredictionConflict = {
  field:
    | 'vendorTargetId'
    | 'deviceTypeTargetId'
    | 'productFamilyId'
    | 'preferredSoftwarePlatform'
    | 'firmwareSource'
  priority: number
  ruleIds: string[]
  values: string[]
}

type MatchedPredictionRule = {
  rule: DeviceImportPredictionRule
  output: DeviceImportPredictionResult
  priority: number
}

function result(value: unknown): DeviceImportPredictionResult {
  return typeof value === 'object' && value !== null
    ? (value as DeviceImportPredictionResult)
    : {}
}

function stableRuleKey(rule: DeviceImportPredictionRule) {
  return [
    rule.id ?? '',
    rule.field,
    rule.operator,
    rule.normalizedValue || normalizeImportText(rule.value),
    normalizeImportText(rule.value),
  ].join('|')
}

function compareStableText(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareRules(
  left: DeviceImportPredictionRule,
  right: DeviceImportPredictionRule,
) {
  const priority = (right.priority ?? 100) - (left.priority ?? 100)
  return priority || compareStableText(stableRuleKey(left), stableRuleKey(right))
}

export function importPredictionRuleMatches(
  rule: DeviceImportPredictionRule,
  values: Partial<Record<ImportPredictionField, string | null>>,
) {
  if (
    rule.action !== 'PREDICT' ||
    rule.isActive === false ||
    !IMPORT_PREDICTION_FIELDS.includes(rule.field as ImportPredictionField)
  )
    return false
  const source = normalizeImportText(
    values[rule.field as ImportPredictionField],
  )
  const match = rule.normalizedValue || normalizeImportText(rule.value)
  if (!source || !match) return false
  if (rule.operator === 'PREFIX') return source.startsWith(match)
  if (rule.operator === 'CONTAINS') return source.includes(match)
  return rule.operator === 'EQUALS' && source === match
}

function scalarDecision(
  matched: MatchedPredictionRule[],
  field: DeviceImportPredictionConflict['field'],
) {
  const candidates = matched.flatMap((entry) => {
    const value = entry.output[field]
    return typeof value === 'string' && value
      ? [{ ...entry, value }]
      : []
  })
  if (!candidates.length)
    return { value: null as string | null, conflict: null as DeviceImportPredictionConflict | null }

  const priority = candidates[0].priority
  const top = candidates.filter((candidate) => candidate.priority === priority)
  const distinct = new Map<string, string>()
  for (const candidate of top) {
    const key = normalizeImportText(candidate.value)
    if (!distinct.has(key)) distinct.set(key, candidate.value)
  }
  if (distinct.size > 1) {
    return {
      value: null,
      conflict: {
        field,
        priority,
        ruleIds: top.map((candidate) => candidate.rule.id).filter((id): id is string => Boolean(id)),
        values: [...distinct.values()],
      },
    }
  }
  return { value: top[0].value, conflict: null }
}

export function applyDeviceImportPredictionRules(
  values: Partial<Record<ImportPredictionField, string | null>>,
  rules: DeviceImportPredictionRule[],
) {
  const prediction: DeviceImportPredictionResult = {}
  const matched = [...rules]
    .sort(compareRules)
    .filter((rule) => importPredictionRuleMatches(rule, values))
    .map((rule) => ({
      rule,
      output: result(rule.result),
      priority: rule.priority ?? 100,
    }))
  const matchedRuleIds = matched
    .map((entry) => entry.rule.id)
    .filter((id): id is string => Boolean(id))
  const conflicts: DeviceImportPredictionConflict[] = []

  for (const field of [
    'vendorTargetId',
    'deviceTypeTargetId',
    'productFamilyId',
    'preferredSoftwarePlatform',
    'firmwareSource',
  ] as const) {
    const decision = scalarDecision(matched, field)
    if (decision.conflict) {
      conflicts.push(decision.conflict)
      continue
    }
    if (!decision.value) continue
    if (field === 'firmwareSource') {
      prediction.firmwareSource = decision.value as DeviceImportFirmwareSource
    } else {
      prediction[field] = decision.value
    }
  }

  const platforms = new Map<string, string>()
  for (const entry of matched) {
    for (const platform of entry.output.softwarePlatforms ?? []) {
      if (typeof platform !== 'string' || !platform.trim()) continue
      const normalized = normalizeImportText(platform)
      if (!platforms.has(normalized)) platforms.set(normalized, platform)
    }
  }
  if (platforms.size) prediction.softwarePlatforms = [...platforms.values()]

  const modelTransforms: DeviceImportModelTransform[] = []
  const modelTransformKeys = new Set<string>()
  for (const entry of matched) {
    for (const transform of entry.output.modelTransforms ?? []) {
      if (
        !transform?.value ||
        !['REMOVE_PREFIX', 'REPLACE'].includes(transform.operation)
      )
        continue
      const key = `${transform.operation}|${normalizeImportText(transform.value)}|${transform.replacement ?? ''}`
      if (modelTransformKeys.has(key)) continue
      modelTransformKeys.add(key)
      modelTransforms.push(transform)
    }
  }
  if (modelTransforms.length) prediction.modelTransforms = modelTransforms

  const firmwareTransforms: DeviceImportFirmwareTransform[] = []
  const firmwareTransformKeys = new Set<string>()
  for (const entry of matched) {
    for (const transform of entry.output.firmwareTransforms ?? []) {
      if (
        !transform ||
        !['EXTRACT_VERSION', 'REMOVE_PREFIX', 'REPLACE'].includes(
          transform.operation,
        )
      )
        continue
      if (transform.operation !== 'EXTRACT_VERSION' && !transform.value) continue
      const key = `${transform.operation}|${normalizeImportText(transform.value)}|${transform.replacement ?? ''}`
      if (firmwareTransformKeys.has(key)) continue
      firmwareTransformKeys.add(key)
      firmwareTransforms.push(transform)
    }
  }
  if (firmwareTransforms.length) prediction.firmwareTransforms = firmwareTransforms

  return conflicts.length
    ? { prediction, matchedRuleIds, conflicts }
    : { prediction, matchedRuleIds }
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyDeviceImportModelTransforms(
  model: string,
  transforms: DeviceImportModelTransform[] = [],
) {
  const original = model.normalize('NFKC').trim().replace(/\s+/g, ' ')
  let transformed = original
  for (const transform of transforms) {
    const value = transform.value.normalize('NFKC').trim()
    if (!value) continue
    if (transform.operation === 'REMOVE_PREFIX') {
      transformed = transformed.replace(
        new RegExp(`^${escaped(value)}(?=$|[\\s._/-])(?:[\\s._/-]+)?`, 'i'),
        '',
      )
    } else if (transform.operation === 'REPLACE') {
      transformed = transformed.replace(
        new RegExp(escaped(value), 'gi'),
        transform.replacement ?? '',
      )
    }
    transformed = transformed.trim().replace(/\s+/g, ' ')
  }
  return transformed || original
}

export function applyDeviceImportFirmwareTransforms(
  firmware: string,
  transforms: DeviceImportFirmwareTransform[] = [],
) {
  const original = firmware.normalize('NFKC').trim().replace(/\s+/g, ' ')
  let transformed = original
  for (const transform of transforms) {
    if (transform.operation === 'EXTRACT_VERSION') {
      const explicitV = transformed.match(/(?:^|[\s_-])v(\d+(?:\.\d+){1,5})\b/i)
      const dotted = transformed.match(/\b(\d+(?:\.\d+){1,5})\b/)
      transformed = explicitV?.[1] ?? dotted?.[1] ?? transformed
      continue
    }
    const value = transform.value?.normalize('NFKC').trim() ?? ''
    if (!value) continue
    if (transform.operation === 'REMOVE_PREFIX') {
      transformed = transformed.replace(
        new RegExp(`^${escaped(value)}(?=$|[\\s._/-])(?:[\\s._/-]+)?`, 'i'),
        '',
      )
    } else {
      transformed = transformed.replace(
        new RegExp(escaped(value), 'gi'),
        transform.replacement ?? '',
      )
    }
    transformed = transformed.trim().replace(/\s+/g, ' ')
  }
  return transformed || original
}

export function selectDeviceImportFirmwareSource(
  values: {
    effective: string
    firmwareVersion?: string | null
    softwareVersion?: string | null
  },
  source: DeviceImportFirmwareSource | null | undefined,
) {
  const selected =
    source === 'FIRMWARE_VERSION'
      ? values.firmwareVersion || values.effective
      : source === 'SOFTWARE_VERSION'
        ? values.softwareVersion || values.effective
        : values.effective
  return extractFirmwareVersion(selected) ?? selected
}
