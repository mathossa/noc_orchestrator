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

export const FIRMWARE_REVIEW_DUE_STATES = [
  'NO_CYCLE',
  'CURRENT',
  'UPCOMING',
  'DUE',
  'OVERDUE',
] as const

export const FIRMWARE_REVIEW_ACTION_KINDS = [
  'UPDATE_REQUIRED',
  'UPDATE_RECOMMENDED',
  'PLATFORM_MIGRATION',
  'REVIEW_REQUIRED',
  'REPLACEMENT_OR_EOL',
  'UNMANAGED',
  'NO_ACTION',
] as const

export type FirmwareReviewState = (typeof FIRMWARE_REVIEW_STATES)[number]
export type FirmwareReviewDecision =
  (typeof FIRMWARE_REVIEW_DECISIONS)[number]
export type FirmwareReviewReportState =
  (typeof FIRMWARE_REVIEW_REPORT_STATES)[number]
export type FirmwareReviewDueState =
  (typeof FIRMWARE_REVIEW_DUE_STATES)[number]
export type FirmwareReviewActionKind =
  (typeof FIRMWARE_REVIEW_ACTION_KINDS)[number]

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
  acceptedException?: number
  customerDeclined: number
  replacementOrEol: number
  unmanaged: number
  planned: number
  awaitingCustomer: number
  scheduled: number
}

export type FirmwareReviewSnapshotDevice = {
  deviceId: string
  deviceName: string
  hostname: string | null
  siteId: string | null
  siteName: string | null
  organizationUnit?: { id: string; name: string } | null
  vendor: { id: string; code: string; name: string }
  deviceType: { id: string; code: string; name: string }
  model: {
    id: string
    name: string
    familyId: string | null
    familyName: string | null
    platform?: string | null
    preferredPlatform?: string | null
  }
  inventorySource: {
    source: string
    externalProvider: string | null
  }
  currentFirmware: {
    releaseId: string | null
    platform: string | null
    version: string | null
    rawVersion: string | null
    observedAt: string | null
    catalogState?: string | null
    policyEligibility?: string | null
  }
  technical: {
    compliance: string
    relationToPreferred: string
    recommendation: string
    label: string
    explanation: string
    effectiveTrack: unknown
    policy: {
      id: string
      mode: string
      version: number
      trackKey: string
      trackName: string
      trackClass: string
      desiredPlatform: string | null
      minimumFirmwareReleaseId: string | null
      targetFirmwareReleaseId: string | null
      maximumFirmwareReleaseId: string | null
      firmwareTrainId: string | null
    } | null
    policySource: {
      scope: string
      scopeId: string
      subject?: string | null
      subjectId?: string | null
      policyId: string
      trackKey: string
      trackName: string
      trackClass?: string
      policyVersion: number
      effectiveFrom?: string | null
    } | null
    preferredTarget: {
      id: string
      platform: string
      version: string
      logicalVersion: string
      trainId: string | null
      trainName: string | null
    } | null
    resolvedTarget: {
      id: string
      platform: string
      version: string
      logicalVersion: string
      variant: string | null
      imageCode: string | null
    } | null
  }
  exception: {
    id: string
    reasonCode: string
    scope: string
    scopeId: string
    scopeLabel: string
    subject: string
    duration: string
    decidedAt: string
    expiresAt: string | null
    contactReference: string | null
    ticketReference: string | null
    replacementRelated: boolean
  } | null
  planning: {
    id: string
    title?: string | null
    state: string
    proposedFor: string | null
    proposedMaintenanceWindowReference: string | null
    scheduledFor: string | null
    maintenanceWindowReference: string | null
    externalReference: string | null
  } | null
  attentionClass: FirmwareReviewSnapshotRow['attentionClass']
}

export type FirmwareReviewSnapshotSite = {
  siteId: string | null
  siteName: string | null
  organizationUnit?: { id: string; name: string } | null
  summary: FirmwareReviewSummary
  devices: FirmwareReviewSnapshotDevice[]
}

