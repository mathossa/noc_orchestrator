import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listFirmwareWorkPlans: vi.fn(),
  getFirmwareWorkPlan: vi.fn(),
  previewFirmwareWorkPlan: vi.fn(),
  createFirmwareWorkPlan: vi.fn(),
  amendFirmwareWorkPlanProposal: vi.fn(),
  scheduleFirmwareWorkPlan: vi.fn(),
  transitionFirmwareWorkPlan: vi.fn(),
  bulkTransitionFirmwareWorkPlans: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}))

vi.mock('@/lib/firmware-work-plan-query-store', () => ({
  listFirmwareWorkPlans: mocks.listFirmwareWorkPlans,
  getFirmwareWorkPlan: mocks.getFirmwareWorkPlan,
}))

vi.mock('@/lib/firmware-work-plan-store', () => {
  class FirmwareWorkPlanError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message)
      this.name = 'FirmwareWorkPlanError'
    }
  }
  return {
    FirmwareWorkPlanError,
    previewFirmwareWorkPlan: mocks.previewFirmwareWorkPlan,
    createFirmwareWorkPlan: mocks.createFirmwareWorkPlan,
    amendFirmwareWorkPlanProposal: mocks.amendFirmwareWorkPlanProposal,
    scheduleFirmwareWorkPlan: mocks.scheduleFirmwareWorkPlan,
    transitionFirmwareWorkPlan: mocks.transitionFirmwareWorkPlan,
    bulkTransitionFirmwareWorkPlans: mocks.bulkTransitionFirmwareWorkPlans,
  }
})

import {
  GET as listPlans,
  POST as mutatePlans,
} from '@/app/api/v1/firmware-work-plans/route'
import {
  GET as getPlan,
  PATCH as amendPlan,
} from '@/app/api/v1/firmware-work-plans/[id]/route'
import { POST as transitionPlan } from '@/app/api/v1/firmware-work-plans/[id]/transitions/route'
import { POST as bulkTransitionPlans } from '@/app/api/v1/firmware-work-plans/transitions/route'
import { FirmwareWorkPlanError } from '@/lib/firmware-work-plan-store'

