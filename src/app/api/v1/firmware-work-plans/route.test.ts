import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mocks.getSession: vi.fn(),
  mocks.listFirmwareWorkPlans: vi.fn(),
  mocks.getFirmwareWorkPlan: vi.fn(),
  mocks.previewFirmwareWorkPlan: vi.fn(),
  mocks.createFirmwareWorkPlan: vi.fn(),
  mocks.transitionFirmwareWorkPlan: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { mocks.getSession } },
}))

vi.mock('@/lib/firmware-work-plan-query-store', () => ({
  mocks.listFirmwareWorkPlans,
  mocks.getFirmwareWorkPlan,
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
    mocks.previewFirmwareWorkPlan,
    mocks.createFirmwareWorkPlan,
    mocks.transitionFirmwareWorkPlan,
  }
})

import {
  GET as listPlans,
  POST as mutatePlans,
} from '@/app/api/v1/firmware-work-plans/route'
import { GET as getPlan } from '@/app/api/v1/firmware-work-plans/[id]/route'
import { POST as transitionPlan } from '@/app/api/v1/firmware-work-plans/[id]/transitions/route'

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
        'http://localhost/api/v1/firmware-work-plans?state=PROPOSED&customerId=customer-1&page=2&pageSize=25',
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.listFirmwareWorkPlans).toHaveBeenCalledWith({
      states: ['PROPOSED'],
      customerId: 'customer-1',
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

  it('carries displayed optimistic-write values and session actor into transitions', async () => {
    mocks.transitionFirmwareWorkPlan.mockResolvedValue({
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
    expect(mocks.transitionFirmwareWorkPlan).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({
        expectedState: 'APPROVED',
        expectedUpdatedAt: new Date('2026-09-20T11:00:00.123Z'),
        toState: 'SCHEDULED',
        scheduledFor: new Date('2026-09-21T20:00:00.000Z'),
        maintenanceWindowReference: 'MW-42',
        actorUserId: 'session-user',
      }),
    )
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