export type FirmwareReviewSnapshot = {
  schemaVersion: number
  reviewCycleId: string
  reportVersion: number
  generatedAt: string
  reviewPeriod: { start: string; end: string }
  customer: { id: string; name: string }
  summary: FirmwareReviewSummary
  sites: FirmwareReviewSnapshotSite[]
}

export type FirmwareReviewPlanningPresentation =
  | { kind: 'SCHEDULED'; occurrence: string | null }
  | { kind: 'PROPOSED'; occurrence: string }
  | { kind: 'UNSCHEDULED'; occurrence: null }

export type FirmwareReviewActionGroup = {
  key: string
  siteId: string | null
  siteName: string | null
  organizationUnit: { id: string; name: string } | null
  actionKind: FirmwareReviewActionKind
  vendorName: string
  deviceTypeId: string
  deviceTypeName: string
  modelId: string
  modelName: string
  deviceCount: number
  deviceIds: string[]
  currentFirmware: Array<{ value: string; count: number }>
  tracks: Array<{ value: string; count: number }>
  preferredTargets: Array<{ value: string; count: number }>
  complianceStates: string[]
  recommendations: string[]
  exceptionReasonCodes: string[]
  planningStates: string[]
  proposedOccurrences: string[]
  scheduledOccurrences: string[]
  planIds: string[]
  exceptionIds: string[]
  policyIds: string[]
  firmwareTrainIds: string[]
  preferredTargetReleaseIds: string[]
}

export type FirmwareReviewWorkspaceMetrics = {
  preferred: number
  accepted: number
  updateRequired: number
  updateRecommended: number
  platformMigration: number
  reviewRequired: number
  blockedReleases: number
  unplannedRecommendations: number
  awaitingCustomerPlans: number
  exceptionsExpiring: number
  replacementOrEol: number
  unmanaged: number
  missingExternalReferences: number
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
      'Review text may not exceed ' + max + ' characters.',
    )
  return normalized
}

function dateValue(value: unknown, field: string) {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return new Date(value)
  if (typeof value !== 'string' || !value.trim())
    throw new FirmwareReviewValidationError(field + ' is required.')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw new FirmwareReviewValidationError(field + ' must be a valid date.')
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
    acceptedException: count((row) => row.exceptionReasonCode !== null),
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

function utcDay(value: Date) {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  )
}

export function firmwareReviewDueState(
  cycle: { nextReviewAt: Date | string | null } | null,
  at: Date = new Date(),
): FirmwareReviewDueState {
  if (!cycle) return 'NO_CYCLE'
  if (!cycle.nextReviewAt) return 'CURRENT'
  const due = new Date(cycle.nextReviewAt)
  if (!Number.isFinite(due.getTime())) return 'CURRENT'
  const today = utcDay(at)
  const dueDay = utcDay(due)
  if (dueDay < today) return 'OVERDUE'
  if (dueDay === today) return 'DUE'
  if (dueDay <= today + 30 * 24 * 60 * 60 * 1000) return 'UPCOMING'
  return 'CURRENT'
}

export function firmwareReviewActionKindForDevice(
  device: Pick<
    FirmwareReviewSnapshotDevice,
    'attentionClass' | 'technical'
  >,
): FirmwareReviewActionKind {
  if (device.attentionClass === 'REPLACEMENT_OR_EOL')
    return 'REPLACEMENT_OR_EOL'
  if (device.attentionClass === 'UNMANAGED') return 'UNMANAGED'
  switch (device.technical.recommendation) {
    case 'UPDATE_REQUIRED':
      return 'UPDATE_REQUIRED'
    case 'UPDATE_RECOMMENDED':
      return 'UPDATE_RECOMMENDED'
    case 'PLATFORM_MIGRATION':
      return 'PLATFORM_MIGRATION'
    case 'REVIEW_REQUIRED':
      return 'REVIEW_REQUIRED'
    case 'NO_ACTION':
      return 'NO_ACTION'
    default:
      return 'REVIEW_REQUIRED'
  }
}

