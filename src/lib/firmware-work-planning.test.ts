import { describe, expect, it } from 'vitest'
import {
  assertFirmwareWorkPlanTransition,
  canTransitionFirmwareWorkPlan,
  isActiveFirmwareWorkPlanState,
  resolveFirmwareWorkPlanStaleness,
  type FirmwareWorkPlanCurrentContext,
  type FirmwareWorkPlanTargetSnapshot,
} from './firmware-work-planning'

const snapshot: FirmwareWorkPlanTargetSnapshot = {
  deviceModelId: 'model-1',
  observedFirmwareFingerprint: 'observed:17.12.5',
  policyFingerprint: 'policy:v1',
  preferredTargetFirmwareReleaseId: 'fw-17.15.5',
  targetFirmwareReleaseId: 'fw-17.15.5',
}

const current: FirmwareWorkPlanCurrentContext = {
  deviceModelId: 'model-1',
  observedFirmwareFingerprint: 'observed:17.12.5',
  policyFingerprint: 'policy:v1',
  preferredTargetFirmwareReleaseId: 'fw-17.15.5',
  targetFirmwareReleaseId: 'fw-17.15.5',
  targetCatalogState: 'VERIFIED',
  targetCompatibilityResolved: true,
  hasActiveException: false,
}

describe('firmware work planning domain', () => {
  it('supports the expected proposal, approval, schedule and completion path', () => {
    expect(canTransitionFirmwareWorkPlan('PROPOSED', 'AWAITING_CUSTOMER')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('AWAITING_CUSTOMER', 'APPROVED')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('APPROVED', 'SCHEDULED')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('SCHEDULED', 'IN_PROGRESS')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('IN_PROGRESS', 'DONE')).toBe(true)
  })

  it('keeps completed and cancelled plans terminal', () => {
    expect(isActiveFirmwareWorkPlanState('DONE')).toBe(false)
    expect(isActiveFirmwareWorkPlanState('CANCELLED')).toBe(false)
    expect(canTransitionFirmwareWorkPlan('DONE', 'PROPOSED')).toBe(false)
    expect(canTransitionFirmwareWorkPlan('CANCELLED', 'PROPOSED')).toBe(false)
    expect(() => assertFirmwareWorkPlanTransition('DONE', 'PROPOSED')).toThrow(
      'cannot transition from DONE to PROPOSED',
    )
  })

  it('allows controlled rollback before execution without silently reopening completed work', () => {
    expect(canTransitionFirmwareWorkPlan('AWAITING_CUSTOMER', 'PROPOSED')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('APPROVED', 'PROPOSED')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('SCHEDULED', 'APPROVED')).toBe(true)
    expect(canTransitionFirmwareWorkPlan('IN_PROGRESS', 'APPROVED')).toBe(false)
  })

  it('does not mark an unchanged active target stale', () => {
    expect(resolveFirmwareWorkPlanStaleness('SCHEDULED', snapshot, current)).toEqual({
      stale: false,
      reasons: [],
    })
  })

  it('flags material assumption changes without rewriting the snapshotted target', () => {
    const changed: FirmwareWorkPlanCurrentContext = {
      ...current,
      deviceModelId: 'model-2',
      observedFirmwareFingerprint: 'observed:17.15.1',
      policyFingerprint: 'policy:v2',
      preferredTargetFirmwareReleaseId: 'fw-17.15.6',
      targetCatalogState: 'BLOCKED',
      targetCompatibilityResolved: false,
      hasActiveException: true,
    }

    const result = resolveFirmwareWorkPlanStaleness('SCHEDULED', snapshot, changed)
    expect(result.stale).toBe(true)
    expect(result.reasons).toEqual([
      'POLICY_CHANGED',
      'PREFERRED_TARGET_CHANGED',
      'TARGET_BLOCKED_OR_WITHDRAWN',
      'DEVICE_MODEL_CHANGED',
      'OBSERVED_FIRMWARE_CHANGED',
      'COMPATIBILITY_CHANGED',
      'ACTIVE_EXCEPTION_ADDED',
    ])
    expect(snapshot.targetFirmwareReleaseId).toBe('fw-17.15.5')
  })

  it('flags a target that can no longer be resolved to the snapshotted release', () => {
    expect(
      resolveFirmwareWorkPlanStaleness('APPROVED', snapshot, {
        ...current,
        targetFirmwareReleaseId: null,
      }).reasons,
    ).toEqual(['TARGET_UNRESOLVED'])
  })

  it('never reclassifies completed work as stale history', () => {
    expect(
      resolveFirmwareWorkPlanStaleness('DONE', snapshot, {
        ...current,
        policyFingerprint: 'policy:v99',
        preferredTargetFirmwareReleaseId: 'fw-new',
        targetFirmwareReleaseId: null,
        targetCatalogState: 'WITHDRAWN',
        targetCompatibilityResolved: false,
        hasActiveException: true,
      }),
    ).toEqual({ stale: false, reasons: [] })
  })
})
