import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FirmwareWorkPlan } from '@/generated/prisma/client'
import type { FirmwareWorkPlanState } from './firmware-work-planning'

import {
  result as complianceResult,
  release as complianceRelease,
} from './test-fixtures/firmware-compliance'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  devices: vi.fn(),
  exceptions: vi.fn(),
  activeTargets: vi.fn(),
  compliance: vi.fn(),
  createPlan: vi.fn(),
  audit: vi.fn(),
  findPlan: vi.fn(),
  updatePlan: vi.fn(),
  readPlan: vi.fn(),
  event: vi.fn(),
}))

const tx = {
  device: { findMany: mocks.devices },
  firmwareException: { findMany: mocks.exceptions },
  firmwareWorkPlanTarget: { findMany: mocks.activeTargets },
  firmwareWorkPlan: { create: mocks.createPlan, findUnique: mocks.findPlan, updateMany: mocks.updatePlan, findUniqueOrThrow: mocks.readPlan },
  firmwareWorkPlanEvent: { create: mocks.event },
  auditEvent: { create: mocks.audit },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

vi.mock('@/lib/firmware-compliance-store', () => ({
  resolveFirmwareComplianceBatch: mocks.compliance,
}))

import {
  amendFirmwareWorkPlanProposal,
  createFirmwareWorkPlan,
  parseFirmwareWorkPlanInput,
  previewFirmwareWorkPlan,
  transitionFirmwareWorkPlan,
  scheduleFirmwareWorkPlan,
  type TransitionFirmwareWorkPlanInput,
} from './firmware-work-plan-store'

function device(id: string) {
  return {
    id,
    name: `SW-${id}`,
    isActive: true,
    customerId: 'customer',
    siteId: 'site',
    deviceModelId: 'model',
    currentFirmwareReleaseId: '17.12.5',
    currentFirmwareObservedAt: new Date('2026-09-10T08:00:00Z'),
    currentFirmwareRawVersion: '17.12.5',
    currentFirmwareNormalizedVersion: '17.12.5',
    customer: { id: 'customer', name: 'Acme' },
    site: { id: 'site', name: 'HQ' },
    deviceModel: { id: 'model', model: 'C9300-24P', familyId: 'family' },
  }
}

function actionResult(targetId = 'target') {
  const target = complianceRelease('17.15.5', { id: targetId })
  return complianceResult({
    compliance: 'OUTSIDE_RANGE',
    recommendation: 'UPDATE_REQUIRED',
    preferredTarget: target,
    resolvedTarget: target,
    targetCompatibility: {
      status: 'RESOLVED',
      release: target,
      compatibleCandidates: [target],
      unknownCandidates: [],
      incompatibleCandidates: [],
      explanation: 'Resolved exact image',
    },
  })
}

function activeException(deviceId: string) {
  return {
    id: `exception-${deviceId}`,
    scope: 'DEVICE',
    scopeId: deviceId,
    scopeLabel: `SW-${deviceId}`,
    subject: 'ALL_MAINTENANCE',
    reasonCode: 'CUSTOMER_DECLINED',
    notes: null,
    releaseId: null,
    vendorId: null,
    platform: null,
    minimumVersion: null,
    maximumVersion: null,
    trainId: null,
    fromPlatform: null,
    toPlatform: null,
    duration: 'PERMANENT',
    expiresAt: null,
    policySnapshots: {},
    actorUserId: null,
    contactReference: null,
    ticketReference: null,
    decidedAt: new Date('2026-09-01T00:00:00Z'),
    supersededAt: null,
  }
}

describe('firmware work plan preview and creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    )
    mocks.exceptions.mockResolvedValue([])
    mocks.activeTargets.mockResolvedValue([])
    mocks.audit.mockResolvedValue({ id: 'audit' })
    mocks.createPlan.mockImplementation(async ({ data }) => ({
      id: 'plan-1',
      state: data.state,
      title: data.title,
      targets: data.targets.create,
      events: [data.events.create],
    }))
  })

  it('classifies included, excepted, already planned, no-action and review-required devices', async () => {
    const devices = ['1', '2', '3', '4', '5'].map(device)
    mocks.devices.mockResolvedValue(devices)
    mocks.exceptions.mockResolvedValue([activeException('2')])
    mocks.activeTargets.mockResolvedValue([{ deviceId: '3', planId: 'existing-plan' }])
    mocks.compliance.mockResolvedValue(
      new Map([
        ['1', actionResult()],
        ['2', actionResult()],
        ['3', actionResult()],
        ['4', complianceResult()],
        [
          '5',
          complianceResult({
            recommendation: 'REVIEW_REQUIRED',
            resolvedTarget: null,
            targetCompatibility: null,
          }),
        ],
      ]),
    )

    const preview = await previewFirmwareWorkPlan({
      deviceIds: devices.map((item) => item.id),
    })

    expect(preview.counts).toMatchObject({
      requested: 5,
      included: 1,
      activeException: 1,
      alreadyPlanned: 1,
      noAction: 1,
      reviewRequired: 1,
      exceptionOverrides: 0,
    })
    expect(
      Object.fromEntries(
        preview.targets.map((target) => [target.deviceId, target.disposition]),
      ),
    ).toEqual({
      '1': 'INCLUDED',
      '2': 'ACTIVE_EXCEPTION',
      '3': 'ALREADY_PLANNED',
      '4': 'NO_ACTION',
      '5': 'REVIEW_REQUIRED',
    })
  })

  it('only includes an excepted device when that exact device is explicitly overridden', async () => {
    mocks.devices.mockResolvedValue([device('1'), device('2')])
    mocks.exceptions.mockResolvedValue([activeException('2')])
    mocks.compliance.mockResolvedValue(
      new Map([
        ['1', actionResult()],
        ['2', actionResult()],
      ]),
    )

    const preview = await previewFirmwareWorkPlan({
      deviceIds: ['1', '2'],
      exceptionOverrideDeviceIds: ['2'],
    })

    expect(preview.counts).toMatchObject({
      included: 2,
      activeException: 0,
      exceptionOverrides: 1,
    })
    expect(preview.targets.find((target) => target.deviceId === '2')).toMatchObject({
      disposition: 'INCLUDED',
      effectiveExceptionId: 'exception-2',
      exceptionOverride: true,
    })
  })

  it('rejects an override for a device outside the selected population', () => {
    expect(() =>
      parseFirmwareWorkPlanInput({
        deviceIds: ['1'],
        exceptionOverrideDeviceIds: ['2'],
      }),
    ).toThrow('selected devices')
  })

  it('rejects creation when planning state changed since preview', async () => {
    mocks.devices.mockResolvedValue([device('1')])
    mocks.compliance.mockResolvedValue(new Map([['1', actionResult()]]))

    const preview = await previewFirmwareWorkPlan({ deviceIds: ['1'] })
    mocks.activeTargets.mockResolvedValue([
      { deviceId: '1', planId: 'created-elsewhere' },
    ])

    await expect(
      createFirmwareWorkPlan({ deviceIds: ['1'] }, preview.token, 'actor'),
    ).rejects.toMatchObject({ status: 409 })
    expect(mocks.createPlan).not.toHaveBeenCalled()
  })

  it('creates immutable per-device snapshots and an initial append-only event', async () => {
    mocks.devices.mockResolvedValue([device('1')])
    mocks.compliance.mockResolvedValue(new Map([['1', actionResult('target-1')]]))

    const raw = {
      deviceIds: ['1'],
      title: 'HQ switches',
      reason: 'Quarterly firmware maintenance',
      proposedFor: '2026-10-04T22:00:00+02:00',
      proposedMaintenanceWindowReference: 'MW-HQ-1',
    }
    const preview = await previewFirmwareWorkPlan(raw)
    const created = await createFirmwareWorkPlan(raw, preview.token, 'actor')

    expect(created).toMatchObject({ id: 'plan-1', state: 'PROPOSED' })
    const create = mocks.createPlan.mock.calls[0][0].data
    expect(create).toMatchObject({
      state: 'PROPOSED',
      title: 'HQ switches',
      reason: 'Quarterly firmware maintenance',
      proposedFor: new Date('2026-10-04T20:00:00.000Z'),
      proposedMaintenanceWindowReference: 'MW-HQ-1',
      createdByUserId: 'actor',
    })
    expect(create.targets.create).toHaveLength(1)
    expect(create.targets.create[0]).toMatchObject({
      deviceId: '1',
      deviceName: 'SW-1',
      customerName: 'Acme',
      siteName: 'HQ',
      recommendation: 'UPDATE_REQUIRED',
      observedFirmwareRawVersion: '17.12.5',
      targetFirmwareReleaseId: 'target-1',
      targetVersion: '17.15.5',
      exceptionOverride: false,
    })
    expect(create.events.create).toMatchObject({
      fromState: null,
      toState: 'PROPOSED',
      actorUserId: 'actor',
      metadata: {
        proposedFor: '2026-10-04T20:00:00.000Z',
        proposedMaintenanceWindowReference: 'MW-HQ-1',
      },
    })
    expect(mocks.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FIRMWARE_WORK_PLAN_CREATED',
        entityType: 'FirmwareWorkPlan',
        entityId: 'plan-1',
      }),
    })
  })
})