export function firmwareReviewPlanningPresentation(
  planning: FirmwareReviewSnapshotDevice['planning'],
): FirmwareReviewPlanningPresentation {
  if (!planning) return { kind: 'UNSCHEDULED', occurrence: null }
  if (planning.state === 'SCHEDULED')
    return { kind: 'SCHEDULED', occurrence: planning.scheduledFor }
  if (planning.proposedFor)
    return { kind: 'PROPOSED', occurrence: planning.proposedFor }
  return { kind: 'UNSCHEDULED', occurrence: null }
}

function counted(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value))
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value))].sort()
}

const actionOrder: Record<FirmwareReviewActionKind, number> = {
  UPDATE_REQUIRED: 0,
  PLATFORM_MIGRATION: 1,
  UPDATE_RECOMMENDED: 2,
  REVIEW_REQUIRED: 3,
  REPLACEMENT_OR_EOL: 4,
  UNMANAGED: 5,
  NO_ACTION: 6,
}

export function firmwareReviewActionGroups(
  snapshot: FirmwareReviewSnapshot,
): FirmwareReviewActionGroup[] {
  const groups = new Map<string, FirmwareReviewSnapshotDevice[]>()

  for (const site of snapshot.sites) {
    for (const device of site.devices) {
      const actionKind = firmwareReviewActionKindForDevice(device)
      const track =
        device.technical.policy?.trackKey ??
        device.technical.preferredTarget?.trainId ??
        'no-track'
      const target = device.technical.preferredTarget?.id ?? 'no-target'
      const key = [
        device.siteId ?? 'no-site',
        actionKind,
        device.deviceType.id,
        device.model.id,
        track,
        target,
      ].join('|')
      const rows = groups.get(key)
      if (rows) rows.push(device)
      else groups.set(key, [device])
    }
  }

  return [...groups.entries()]
    .map(([key, devices]) => {
      const first = devices[0]
      return {
        key,
        siteId: first.siteId,
        siteName: first.siteName,
        organizationUnit: first.organizationUnit ?? null,
        actionKind: firmwareReviewActionKindForDevice(first),
        vendorName: first.vendor.name,
        deviceTypeId: first.deviceType.id,
        deviceTypeName: first.deviceType.name,
        modelId: first.model.id,
        modelName: first.model.name,
        deviceCount: devices.length,
        deviceIds: devices.map((device) => device.deviceId).sort(),
        currentFirmware: counted(
          devices.map((device) => device.currentFirmware.version),
        ),
        tracks: counted(
          devices.map(
            (device) =>
              device.technical.policy?.trackName ??
              device.technical.preferredTarget?.trainName ??
              'No resolved track',
          ),
        ),
        preferredTargets: counted(
          devices.map((device) => {
            const target = device.technical.preferredTarget
            return target ? target.platform + ' ' + target.version : null
          }),
        ),
        complianceStates: unique(
          devices.map((device) => device.technical.compliance),
        ),
        recommendations: unique(
          devices.map((device) => device.technical.recommendation),
        ),
        exceptionReasonCodes: unique(
          devices.map((device) => device.exception?.reasonCode),
        ),
        planningStates: unique(
          devices.map((device) => device.planning?.state),
        ),
        proposedOccurrences: unique(
          devices.map((device) => device.planning?.proposedFor),
        ),
        scheduledOccurrences: unique(
          devices.map((device) => device.planning?.scheduledFor),
        ),
        planIds: unique(devices.map((device) => device.planning?.id)),
        exceptionIds: unique(devices.map((device) => device.exception?.id)),
        policyIds: unique(
          devices.map((device) => device.technical.policy?.id),
        ),
        firmwareTrainIds: unique(
          devices.map(
            (device) => device.technical.preferredTarget?.trainId,
          ),
        ),
        preferredTargetReleaseIds: unique(
          devices.map(
            (device) => device.technical.preferredTarget?.id,
          ),
        ),
      }
    })
    .sort(
      (left, right) =>
        (left.siteName ?? '').localeCompare(right.siteName ?? '') ||
        actionOrder[left.actionKind] - actionOrder[right.actionKind] ||
        left.modelName.localeCompare(right.modelName),
    )
}

