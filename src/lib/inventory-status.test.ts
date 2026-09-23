import { describe, expect, it } from 'vitest'
import {
  result as complianceResult,
  release as complianceRelease,
} from './test-fixtures/firmware-compliance'
import type { DeviceExceptionSummary } from './device-exception-summary-store'
import { deriveInventoryPrimaryStatus } from './inventory-status'

function noException(): DeviceExceptionSummary {
  return {
    state: 'NONE',
    effective: null,
    activeCount: 0,
    inheritedCount: 0,
    historyCount: 0,
    reviewDueAt: null,
  }
}

function activeException(
  state: DeviceExceptionSummary['state'] = 'ACTIVE',
): DeviceExceptionSummary {
  return {
    state,
    effective:
      state === 'EXPIRED'
        ? null
        : {
            id: 'exception-1',
            reasonCode: 'CUSTOMER_DECLINED',
            reasonLabel: 'Customer declined',
            scope: 'CUSTOMER',
            scopeLabel: 'Acme',
            duration: 'NEXT_REVIEW',
            expiresAt: '2026-10-01T00:00:00.000Z',
          },
    activeCount: state === 'EXPIRED' ? 0 : 1,
    inheritedCount: 0,
    historyCount: 1,
    reviewDueAt: '2026-10-01T00:00:00.000Z',
  }
}

describe('primary inventory status', () => {
  it('keeps blocked and incompatible firmware critical even when an exception exists', () => {
    const blocked = complianceResult({
      compliance: 'BLOCKED_RELEASE',
      recommendation: 'REVIEW_REQUIRED',
    })
    expect(deriveInventoryPrimaryStatus(blocked, activeException()).code).toBe(
      'CRITICAL_ATTENTION',
    )
  })

  it('uses an active exception as the operational presentation for non-critical work', () => {
    const required = complianceResult({
      compliance: 'BELOW_MINIMUM',
      recommendation: 'UPDATE_REQUIRED',
    })
    const status = deriveInventoryPrimaryStatus(required, activeException())
    expect(status.code).toBe('EXCEPTION')
    expect(status.attention).toBe(false)
  })

  it('makes due or expired exceptions actionable again', () => {
    const required = complianceResult({
      compliance: 'BELOW_MINIMUM',
      recommendation: 'UPDATE_REQUIRED',
    })
    expect(
      deriveInventoryPrimaryStatus(required, activeException('REVIEW_DUE')).code,
    ).toBe('REVIEW_REQUIRED')
    expect(
      deriveInventoryPrimaryStatus(required, activeException('EXPIRED')).attention,
    ).toBe(true)
  })

  it('distinguishes required, recommended, unknown and current technical states', () => {
    expect(
      deriveInventoryPrimaryStatus(
        complianceResult({
          compliance: 'BELOW_MINIMUM',
          recommendation: 'UPDATE_REQUIRED',
        }),
        noException(),
      ).code,
    ).toBe('UPDATE_REQUIRED')

    expect(
      deriveInventoryPrimaryStatus(
        complianceResult({
          compliance: 'ACCEPTED',
          recommendation: 'UPDATE_RECOMMENDED',
          preferredTarget: complianceRelease('17.15.5'),
        }),
        noException(),
      ).code,
    ).toBe('UPDATE_RECOMMENDED')

    expect(
      deriveInventoryPrimaryStatus(
        complianceResult({
          compliance: 'NO_POLICY',
          recommendation: 'REVIEW_REQUIRED',
        }),
        noException(),
      ).code,
    ).toBe('UNKNOWN')

    expect(
      deriveInventoryPrimaryStatus(
        complianceResult({
          compliance: 'PREFERRED',
          recommendation: 'NO_ACTION',
        }),
        noException(),
      ).code,
    ).toBe('CURRENT')
  })
})
