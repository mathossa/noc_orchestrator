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
    if (!prediction.firmwareSource && next.firmwareSource)
      prediction.firmwareSource = next.firmwareSource
    if (next.modelTransforms?.length) {
      const transforms = prediction.modelTransforms ?? []
      for (const transform of next.modelTransforms) {
        if (
          !transform?.value ||
          !['REMOVE_PREFIX', 'REPLACE'].includes(transform.operation)
        )
          continue
        const key = `${transform.operation}|${normalizeImportText(transform.value)}|${transform.replacement ?? ''}`
        if (
          !transforms.some(
            (candidate) =>
              `${candidate.operation}|${normalizeImportText(candidate.value)}|${candidate.replacement ?? ''}` ===
              key,
          )
        )
          transforms.push(transform)
      }
      prediction.modelTransforms = transforms
    }
    if (next.firmwareTransforms?.length) {
      const transforms = prediction.firmwareTransforms ?? []
      for (const transform of next.firmwareTransforms) {
        if (
          !transform ||
          !['EXTRACT_VERSION', 'REMOVE_PREFIX', 'REPLACE'].includes(
            transform.operation,
          )
        )
          continue
        if (transform.operation !== 'EXTRACT_VERSION' && !transform.value)
          continue
        const key = `${transform.operation}|${normalizeImportText(transform.value)}|${transform.replacement ?? ''}`
        if (
          !transforms.some(
            (candidate) =>
              `${candidate.operation}|${normalizeImportText(candidate.value)}|${candidate.replacement ?? ''}` ===
              key,
          )
        )
          transforms.push(transform)
      }
      prediction.firmwareTransforms = transforms
    }
  }
  return { prediction, matchedRuleIds }
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
