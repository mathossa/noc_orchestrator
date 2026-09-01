import {
  normalizeImportText,
  type DeviceImportField,
  type DeviceImportOptions,
  type DeviceImportReferenceKind,
} from '@/lib/device-import'

export const DEVICE_IMPORT_BATCH_STATUSES = ['STAGED', 'READY', 'PUBLISHED', 'PARTIAL'] as const
export const DEVICE_IMPORT_STAGED_REFERENCE_STATUSES = ['UNRESOLVED', 'WAITING', 'LINKED'] as const

export type DeviceImportBatchStatus = (typeof DEVICE_IMPORT_BATCH_STATUSES)[number]
export type DeviceImportStagedReferenceStatus = (typeof DEVICE_IMPORT_STAGED_REFERENCE_STATUSES)[number]
export type DeviceImportMappedValues = Record<DeviceImportField, string | null>

export type DeviceImportStagedReferenceMetadata = {
  rowNumbers?: number[]
  customerSourceValue?: string | null
  customerTargetId?: string | null
  vendorSourceValue?: string | null
  vendorTargetId?: string | null
  deviceTypeSourceValue?: string | null
  deviceTypeTargetId?: string | null
  modelSourceValue?: string | null
  modelTargetId?: string | null
  platform?: string | null
  waitingFor?: DeviceImportReferenceKind[]
}

export type DeviceImportStagedReferenceSeed = {
  kind: DeviceImportReferenceKind
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  occurrenceCount: number
  metadata: DeviceImportStagedReferenceMetadata
}

const ROW_NUMBER_SAMPLE = 20

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

function rawContext(values: DeviceImportMappedValues, kind: DeviceImportReferenceKind, options: DeviceImportOptions) {
  if (kind === 'SITE') {
    if (values.customer) return `customer:${normalizeImportText(values.customer)}`
    if (options.defaults.customerId) return `customer-id:${options.defaults.customerId}`
    return 'customer:'
  }
  if (kind === 'DEVICE_MODEL') {
    return `vendor:${normalizeImportText(values.vendor)}|type:${normalizeImportText(values.deviceType)}`
  }
  if (kind === 'FIRMWARE_RELEASE') {
    return `vendor:${normalizeImportText(values.vendor)}|model:${normalizeImportText(values.model)}`
  }
  return ''
}

function metadataFor(values: DeviceImportMappedValues, kind: DeviceImportReferenceKind, options: DeviceImportOptions) {
  const base: DeviceImportStagedReferenceMetadata = {}
  if (kind === 'SITE') {
    base.customerSourceValue = clean(values.customer)
    base.customerTargetId = values.customer ? null : options.defaults.customerId
  }
  if (kind === 'DEVICE_MODEL') {
    base.vendorSourceValue = clean(values.vendor)
    base.deviceTypeSourceValue = clean(values.deviceType)
  }
  if (kind === 'FIRMWARE_RELEASE') {
    base.vendorSourceValue = clean(values.vendor)
    base.modelSourceValue = clean(values.model)
  }
  return base
}

function addSeed(
  result: Map<string, DeviceImportStagedReferenceSeed>,
  kind: DeviceImportReferenceKind,
  sourceValue: string | null,
  values: DeviceImportMappedValues,
  rowNumber: number,
  options: DeviceImportOptions,
) {
  const cleaned = clean(sourceValue)
  if (!cleaned) return
  const contextKey = rawContext(values, kind, options)
  const normalizedSourceValue = normalizeImportText(cleaned)
  const key = `${kind}|${contextKey}|${normalizedSourceValue}`
  const current = result.get(key)
  if (current) {
    current.occurrenceCount += 1
    const rows = current.metadata.rowNumbers ?? []
    if (rows.length < ROW_NUMBER_SAMPLE && !rows.includes(rowNumber)) rows.push(rowNumber)
    current.metadata.rowNumbers = rows
    return
  }
  result.set(key, {
    kind,
    sourceValue: cleaned,
    normalizedSourceValue,
    contextKey,
    occurrenceCount: 1,
    metadata: { ...metadataFor(values, kind, options), rowNumbers: [rowNumber] },
  })
}

export function buildDeviceImportStagedReferenceSeeds(
  rows: Array<{ rowNumber: number; values: DeviceImportMappedValues }>,
  options: DeviceImportOptions,
) {
  const result = new Map<string, DeviceImportStagedReferenceSeed>()
  for (const row of rows) {
    addSeed(result, 'CUSTOMER', row.values.customer, row.values, row.rowNumber, options)
    addSeed(result, 'SITE', row.values.site, row.values, row.rowNumber, options)
    addSeed(result, 'VENDOR', row.values.vendor, row.values, row.rowNumber, options)
    addSeed(result, 'DEVICE_TYPE', row.values.deviceType, row.values, row.rowNumber, options)
    addSeed(result, 'DEVICE_MODEL', row.values.model, row.values, row.rowNumber, options)
    addSeed(result, 'CONTRACT_TYPE', row.values.contract, row.values, row.rowNumber, options)
    addSeed(result, 'FIRMWARE_RELEASE', row.values.currentFirmware, row.values, row.rowNumber, options)
  }
  return [...result.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.sourceValue.localeCompare(b.sourceValue))
}

function compact(value: string) {
  return normalizeImportText(value).replace(/[^a-z0-9]+/g, '')
}

function tokens(value: string) {
  return new Set(normalizeImportText(value).split(/[^a-z0-9]+/g).filter(Boolean))
}

export function importReferenceSimilarity(source: string, candidate: string) {
  const left = normalizeImportText(source)
  const right = normalizeImportText(candidate)
  if (!left || !right) return 0
  if (left === right) return 1
  const leftCompact = compact(source)
  const rightCompact = compact(candidate)
  if (leftCompact && leftCompact === rightCompact) return 0.98

  const leftTokens = tokens(source)
  const rightTokens = tokens(candidate)
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  const tokenScore = union ? intersection / union : 0

  const contains = leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)
  const sizeRatio = Math.min(leftCompact.length, rightCompact.length) / Math.max(leftCompact.length, rightCompact.length, 1)
  const containsScore = contains ? 0.65 + 0.25 * sizeRatio : 0
  return Math.max(tokenScore, containsScore)
}

export function bestImportReferenceSuggestion<T>(
  sourceValue: string,
  candidates: T[],
  label: (candidate: T) => string,
) {
  const scored = candidates
    .map((candidate) => ({ candidate, score: importReferenceSimilarity(sourceValue, label(candidate)) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (!best || best.score < 0.55) return null
  if (second && best.score - second.score < 0.08 && best.score < 0.9) return null
  return best
}

export function suggestedImportReferenceCode(sourceValue: string) {
  const compacted = sourceValue
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return compacted.slice(0, 40) || 'IMPORT'
}
