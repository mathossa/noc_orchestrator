// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'

export const FIRMWARE_REVIEW_STATES = [
  'DRAFT',
  'READY',
  'SENT',
  'CLOSED',
] as const

export const FIRMWARE_REVIEW_DECISIONS = [
  'PENDING',
  'PARTIAL',
  'ACCEPTED',
  'DECLINED',
] as const

export const FIRMWARE_REVIEW_REPORT_STATES = [
  'DRAFT',
  'FINAL',
  'SENT',
] as const

export type FirmwareReviewState = (typeof FIRMWARE_REVIEW_STATES)[number]
export type FirmwareReviewDecision =
  (typeof FIRMWARE_REVIEW_DECISIONS)[number]
export type FirmwareReviewReportState =
  (typeof FIRMWARE_REVIEW_REPORT_STATES)[number]

export type FirmwareReviewCycleInput = {
  customerId: string
  periodStart: Date
  periodEnd: Date
  nextReviewAt: Date | null
  reviewerName: string | null
}

export type FirmwareReviewSnapshotRow = {
  deviceId: string
  deviceName: string
  siteId: string | null
  siteName: string | null
  compliance: string
  recommendation: string
  exceptionReasonCode: string | null
  planningState: string | null
  attentionClass: 'FIRMWARE' | 'REPLACEMENT_OR_EOL' | 'UNMANAGED'
}

export type FirmwareReviewSummary = {
  totalDevices: number
  preferred: number
  accepted: number
  updateRecommended: number
  updateRequired: number
  platformMigration: number
  reviewRequired: number
  customerDeclined: number
  replacementOrEol: number
  unmanaged: number
  planned: number
  awaitingCustomer: number
  scheduled: number
}

export class FirmwareReviewValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareReviewValidationError'
  }
}

function normalizedText(value: unknown, max = 500) {
  if (value == null || value === '') return null
  if (typeof value !== 'string')
    throw new FirmwareReviewValidationError('Review text fields must be strings.')
  const normalized = value.normalize('NFKC').trim()
  if (!normalized) return null
  if (normalized.length > max)
    throw new FirmwareReviewValidationError(
      `Review text may not exceed ${max} characters.`,
    )
  return normalized
}

function dateValue(value: unknown, field: string) {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return new Date(value)
  if (typeof value !== 'string' || !value.trim())
    throw new FirmwareReviewValidationError(`${field} is required.`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw new FirmwareReviewValidationError(`${field} must be a valid date.`)
  return parsed
}

export function shiftUtcMonths(value: Date, months: number) {
  const result = new Date(value)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

export function defaultFirmwareReviewWindow(at: Date = new Date()) {
  return {
    periodStart: shiftUtcMonths(at, -3),
    periodEnd: new Date(at),
    nextReviewAt: shiftUtcMonths(at, 3),
  }
}

export function parseFirmwareReviewCycleInput(
  raw: unknown,
  at: Date = new Date(),
): FirmwareReviewCycleInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new FirmwareReviewValidationError('Enter review cycle details.')

  const body = raw as Record<string, unknown>
  const customerId = normalizedText(body.customerId)
  if (!customerId)
    throw new FirmwareReviewValidationError('Choose a customer.')

  const defaults = defaultFirmwareReviewWindow(at)
  const periodStart =
    body.periodStart == null || body.periodStart === ''
      ? defaults.periodStart
      : dateValue(body.periodStart, 'periodStart')
  const periodEnd =
    body.periodEnd == null || body.periodEnd === ''
      ? defaults.periodEnd
      : dateValue(body.periodEnd, 'periodEnd')

  if (periodStart > periodEnd)
    throw new FirmwareReviewValidationError(
      'Review period start must not be after its end.',
    )

  const nextReviewAt =
    body.nextReviewAt === null
      ? null
      : body.nextReviewAt == null || body.nextReviewAt === ''
        ? defaults.nextReviewAt
        : dateValue(body.nextReviewAt, 'nextReviewAt')

  if (nextReviewAt && nextReviewAt <= periodEnd)
    throw new FirmwareReviewValidationError(
      'Next review must be after the current review period.',
    )

  return {
    customerId,
    periodStart,
    periodEnd,
    nextReviewAt,
    reviewerName: normalizedText(body.reviewerName, 200),
  }
}

export function summarizeFirmwareReviewRows(
  rows: readonly FirmwareReviewSnapshotRow[],
): FirmwareReviewSummary {
  const count = (predicate: (row: FirmwareReviewSnapshotRow) => boolean) =>
    rows.filter(predicate).length

  return {
    totalDevices: rows.length,
    preferred: count((row) => row.compliance === 'PREFERRED'),
    accepted: count((row) => row.compliance === 'ACCEPTED'),
    updateRecommended: count(
      (row) => row.recommendation === 'UPDATE_RECOMMENDED',
    ),
    updateRequired: count((row) => row.recommendation === 'UPDATE_REQUIRED'),
    platformMigration: count(
      (row) => row.recommendation === 'PLATFORM_MIGRATION',
    ),
    reviewRequired: count((row) => row.recommendation === 'REVIEW_REQUIRED'),
    customerDeclined: count(
      (row) => row.exceptionReasonCode === 'CUSTOMER_DECLINED',
    ),
    replacementOrEol: count(
      (row) => row.attentionClass === 'REPLACEMENT_OR_EOL',
    ),
    unmanaged: count((row) => row.attentionClass === 'UNMANAGED'),
    planned: count((row) =>
      ['PROPOSED', 'APPROVED', 'IN_PROGRESS'].includes(
        row.planningState ?? '',
      ),
    ),
    awaitingCustomer: count(
      (row) => row.planningState === 'AWAITING_CUSTOMER',
    ),
    scheduled: count((row) => row.planningState === 'SCHEDULED'),
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    )
  }
  return value
}

export function firmwareReviewSnapshotHash(snapshot: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(snapshot)))
    .digest('hex')
}
