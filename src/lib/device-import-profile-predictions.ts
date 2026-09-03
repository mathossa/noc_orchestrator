import { normalizeImportText } from '@/lib/device-import'

export const IMPORT_PREDICTION_FIELDS = [
  'vendor',
  'model',
  'deviceType',
  'platform',
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
  origin?: 'MANUAL' | 'LEARNED'
}

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

function result(value: unknown): DeviceImportPredictionResult {
  return typeof value === 'object' && value !== null
    ? (value as DeviceImportPredictionResult)
    : {}
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

export function applyDeviceImportPredictionRules(
  values: Partial<Record<ImportPredictionField, string | null>>,
  rules: DeviceImportPredictionRule[],
) {
  const prediction: DeviceImportPredictionResult = {}
  const matchedRuleIds: string[] = []
  const ordered = [...rules].sort(
    (left, right) => (right.priority ?? 100) - (left.priority ?? 100),
  )
  for (const rule of ordered) {
    if (!importPredictionRuleMatches(rule, values)) continue
    const next = result(rule.result)
    if (rule.id) matchedRuleIds.push(rule.id)
    if (!prediction.vendorTargetId && next.vendorTargetId)
      prediction.vendorTargetId = next.vendorTargetId
    if (!prediction.deviceTypeTargetId && next.deviceTypeTargetId)
      prediction.deviceTypeTargetId = next.deviceTypeTargetId
    if (!prediction.productFamilyId && next.productFamilyId)
      prediction.productFamilyId = next.productFamilyId
    if (!prediction.softwarePlatforms?.length && next.softwarePlatforms?.length)
      prediction.softwarePlatforms = next.softwarePlatforms
    if (!prediction.preferredSoftwarePlatform && next.preferredSoftwarePlatform)
      prediction.preferredSoftwarePlatform = next.preferredSoftwarePlatform
  }
  return { prediction, matchedRuleIds }
}