export function firmwareReviewWorkspaceMetrics(
  snapshot: FirmwareReviewSnapshot,
  at: Date = new Date(),
): FirmwareReviewWorkspaceMetrics {
  const devices = snapshot.sites.flatMap((site) => site.devices)
  const actionable = new Set([
    'UPDATE_REQUIRED',
    'UPDATE_RECOMMENDED',
    'PLATFORM_MIGRATION',
    'REVIEW_REQUIRED',
  ])
  const activePlanStates = new Set([
    'PROPOSED',
    'AWAITING_CUSTOMER',
    'APPROVED',
    'SCHEDULED',
    'IN_PROGRESS',
  ])
  const expiryHorizon = at.getTime() + 90 * 24 * 60 * 60 * 1000
  const expiringExceptionIds = new Set<string>()
  const awaitingPlanIds = new Set<string>()
  const missingReferencePlanIds = new Set<string>()

  for (const device of devices) {
    if (
      device.exception?.expiresAt &&
      new Date(device.exception.expiresAt).getTime() <= expiryHorizon
    )
      expiringExceptionIds.add(device.exception.id)
    if (device.planning?.state === 'AWAITING_CUSTOMER')
      awaitingPlanIds.add(device.planning.id)
    if (
      device.planning &&
      activePlanStates.has(device.planning.state) &&
      !device.planning.externalReference
    )
      missingReferencePlanIds.add(device.planning.id)
  }

  return {
    preferred: devices.filter(
      (device) => device.technical.compliance === 'PREFERRED',
    ).length,
    accepted: devices.filter(
      (device) => device.technical.compliance === 'ACCEPTED',
    ).length,
    updateRequired: devices.filter(
      (device) => device.technical.recommendation === 'UPDATE_REQUIRED',
    ).length,
    updateRecommended: devices.filter(
      (device) => device.technical.recommendation === 'UPDATE_RECOMMENDED',
    ).length,
    platformMigration: devices.filter(
      (device) => device.technical.recommendation === 'PLATFORM_MIGRATION',
    ).length,
    reviewRequired: devices.filter(
      (device) => device.technical.recommendation === 'REVIEW_REQUIRED',
    ).length,
    blockedReleases: devices.filter(
      (device) => device.technical.compliance === 'BLOCKED_RELEASE',
    ).length,
    unplannedRecommendations: devices.filter(
      (device) =>
        actionable.has(device.technical.recommendation) && !device.planning,
    ).length,
    awaitingCustomerPlans: awaitingPlanIds.size,
    exceptionsExpiring: expiringExceptionIds.size,
    replacementOrEol: devices.filter(
      (device) => device.attentionClass === 'REPLACEMENT_OR_EOL',
    ).length,
    unmanaged: devices.filter(
      (device) => device.attentionClass === 'UNMANAGED',
    ).length,
    missingExternalReferences: missingReferencePlanIds.size,
  }
}

export function firmwareReviewSnapshotFromJson(
  value: unknown,
): FirmwareReviewSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Partial<FirmwareReviewSnapshot>
  if (
    typeof snapshot.schemaVersion !== 'number' ||
    typeof snapshot.reviewCycleId !== 'string' ||
    typeof snapshot.reportVersion !== 'number' ||
    !snapshot.customer ||
    !Array.isArray(snapshot.sites) ||
    !snapshot.summary
  )
    return null
  return value as FirmwareReviewSnapshot
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
