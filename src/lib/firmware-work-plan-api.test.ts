import { describe, expect, it } from 'vitest'
import {
  firmwareWorkPlanApiError,
  FirmwareWorkPlanApiValidationError,
  parseFirmwareWorkPlanBulkTransition,
  parseFirmwareWorkPlanProposalAmendment,
  parseFirmwareWorkPlanQuery,
  parseFirmwareWorkPlanTransition,
} from '@/lib/firmware-work-plan-api'

describe('firmware work plan API boundary', () => {
  it('parses the complete supported server-side plan filter set', () => {
    const query = parseFirmwareWorkPlanQuery(
      new URLSearchParams({
        state: 'PROPOSED,SCHEDULED',
        customerId: 'customer-1',
        siteId: 'site-1',
        vendorId: 'vendor-1',
        deviceModelFamilyId: 'family-1',
        deviceModelId: 'model-1',
        recommendation: 'update_required',
        scheduledFrom: '2026-09-20T08:00:00+02:00',
        scheduledUntil: '2026-09-21T08:00:00+02:00',
        page: '2',
        pageSize: '25',
      }),
    )

    expect(query).toMatchObject({
      states: ['PROPOSED', 'SCHEDULED'],
      customerId: 'customer-1',
      siteId: 'site-1',
      vendorId: 'vendor-1',
      deviceModelFamilyId: 'family-1',
      deviceModelId: 'model-1',
      recommendation: 'UPDATE_REQUIRED',
      page: 2,
      pageSize: 25,
    })
    expect(query.scheduledFrom?.toISOString()).toBe(
      '2026-09-20T06:00:00.000Z',
    )
    expect(query.scheduledUntil?.toISOString()).toBe(
      '2026-09-21T06:00:00.000Z',
    )
  })

  it('rejects ambiguous timestamps without a timezone', () => {
    expect(() =>
      parseFirmwareWorkPlanTransition({
        expectedState: 'APPROVED',
        toState: 'SCHEDULED',
        expectedUpdatedAt: '2026-09-20T11:00:00Z',
        scheduledFor: '2026-09-21T22:00:00',
      }),
    ).toThrow(FirmwareWorkPlanApiValidationError)
  })

  it('preserves the intended scheduled instant and optimistic-write context', () => {
    const transition = parseFirmwareWorkPlanTransition({
      expectedState: 'APPROVED',
      toState: 'SCHEDULED',
      expectedUpdatedAt: '2026-09-20T11:00:00.123Z',
      scheduledFor: '2026-09-21T22:00:00+02:00',
      maintenanceWindowReference: 'MW-2026-09-21',
      reason: 'Approved maintenance',
    })

    expect(transition.expectedState).toBe('APPROVED')
    expect(transition.expectedUpdatedAt.toISOString()).toBe(
      '2026-09-20T11:00:00.123Z',
    )
    if (transition.toState !== 'SCHEDULED')
      throw new Error('Expected scheduled transition.')
    if (!transition.scheduledFor)
      throw new Error('Expected explicit scheduled timestamp.')
    expect(transition.scheduledFor.toISOString()).toBe(
      '2026-09-21T20:00:00.000Z',
    )
    expect(transition.maintenanceWindowReference).toBe('MW-2026-09-21')
  })

  it('allows SCHEDULED to promote an already persisted proposal', () => {
    const transition = parseFirmwareWorkPlanTransition({
      expectedState: 'AWAITING_CUSTOMER',
      toState: 'SCHEDULED',
      expectedUpdatedAt: '2026-09-20T11:00:00Z',
      reason: 'Customer approved the proposed window.',
    })

    expect(transition.toState).toBe('SCHEDULED')
    if (transition.toState !== 'SCHEDULED')
      throw new Error('Expected scheduled transition.')
    expect(transition.scheduledFor).toBeUndefined()
  })

  it('parses atomic bulk transitions with per-plan optimistic context', () => {
    const transition = parseFirmwareWorkPlanBulkTransition({
      items: [
        {
          id: 'plan-1',
          expectedState: 'APPROVED',
          expectedUpdatedAt: '2026-09-20T11:00:00.123Z',
        },
        {
          id: 'plan-2',
          expectedState: 'AWAITING_CUSTOMER',
          expectedUpdatedAt: '2026-09-20T11:05:00.456Z',
        },
      ],
      toState: 'SCHEDULED',
      reason: 'Customer windows confirmed',
    })

    expect(transition).toEqual({
      items: [
        {
          id: 'plan-1',
          expectedState: 'APPROVED',
          expectedUpdatedAt: new Date('2026-09-20T11:00:00.123Z'),
        },
        {
          id: 'plan-2',
          expectedState: 'AWAITING_CUSTOMER',
          expectedUpdatedAt: new Date('2026-09-20T11:05:00.456Z'),
        },
      ],
      toState: 'SCHEDULED',
      reason: 'Customer windows confirmed',
      notes: undefined,
    })
  })

  it('rejects duplicate bulk selections and per-request scheduling overrides', () => {
    expect(() =>
      parseFirmwareWorkPlanBulkTransition({
        items: [
          {
            id: 'plan-1',
            expectedState: 'APPROVED',
            expectedUpdatedAt: '2026-09-20T11:00:00Z',
          },
          {
            id: 'plan-1',
            expectedState: 'APPROVED',
            expectedUpdatedAt: '2026-09-20T11:00:00Z',
          },
        ],
        toState: 'SCHEDULED',
      }),
    ).toThrow(/unique/)

    expect(() =>
      parseFirmwareWorkPlanBulkTransition({
        items: [
          {
            id: 'plan-1',
            expectedState: 'APPROVED',
            expectedUpdatedAt: '2026-09-20T11:00:00Z',
          },
        ],
        toState: 'SCHEDULED',
        scheduledFor: '2026-10-01T20:00:00Z',
      }),
    ).toThrow(/stored proposed window/)
  })

  it('parses an audited proposal amendment with an explicit timezone', () => {
    const amendment = parseFirmwareWorkPlanProposalAmendment({
      expectedState: 'AWAITING_CUSTOMER',
      expectedUpdatedAt: '2026-09-20T11:00:00.123Z',
      proposedFor: '2026-10-04T22:00:00+02:00',
      proposedMaintenanceWindowReference: 'MW-CUSTOMER-1',
      reason: 'Customer requested a different Sunday.',
    })

    expect(amendment).toMatchObject({
      expectedState: 'AWAITING_CUSTOMER',
      expectedUpdatedAt: new Date('2026-09-20T11:00:00.123Z'),
      proposedFor: new Date('2026-10-04T20:00:00.000Z'),
      proposedMaintenanceWindowReference: 'MW-CUSTOMER-1',
      reason: 'Customer requested a different Sunday.',
    })
  })

  it('does not accept scheduling fields on non-scheduling transitions', () => {
    expect(() =>
      parseFirmwareWorkPlanTransition({
        expectedState: 'SCHEDULED',
        toState: 'IN_PROGRESS',
        expectedUpdatedAt: '2026-09-20T11:00:00Z',
        scheduledFor: '2026-09-21T20:00:00Z',
      }),
    ).toThrow(/Scheduling fields are only valid/)
  })

  it('maps stale optimistic writes to an explicit refresh-and-review conflict', async () => {
    const conflict = Object.assign(
      new Error('Work plan changed. Reload before transitioning.'),
      { name: 'FirmwareWorkPlanError', status: 409 },
    )
    const response = firmwareWorkPlanApiError(conflict)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'STALE_WRITE',
        message:
          'This plan changed after it was displayed. Refresh and review the latest state before applying the transition.',
      },
    })
  })

  it('rejects unsupported states and invalid pagination', () => {
    expect(() =>
      parseFirmwareWorkPlanQuery(
        new URLSearchParams({
          state: 'NOT_A_STATE',
          page: 'zero',
        }),
      ),
    ).toThrow(FirmwareWorkPlanApiValidationError)
  })
})