// Stateful transaction double exercises append/rollback behavior using the same
// Prisma mock infrastructure as preview/create. PostgreSQL locking is not exercised here.
describe('firmware work plan persistent transitions', () => {
  let plan: FirmwareWorkPlan
  let events: unknown[]
  let audits: unknown[]
  const targets = Object.freeze([
    {
      deviceId: 'device',
      targetFirmwareReleaseId: 'old-target',
      policyFingerprint: 'old-policy',
    },
  ])
  const at = new Date('2026-09-20T10:00:00Z')
  const scheduledFor = new Date('2026-10-01T22:00:00Z')
  const context = () => ({
    expectedState: plan.state as FirmwareWorkPlanState,
    expectedUpdatedAt: plan.updatedAt,
    actorUserId: 'engineer',
  })
  const move = (toState: Exclude<FirmwareWorkPlanState, 'SCHEDULED'>) =>
    transitionFirmwareWorkPlan(plan.id, { ...context(), toState })
  const schedule = () =>
    scheduleFirmwareWorkPlan(plan.id, {
      ...context(),
      scheduledFor,
      maintenanceWindowReference: 'HQ Sunday window',
      reason: 'Customer agreed',
      notes: 'Outage approved',
    })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(at)
    plan = {
      id: 'plan',
      state: 'PROPOSED',
      title: null,
      reason: 'Original reason',
      notes: null,
      externalReference: null,
      proposedFor: null,
      proposedMaintenanceWindowReference: null,
      scheduledFor: null,
      maintenanceWindowReference: null,
      upgradeCapability: 'UNKNOWN',
      createdByUserId: null,
      approvedByUserId: null,
      approvedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      legacyLifecycleId: null,
      legacyEvidence: null,
      createdAt: new Date('2026-09-19T00:00:00Z'),
      updatedAt: new Date('2026-09-19T00:00:00Z'),
    }
    events = [{ fromState: null, toState: 'PROPOSED' }]
    audits = []
    mocks.findPlan.mockImplementation(async () => structuredClone(plan))
    mocks.readPlan.mockImplementation(async () => structuredClone(plan))
    mocks.updatePlan.mockImplementation(async ({ where, data }) => {
      if (
        where.id !== plan.id ||
        where.state !== plan.state ||
        where.updatedAt.getTime() !== plan.updatedAt.getTime()
      )
        return { count: 0 }
      plan = { ...plan, ...data }
      return { count: 1 }
    })
    mocks.event.mockImplementation(async ({ data }) => {
      events.push(data)
      return data
    })
    mocks.audit.mockImplementation(async ({ data }) => {
      audits.push(data)
      return data
    })
    mocks.transaction.mockImplementation(async (callback) => {
      const saved = structuredClone({ plan, events, audits })
      try {
        return await callback(tx)
      } catch (error) {
        ;({ plan, events, audits } = saved)
        throw error
      }
    })
  })
  afterEach(() => vi.useRealTimers())

  it('persists approval, schedule, start and completion with immutable target evidence', async () => {
    const originalTargets = structuredClone(targets)
    await move('APPROVED')
    expect(plan).toMatchObject({
      approvedAt: at,
      approvedByUserId: 'engineer',
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
    })
    await schedule()
    expect(plan).toMatchObject({
      scheduledFor,
      scheduledAt: at,
      maintenanceWindowReference: 'HQ Sunday window',
      startedAt: null,
    })
    await move('IN_PROGRESS')
    expect(plan).toMatchObject({ startedAt: at, completedAt: null })
    await move('DONE')
    expect(plan).toMatchObject({
      state: 'DONE',
      completedAt: at,
      cancelledAt: null,
      reason: 'Original reason',
    })
    expect(events).toHaveLength(5)
    expect(events.slice(1)).toMatchObject([
      { fromState: 'PROPOSED', toState: 'APPROVED', actorUserId: 'engineer' },
      {
        fromState: 'APPROVED',
        toState: 'SCHEDULED',
        reason: 'Customer agreed',
        notes: 'Outage approved',
        metadata: {
          after: {
            scheduledFor: scheduledFor.toISOString(),
            maintenanceWindowReference: 'HQ Sunday window',
          },
        },
      },
      { fromState: 'SCHEDULED', toState: 'IN_PROGRESS' },
      { fromState: 'IN_PROGRESS', toState: 'DONE' },
    ])
    expect(audits).toHaveLength(4)
    expect(audits[3]).toMatchObject({
      action: 'FIRMWARE_WORK_PLAN_TRANSITIONED',
      entityType: 'FirmwareWorkPlan',
      entityId: 'plan',
      actorUserId: 'engineer',
      before: { state: 'IN_PROGRESS' },
      after: { state: 'DONE' },
    })
    expect(
      mocks.updatePlan.mock.calls.every(([args]) => !('targets' in args.data)),
    ).toBe(true)
    expect(mocks.activeTargets).not.toHaveBeenCalled()
    expect(mocks.compliance).not.toHaveBeenCalled()
    expect(targets).toEqual(originalTargets)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    })
  })

  it('audits proposal amendments without touching target snapshots', async () => {
    const originalTargets = structuredClone(targets)
    plan.state = 'AWAITING_CUSTOMER'
    plan.proposedFor = new Date('2026-09-27T22:00:00Z')
    plan.proposedMaintenanceWindowReference = 'MW-OLD'

    await amendFirmwareWorkPlanProposal(plan.id, {
      ...context(),
      proposedFor: scheduledFor,
      proposedMaintenanceWindowReference: 'MW-NEW',
      reason: 'Customer requested a different Sunday.',
    })

    expect(plan).toMatchObject({
      state: 'AWAITING_CUSTOMER',
      proposedFor: scheduledFor,
      proposedMaintenanceWindowReference: 'MW-NEW',
      scheduledFor: null,
    })
    expect(events[1]).toMatchObject({
      fromState: 'AWAITING_CUSTOMER',
      toState: 'AWAITING_CUSTOMER',
      reason: 'Customer requested a different Sunday.',
      metadata: {
        kind: 'PROPOSED_MAINTENANCE_WINDOW_AMENDED',
        before: {
          proposedFor: '2026-09-27T22:00:00.000Z',
          proposedMaintenanceWindowReference: 'MW-OLD',
        },
        after: {
          proposedFor: scheduledFor.toISOString(),
          proposedMaintenanceWindowReference: 'MW-NEW',
        },
      },
    })
    expect(audits[0]).toMatchObject({
      action: 'FIRMWARE_WORK_PLAN_PROPOSED_WINDOW_AMENDED',
      before: { proposedMaintenanceWindowReference: 'MW-OLD' },
      after: { proposedMaintenanceWindowReference: 'MW-NEW' },
    })
    expect(targets).toEqual(originalTargets)
  })

  it('promotes the exact customer-approved proposal directly into SCHEDULED', async () => {
    plan.state = 'AWAITING_CUSTOMER'
    plan.proposedFor = scheduledFor
    plan.proposedMaintenanceWindowReference = 'MW-PROPOSED'

    await scheduleFirmwareWorkPlan(plan.id, {
      ...context(),
      reason: 'Customer approved the proposed window.',
    })

    expect(plan).toMatchObject({
      state: 'SCHEDULED',
      proposedFor: scheduledFor,
      proposedMaintenanceWindowReference: 'MW-PROPOSED',
      scheduledFor,
      maintenanceWindowReference: 'MW-PROPOSED',
      approvedAt: at,
      approvedByUserId: 'engineer',
      scheduledAt: at,
    })
  })

  it('rejects a changed direct customer schedule until the proposal is amended', async () => {
    plan.state = 'AWAITING_CUSTOMER'
    plan.proposedFor = scheduledFor
    plan.proposedMaintenanceWindowReference = 'MW-PROPOSED'
    const before = structuredClone(plan)

    await expect(
      scheduleFirmwareWorkPlan(plan.id, {
        ...context(),
        scheduledFor: new Date('2026-10-08T22:00:00Z'),
        maintenanceWindowReference: 'MW-CHANGED',
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(plan).toEqual(before)
    expect(mocks.event).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('supports customer wait, withdrawal and approval without inventing timestamps', async () => {
    await move('AWAITING_CUSTOMER')
    expect(plan).toMatchObject({
      approvedAt: null,
      scheduledAt: null,
      startedAt: null,
    })
    await move('PROPOSED')
    await move('AWAITING_CUSTOMER')
    await move('APPROVED')
    expect(plan.approvedAt).toEqual(at)
    expect(events).toHaveLength(5)
  })

  it.each([
    'PROPOSED',
    'AWAITING_CUSTOMER',
    'APPROVED',
    'SCHEDULED',
    'IN_PROGRESS',
  ] as const)(
    'cancels from %s without inventing completion history',
    async (state) => {
      plan.state = state
      await move('CANCELLED')
      expect(plan).toMatchObject({
        state: 'CANCELLED',
        cancelledAt: at,
        completedAt: null,
        approvedAt: null,
        startedAt: null,
      })
      expect(events).toHaveLength(2)
      expect(audits).toHaveLength(1)
    },
  )

  it('clears withdrawn schedule/approval while retaining earlier event evidence', async () => {
    await move('APPROVED')
    await schedule()
    const earlier = structuredClone(events)
    vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
    await move('APPROVED')
    expect(plan).toMatchObject({
      approvedAt: new Date(),
      scheduledAt: null,
      scheduledFor: null,
      maintenanceWindowReference: null,
    })
    await move('PROPOSED')
    expect(plan).toMatchObject({
      approvedAt: null,
      approvedByUserId: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
    })
    expect(events.slice(0, 3)).toEqual(earlier)
    await move('APPROVED')
    await schedule()
    expect(plan.scheduledFor).toEqual(scheduledFor)
  })

  it.each(['PROPOSED', 'DONE', 'CANCELLED'] as const)(
    'rejects invalid/reopen transitions from %s without writes',
    async (state) => {
      plan.state = state
      const before = structuredClone(plan)
      await expect(
        move(state === 'PROPOSED' ? 'DONE' : 'PROPOSED'),
      ).rejects.toThrow('cannot transition')
      expect(plan).toEqual(before)
      expect(events).toHaveLength(1)
      expect(mocks.updatePlan).not.toHaveBeenCalled()
      expect(mocks.event).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, null, new Date('invalid')])(
    'rejects scheduling with invalid date %s',
    async (date) => {
      plan.state = 'APPROVED'
      await expect(
        transitionFirmwareWorkPlan(plan.id, {
          ...context(),
          toState: 'SCHEDULED',
          scheduledFor: date,
        } as TransitionFirmwareWorkPlanInput),
      ).rejects.toThrow('scheduledFor')
      expect(mocks.updatePlan).not.toHaveBeenCalled()
    },
  )

  it('rejects scheduling fields on another transition', async () => {
    await expect(
      transitionFirmwareWorkPlan(plan.id, {
        ...context(),
        toState: 'APPROVED',
        scheduledFor,
      } as unknown as TransitionFirmwareWorkPlanInput),
    ).rejects.toThrow('Scheduling fields')
  })

  it('rejects stale state and same-state stale version, including an approval rollback cycle', async () => {
    const stale = context()
    await move('APPROVED')
    await expect(
      transitionFirmwareWorkPlan(plan.id, { ...stale, toState: 'APPROVED' }),
    ).rejects.toMatchObject({ status: 409 })
    await move('PROPOSED')
    await expect(
      transitionFirmwareWorkPlan(plan.id, { ...stale, toState: 'APPROVED' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(events).toHaveLength(3)
  })

  it('rejects a competing write between read and compare-and-set without appending history', async () => {
    mocks.updatePlan.mockResolvedValue({ count: 0 })
    await expect(move('APPROVED')).rejects.toMatchObject({ status: 409 })
    expect(mocks.updatePlan).toHaveBeenCalledWith({
      where: { id: 'plan', state: 'PROPOSED', updatedAt: plan.updatedAt },
      data: expect.objectContaining({ state: 'APPROVED' }),
    })
    expect(mocks.event).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('accepts only one of two callers holding the same state/version', async () => {
    // Both reads resolve before either CAS; the rejected caller writes nothing.
    mocks.transaction.mockImplementation(async (callback) => callback(tx))
    const expected = context()
    const results = await Promise.allSettled([
      transitionFirmwareWorkPlan(plan.id, { ...expected, toState: 'APPROVED' }),
      transitionFirmwareWorkPlan(plan.id, { ...expected, toState: 'CANCELLED' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    })
    expect(events).toHaveLength(2)
    expect(audits).toHaveLength(1)
  })

  it.each(['event', 'audit'] as const)(
    'rolls back the entire transition when %s persistence fails',
    async (operation) => {
      const before = structuredClone(plan)
      mocks[operation].mockRejectedValue(new Error('database failure'))
      await expect(move('APPROVED')).rejects.toThrow('database failure')
      expect(plan).toEqual(before)
      expect(events).toHaveLength(1)
      expect(audits).toHaveLength(0)
    },
  )

  it('allows an omitted actor and returns 404 for missing plans', async () => {
    await transitionFirmwareWorkPlan(plan.id, {
      ...context(),
      actorUserId: undefined,
      toState: 'APPROVED',
    })
    expect(plan.approvedByUserId).toBeNull()
    expect(events[1]).toMatchObject({ actorUserId: null })
    mocks.findPlan.mockResolvedValue(null)
    await expect(move('CANCELLED')).rejects.toMatchObject({ status: 404 })
  })
})
