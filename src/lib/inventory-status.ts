import type { DeviceExceptionSummary } from '@/lib/device-exception-summary-store'
import type { FirmwareComplianceResult } from '@/lib/firmware-compliance'

export const INVENTORY_PRIMARY_STATUS_CODES = [
  'CRITICAL_ATTENTION',
  'UPDATE_REQUIRED',
  'REVIEW_REQUIRED',
  'UPDATE_RECOMMENDED',
  'EXCEPTION',
  'UNKNOWN',
  'CURRENT',
] as const

export type InventoryPrimaryStatusCode =
  (typeof INVENTORY_PRIMARY_STATUS_CODES)[number]

export type InventoryPrimaryStatus = {
  code: InventoryPrimaryStatusCode
  label: string
  attention: boolean
  severity: number
  reason: string
  tone: 'danger' | 'warning' | 'info' | 'accent' | 'neutral' | 'success'
}

/**
 * Inventory status is a presentation-only projection.
 *
 * Precedence:
 * 1. blocked/incompatible technical state remains critical even when an exception exists;
 * 2. exception review/expiry is actionable;
 * 3. a currently accepted exception quiets non-critical technical work;
 * 4. required update;
 * 5. review-required technical state;
 * 6. recommended update/platform migration;
 * 7. unresolved/unknown/no-policy state;
 * 8. current/no action.
 *
 * Underlying compliance, exception, lifecycle/planning, contract and source state
 * remain independent and are never rewritten by this projection.
 */
export function deriveInventoryPrimaryStatus(
  result: FirmwareComplianceResult,
  exception: DeviceExceptionSummary,
): InventoryPrimaryStatus {
  const critical =
    result.compliance === 'BLOCKED_RELEASE' ||
    result.compliance === 'INCOMPATIBLE' ||
    result.targetCompatibility?.status === 'INCOMPATIBLE'

  if (critical) {
    return {
      code: 'CRITICAL_ATTENTION',
      label: 'Critical attention',
      attention: true,
      severity: 700,
      reason: result.explanation,
      tone: 'danger',
    }
  }

  const technicallyActionable = result.recommendation !== 'NO_ACTION'

  if (
    technicallyActionable &&
    (exception.state === 'REVIEW_DUE' || exception.state === 'EXPIRED')
  ) {
    return {
      code: 'REVIEW_REQUIRED',
      label: 'Exception review',
      attention: true,
      severity: 600,
      reason:
        exception.state === 'EXPIRED'
          ? 'A matching firmware exception expired; review the underlying technical recommendation.'
          : 'The effective firmware exception is due for review.',
      tone: 'warning',
    }
  }

  if (
    technicallyActionable &&
    exception.state === 'ACTIVE' &&
    exception.effective
  ) {
    return {
      code: 'EXCEPTION',
      label: 'Exception',
      attention: false,
      severity: 50,
      reason:
        exception.effective.reasonLabel +
        ' (' +
        exception.effective.scope.toLowerCase() +
        ' exception).',
      tone: 'accent',
    }
  }

  if (result.recommendation === 'UPDATE_REQUIRED') {
    return {
      code: 'UPDATE_REQUIRED',
      label: 'Update required',
      attention: true,
      severity: 500,
      reason: result.explanation,
      tone: 'warning',
    }
  }

  if (
    result.compliance === 'UNKNOWN_FIRMWARE' ||
    result.compliance === 'NO_POLICY' ||
    result.compliance === 'NOT_COMPARABLE' ||
    result.compliance === 'COMPATIBILITY_UNRESOLVED' ||
    result.compliance === 'TARGET_UNRESOLVED'
  ) {
    return {
      code: 'UNKNOWN',
      label: 'Unknown',
      attention: true,
      severity: 300,
      reason: result.explanation,
      tone: 'info',
    }
  }

  if (result.recommendation === 'REVIEW_REQUIRED') {
    return {
      code: 'REVIEW_REQUIRED',
      label: 'Review required',
      attention: true,
      severity: 400,
      reason: result.explanation,
      tone: 'warning',
    }
  }

  if (
    result.recommendation === 'UPDATE_RECOMMENDED' ||
    result.recommendation === 'PLATFORM_MIGRATION'
  ) {
    return {
      code: 'UPDATE_RECOMMENDED',
      label:
        result.recommendation === 'PLATFORM_MIGRATION'
          ? 'Migration recommended'
          : 'Update recommended',
      attention: true,
      severity: 200,
      reason: result.explanation,
      tone: 'neutral',
    }
  }

  return {
    code: 'CURRENT',
    label: 'Current',
    attention: false,
    severity: 0,
    reason: result.explanation,
    tone: 'success',
  }
}

export function inventoryStatusNeedsAttention(
  status: Pick<InventoryPrimaryStatus, 'attention'>,
) {
  return status.attention
}

export function compareInventoryStatus(
  left: Pick<InventoryPrimaryStatus, 'severity'>,
  right: Pick<InventoryPrimaryStatus, 'severity'>,
) {
  return right.severity - left.severity
}
