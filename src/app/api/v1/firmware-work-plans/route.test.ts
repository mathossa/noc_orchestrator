import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
const listFirmwareWorkPlans = vi.fn()
const getFirmwareWorkPlan = vi.fn()
const previewFirmwareWorkPlan = vi.fn()
const createFirmwareWorkPlan = vi.fn()
const transitionFirmwareWorkPlan = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession } },
}))

vi.mock('@/lib/firmware-work-plan-query-store', () => ({
  listFirmwareWorkPlans,
  getFirmwareWorkPlan,
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
    previewFirmwareWorkPlan,
    createFirmwareWorkPlan,
    transitionFirmwareWorkPlan,
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
    getSession.mockResolvedValue({
      user: { id: 'session-user', role: 'admin' },
    })
  })

  it('passes validated pagination and filters to the query store', async () => {
    listFirmwareWorkPlans.mockResolvedValue({
      data: [],
      pagination: { page: 2, pageSize: 25, total: 0, totalPages: 1 },
    })

    const response = await listPlans(
      new Request(
        'http://localhost/api/v1/firmware-work-plans?state=PROPOSED&customerId=customer-1&page=2&pageSize=25',
      ),
    )

    expect(response.status).toBe(200)
    expect(listFirmwareWorkPlans).toHaveBeenCalledWith({
      states: ['PROPOSED'],
      customerId: 'customer-1',
      page: 2,
      pageSize: 25,
    })
  })

  it('previews selected devices without accepting client actor identity', async () => {
    previewFirmwareWorkPlan.mockResolvedValue({
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
    expect(previewFirmwareWorkPlan).toHaveBeenCalledWith({
      deviceIds: ['device-1'],
    })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('creates from the preview token with the authenticated session actor', async () => {
    createFirmwareWorkPlan.mockResolvedValue({ id: 'plan-1' })

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
    expect(createFirmwareWorkPlan).toHaveBeenCalledWith(
      { deviceIds: ['device-1'] },
      'preview-token',
      'session-user',
    )
  })

  it('returns detail including the query-store read model', async () => {
    getFirmwareWorkPlan.mockResolvedValue({
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
    expect(getFirmwareWorkPlan).toHaveBeenCalledWith('plan-1')
    expect((await response.json()).data.events).toHaveLength(1)
  })

  it('carries displayed optimistic-write values and session actor into transitions', async () => {
    transitionFirmwareWorkPlan.mockResolvedValue({
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
    expect(transitionFirmwareWorkPlan).toHaveBeenCalledWith(
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
    expect(transitionFirmwareWorkPlan).not.toHaveBeenCalled()
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
  })
})
