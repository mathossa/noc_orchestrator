export const FIRMWARE_WORK_PLAN_STATES = [
  'PROPOSED',
  'AWAITING_CUSTOMER',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const

export type FirmwareWorkPlanState = (typeof FIRMWARE_WORK_PLAN_STATES)[number]

export const FIRMWARE_UPGRADE_CAPABILITIES = [
  'UNKNOWN',
  'ROLLING_SUPPORTED',
  'COORDINATED_OUTAGE',
  'MANUAL_REVIEW',
] as const

export type FirmwareUpgradeCapability = (typeof FIRMWARE_UPGRADE_CAPABILITIES)[number]

export const FIRMWARE_WORK_PLAN_STALE_REASONS = [
  'POLICY_CHANGED',
  'PREFERRED_TARGET_CHANGED',
  'TARGET_BLOCKED_OR_WITHDRAWN',
  'TARGET_UNRESOLVED',
  'DEVICE_MODEL_CHANGED',
  'OBSERVED_FIRMWARE_CHANGED',
  'COMPATIBILITY_CHANGED',
  'ACTIVE_EXCEPTION_ADDED',
] as const

export type FirmwareWorkPlanStaleReason = (typeof FIRMWARE_WORK_PLAN_STALE_REASONS)[number]

const ACTIVE_PLAN_STATES = new Set<FirmwareWorkPlanState>([
  'PROPOSED',
  'AWAITING_CUSTOMER',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
])

const TRANSITIONS: Record<FirmwareWorkPlanState, readonly FirmwareWorkPlanState[]> = {
  PROPOSED: ['AWAITING_CUSTOMER', 'APPROVED', 'CANCELLED'],
  AWAITING_CUSTOMER: ['PROPOSED', 'APPROVED', 'CANCELLED'],
  APPROVED: ['PROPOSED', 'SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
}

export class FirmwareWorkPlanTransitionError extends Error {
  constructor(
    readonly from: FirmwareWorkPlanState,
    readonly to: FirmwareWorkPlanState,
  ) {
    super(`Firmware work plan cannot transition from ${from} to ${to}.`)
    this.name = 'FirmwareWorkPlanTransitionError'
  }
}

export function isActiveFirmwareWorkPlanState(state: FirmwareWorkPlanState) {
  return ACTIVE_PLAN_STATES.has(state)
}

export function canTransitionFirmwareWorkPlan(
  from: FirmwareWorkPlanState,
  to: FirmwareWorkPlanState,
) {
  return TRANSITIONS[from].includes(to)
}

export function assertFirmwareWorkPlanTransition(
  from: FirmwareWorkPlanState,
  to: FirmwareWorkPlanState,
) {
  if (!canTransitionFirmwareWorkPlan(from, to)) {
    throw new FirmwareWorkPlanTransitionError(from, to)
  }
}

export type FirmwareWorkPlanTargetSnapshot = {
  deviceModelId: string
  observedFirmwareFingerprint: string | null
  policyFingerprint: string | null
  preferredTargetFirmwareReleaseId: string | null
  targetFirmwareReleaseId: string
}

export type FirmwareWorkPlanCurrentContext = {
  deviceModelId: string
  observedFirmwareFingerprint: string | null
  policyFingerprint: string | null
  preferredTargetFirmwareReleaseId: string | null
  targetFirmwareReleaseId: string | null
  targetCatalogState: string | null
  targetCompatibilityResolved: boolean
  hasActiveException: boolean
}

export type FirmwareWorkPlanStaleness = {
  stale: boolean
  reasons: FirmwareWorkPlanStaleReason[]
}

function blockedOrWithdrawn(value: string | null) {
  const normalized = value?.trim().toUpperCase() ?? ''
  return normalized === 'BLOCKED' || normalized === 'WITHDRAWN'
}

/**
 * Detects material drift from the immutable assumptions captured when a target
 * was added to a work plan. This function only reports review requirements; it
 * never rewrites the stored target snapshot.
 *
 * DONE/CANCELLED plans are historical and deliberately do not become stale.
 */
export function resolveFirmwareWorkPlanStaleness(
  state: FirmwareWorkPlanState,
  snapshot: FirmwareWorkPlanTargetSnapshot,
  current: FirmwareWorkPlanCurrentContext,
): FirmwareWorkPlanStaleness {
  if (!isActiveFirmwareWorkPlanState(state)) {
    return { stale: false, reasons: [] }
  }

  const reasons: FirmwareWorkPlanStaleReason[] = []
  if (snapshot.policyFingerprint !== current.policyFingerprint) reasons.push('POLICY_CHANGED')
  if (snapshot.preferredTargetFirmwareReleaseId !== current.preferredTargetFirmwareReleaseId) {
    reasons.push('PREFERRED_TARGET_CHANGED')
  }
  if (!current.targetFirmwareReleaseId) reasons.push('TARGET_UNRESOLVED')
  else if (current.targetFirmwareReleaseId !== snapshot.targetFirmwareReleaseId) reasons.push('TARGET_UNRESOLVED')
  if (blockedOrWithdrawn(current.targetCatalogState)) reasons.push('TARGET_BLOCKED_OR_WITHDRAWN')
  if (snapshot.deviceModelId !== current.deviceModelId) reasons.push('DEVICE_MODEL_CHANGED')
  if (snapshot.observedFirmwareFingerprint !== current.observedFirmwareFingerprint) {
    reasons.push('OBSERVED_FIRMWARE_CHANGED')
  }
  if (!current.targetCompatibilityResolved) reasons.push('COMPATIBILITY_CHANGED')
  if (current.hasActiveException) reasons.push('ACTIVE_EXCEPTION_ADDED')

  return { stale: reasons.length > 0, reasons }
}