describe('firmware work plan routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'session-user', role: 'admin' },
    })
  })

  it('passes validated pagination and filters to the query store', async () => {
    mocks.listFirmwareWorkPlans.mockResolvedValue({
      data: [],
      pagination: { page: 2, pageSize: 25, total: 0, totalPages: 1 },
    })

    const response = await listPlans(
      new Request(
        'http://localhost/api/v1/firmware-work-plans?state=PROPOSED&customerId=customer-1&siteId=site-1&vendorId=vendor-1&deviceModelFamilyId=family-1&deviceModelId=model-1&recommendation=UPDATE_REQUIRED&scheduledFrom=2026-09-20T06%3A00%3A00.000Z&scheduledUntil=2026-09-21T06%3A00%3A00.000Z&page=2&pageSize=25',
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.listFirmwareWorkPlans).toHaveBeenCalledWith({
      states: ['PROPOSED'],
      customerId: 'customer-1',
      siteId: 'site-1',
      vendorId: 'vendor-1',
      deviceModelFamilyId: 'family-1',
      deviceModelId: 'model-1',
      recommendation: 'UPDATE_REQUIRED',
      scheduledFrom: new Date('2026-09-20T06:00:00.000Z'),
      scheduledUntil: new Date('2026-09-21T06:00:00.000Z'),
      page: 2,
      pageSize: 25,
    })
  })

  it('previews selected devices without accepting client actor identity', async () => {
    mocks.previewFirmwareWorkPlan.mockResolvedValue({
      token: 'preview-token',
      counts: { requested: 1, included: 1 },
      targets: [],
      targetDistribution: [],
    })

    const response = await mutatePlans(
      new Request('http://localhost/api/v1/firmware-work-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          actorUserId: 'client-supplied-user',
          input: { deviceIds: ['device-1'] },
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.previewFirmwareWorkPlan).toHaveBeenCalledWith({
      deviceIds: ['device-1'],
    })
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('creates from the preview token with the authenticated session actor', async () => {
    mocks.createFirmwareWorkPlan.mockResolvedValue({ id: 'plan-1' })

    const response = await mutatePlans(
      new Request('http://localhost/api/v1/firmware-work-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          token: 'preview-token',
          actorUserId: 'client-supplied-user',
          input: { deviceIds: ['device-1'] },
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.createFirmwareWorkPlan).toHaveBeenCalledWith(
      { deviceIds: ['device-1'] },
      'preview-token',
      'session-user',
    )
  })

  it('requires a new preview when the confirmed preview becomes stale', async () => {
    mocks.createFirmwareWorkPlan.mockRejectedValue(
      new FirmwareWorkPlanError(
        'Inventory, policy, exception, compatibility, or planning state changed. Preview the work again before saving.',
        409,
      ),
    )

    const response = await mutatePlans(
      new Request('http://localhost/api/v1/firmware-work-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          token: 'stale-preview-token',
          input: { deviceIds: ['device-1'] },
        }),
      }),
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('STALE_PREVIEW')
    expect(mocks.createFirmwareWorkPlan).toHaveBeenCalledTimes(1)
  })

  it('returns detail including the query-store read model', async () => {
    mocks.getFirmwareWorkPlan.mockResolvedValue({
      id: 'plan-1',
      state: 'SCHEDULED',
      events: [{ id: 'event-1' }],
      targets: [{ id: 'target-1' }],
    })

    const response = await getPlan(
      new Request('http://localhost/api/v1/firmware-work-plans/plan-1'),
      { params: Promise.resolve({ id: 'plan-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.getFirmwareWorkPlan).toHaveBeenCalledWith('plan-1')
    expect((await response.json()).data.events).toHaveLength(1)
  })

  it('amends the proposed window with validated time and authenticated actor', async () => {
    mocks.amendFirmwareWorkPlanProposal.mockResolvedValue({
      id: 'plan-1',
      state: 'AWAITING_CUSTOMER',
    })

    const response = await amendPlan(
      new Request('http://localhost/api/v1/firmware-work-plans/plan-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedState: 'AWAITING_CUSTOMER',
          expectedUpdatedAt: '2026-09-20T11:00:00.123Z',
          proposedFor: '2026-10-04T22:00:00+02:00',
          proposedMaintenanceWindowReference: 'MW-NEW',
          actorUserId: 'client-supplied-user',
        }),
      }),
      { params: Promise.resolve({ id: 'plan-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.amendFirmwareWorkPlanProposal).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({
        expectedState: 'AWAITING_CUSTOMER',
        expectedUpdatedAt: new Date('2026-09-20T11:00:00.123Z'),
        proposedFor: new Date('2026-10-04T20:00:00.000Z'),
        proposedMaintenanceWindowReference: 'MW-NEW',
        actorUserId: 'session-user',
      }),
    )
  })

  it('carries displayed optimistic-write values and session actor into transitions', async () => {
    mocks.scheduleFirmwareWorkPlan.mockResolvedValue({
      id: 'plan-1',
      state: 'SCHEDULED',
    })

    const response = await transitionPlan(
      new Request(
        'http://localhost/api/v1/firmware-work-plans/plan-1/transitions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedState: 'APPROVED',
            expectedUpdatedAt: '2026-09-20T11:00:00.123Z',
            toState: 'SCHEDULED',
            scheduledFor: '2026-09-21T22:00:00+02:00',
            maintenanceWindowReference: 'MW-42',
            actorUserId: 'client-supplied-user',
          }),
        },
      ),
      { params: Promise.resolve({ id: 'plan-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.scheduleFirmwareWorkPlan).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({
        expectedState: 'APPROVED',
        expectedUpdatedAt: new Date('2026-09-20T11:00:00.123Z'),
        scheduledFor: new Date('2026-09-21T20:00:00.000Z'),
        maintenanceWindowReference: 'MW-42',
        actorUserId: 'session-user',
      }),
    )
    expect(mocks.transitionFirmwareWorkPlan).not.toHaveBeenCalled()
  })

  it('bulk-transitions displayed selections with the authenticated actor', async () => {
    mocks.bulkTransitionFirmwareWorkPlans.mockResolvedValue([
      { id: 'plan-1', state: 'APPROVED' },
      { id: 'plan-2', state: 'APPROVED' },
    ])

    const response = await bulkTransitionPlans(
      new Request('http://localhost/api/v1/firmware-work-plans/transitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              id: 'plan-1',
              expectedState: 'PROPOSED',
              expectedUpdatedAt: '2026-09-20T11:00:00.123Z',
            },
            {
              id: 'plan-2',
              expectedState: 'PROPOSED',
              expectedUpdatedAt: '2026-09-20T11:01:00.456Z',
            },
          ],
          toState: 'APPROVED',
          actorUserId: 'client-supplied-user',
          reason: 'Batch approval',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mocks.bulkTransitionFirmwareWorkPlans).toHaveBeenCalledWith({
      items: [
        {
          id: 'plan-1',
          expectedState: 'PROPOSED',
          expectedUpdatedAt: new Date('2026-09-20T11:00:00.123Z'),
        },
        {
          id: 'plan-2',
          expectedState: 'PROPOSED',
          expectedUpdatedAt: new Date('2026-09-20T11:01:00.456Z'),
        },
      ],
      toState: 'APPROVED',
      reason: 'Batch approval',
      notes: undefined,
      actorUserId: 'session-user',
    })
  })

  it('does not retry a stale user transition', async () => {
    mocks.transitionFirmwareWorkPlan.mockRejectedValue(
      new FirmwareWorkPlanError(
        'Work plan changed. Reload before transitioning.',
        409,
      ),
    )

    const response = await transitionPlan(
      new Request(
        'http://localhost/api/v1/firmware-work-plans/plan-1/transitions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedState: 'SCHEDULED',
            expectedUpdatedAt: '2026-09-20T11:00:00Z',
            toState: 'IN_PROGRESS',
          }),
        },
      ),
      { params: Promise.resolve({ id: 'plan-1' }) },
    )

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('STALE_WRITE')
    expect(mocks.transitionFirmwareWorkPlan).toHaveBeenCalledTimes(1)
  })

  it('rejects timezone-ambiguous scheduling input before calling the store', async () => {
    const response = await transitionPlan(
      new Request(
        'http://localhost/api/v1/firmware-work-plans/plan-1/transitions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedState: 'APPROVED',
            expectedUpdatedAt: '2026-09-20T11:00:00Z',
            toState: 'SCHEDULED',
            scheduledFor: '2026-09-21T22:00:00',
          }),
        },
      ),
      { params: Promise.resolve({ id: 'plan-1' }) },
    )

    expect(response.status).toBe(400)
    expect(mocks.transitionFirmwareWorkPlan).not.toHaveBeenCalled()
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
  })
})
