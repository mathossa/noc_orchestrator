import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FirmwareWorkPlan,
  FirmwareWorkPlanTarget,
} from '@/generated/prisma/client'
import { policyFingerprint } from './firmware-exceptions'
import { release, result } from './test-fixtures/firmware-compliance'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  devices: vi.fn(),
  compliance: vi.fn(),
  releases: vi.fn(),
  rules: vi.fn(),
  overrides: vi.fn(),
  exceptions: vi.fn(),
  plans: vi.fn(),
  plan: vi.fn(),
  count: vi.fn(),
  events: vi.fn(),
  targets: vi.fn(),
  models: vi.fn(),
}))
const db = vi.hoisted(() => ({
  device: { findMany: mocks.devices },
  firmwareRelease: { findMany: mocks.releases },
  firmwareCompatibilityRule: { findMany: mocks.rules },
  firmwareCompatibilityOverride: { findMany: mocks.overrides },
  firmwareException: { findMany: mocks.exceptions },
  firmwareWorkPlan: {
    findMany: mocks.plans,
    findUnique: mocks.plan,
    count: mocks.count,
  },
  firmwareWorkPlanEvent: { findMany: mocks.events },
  firmwareWorkPlanTarget: { findMany: mocks.targets },
  deviceModel: { findMany: mocks.models },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { ...db, $transaction: mocks.transaction },
}))
vi.mock('@/lib/firmware-compliance-store', () => ({
  resolveFirmwareComplianceBatch: mocks.compliance,
}))
import { resolveFirmwareWorkPlanLiveTargets } from './firmware-work-plan-live'
import {
  getFirmwareWorkPlan,
  listFirmwareWorkPlanHistory,
  listFirmwareWorkPlans,
  resolveDeviceWorkPlanning,
} from './firmware-work-plan-query-store'

const at = new Date('2026-09-20T12:00:00Z')
const observedAt = new Date('2026-09-01T12:00:00Z')
function device() {
  return {
    id: 'device',
    customerId: 'customer',
    siteId: 'site',
    deviceModelId: 'model',
    currentFirmwareReleaseId: '17.12.5',
    currentFirmwareNormalizedVersion: '17.12.5',
    currentFirmwareRawVersion: '17.12.5',
    currentFirmwareObservedAt: observedAt,
    deviceModel: {
      id: 'model',
      vendorId: 'synthetic-vendor',
      familyId: 'family',
    },
  }
}
function technical() {
  return result({
    currentFirmware: release('17.12.5'),
    recommendation: 'UPDATE_RECOMMENDED',
  })
}
function snapshot(
  overrides: Partial<FirmwareWorkPlanTarget> = {},
): FirmwareWorkPlanTarget {
  return {
    id: 'target',
    planId: 'plan',
    deviceId: 'device',
    deviceName: 'Saved device',
    customerId: 'customer',
    customerName: 'Saved customer',
    siteId: 'site',
    siteName: 'Saved site',
    deviceModelId: 'model',
    deviceModelName: 'Saved model',
    logicalGroupKey: 'stack',
    observedFirmwareReleaseId: '17.12.5',
    observedFirmwareVersion: '17.12.5',
    observedFirmwareRawVersion: '17.12.5',
    observedFirmwareFingerprint: JSON.stringify([
      '17.12.5',
      '17.12.5',
      '17.12.5',
      '17.12.5',
      observedAt.toISOString(),
    ]),
    observedAt,
    policyId: 'policy',
    policyScope: 'MODEL',
    policyTrackKey: 'default',
    policyTrackName: 'Preferred',
    policyVersion: 1,
    policyFingerprint: policyFingerprint(technical()),
    recommendation: 'UPDATE_RECOMMENDED',
    preferredTargetFirmwareReleaseId: '17.15.5',
    preferredTargetVersion: '17.15.5',
    targetFirmwareReleaseId: '17.15.5',
    targetVersion: '17.15.5',
    targetLogicalVersion: '17.15.5',
    targetPlatform: 'IOS XE',
    targetVariant: 'saved variant',
    targetImageCode: 'saved image',
    compatibilityStatus: 'RESOLVED',
    exceptionOverride: false,
    exceptionSnapshot: null,
    memberSnapshot: { members: ['member-1'] },
    upgradeCapability: 'MANUAL_REVIEW',
    createdAt: observedAt,
    ...overrides,
  }
}
function plan(
  state = 'SCHEDULED',
  targets = [snapshot()],
): FirmwareWorkPlan & { targets: FirmwareWorkPlanTarget[] } {
  return {
    id: 'plan',
    state,
    title: 'Saved plan',
    reason: 'Upgrade',
    notes: 'Preserve me',
    externalReference: 'ticket-1',
    proposedFor: new Date('2026-09-25T22:00:00Z'),
    proposedMaintenanceWindowReference: 'MW-PROPOSED',
    scheduledFor: at,
    maintenanceWindowReference: 'MW-1',
    upgradeCapability: 'MANUAL_REVIEW',
    createdByUserId: 'actor',
    approvedByUserId: 'approver',
    approvedAt: observedAt,
    scheduledAt: observedAt,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    legacyLifecycleId: null,
    legacyEvidence: null,
    createdAt: observedAt,
    updatedAt: observedAt,
    targets,
  }
}
function exception(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exception',
    scope: 'DEVICE',
    scopeId: 'device',
    scopeLabel: 'Device',
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
    actorUserId: 'actor',
    contactReference: null,
    ticketReference: null,
    decidedAt: observedAt,
    supersededAt: null,
    ...overrides,
  }
}
async function live(
  target = snapshot(),
  state: 'SCHEDULED' | 'DONE' | 'CANCELLED' = 'SCHEDULED',
) {
  return (
    await resolveFirmwareWorkPlanLiveTargets([{ state, snapshot: target }], at)
  ).get(target.id)!
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((fn) => fn(db))
  mocks.devices.mockResolvedValue([device()])
  mocks.compliance.mockResolvedValue(new Map([['device', technical()]]))
  mocks.releases.mockResolvedValue([release()])
  mocks.rules.mockResolvedValue([
    {
      id: 'rule',
      vendorId: 'synthetic-vendor',
      deviceModelId: 'model',
      deviceModelFamilyId: null,
      platform: 'IOS XE',
      firmwareTrainId: null,
      logicalVersion: null,
      firmwareReleaseId: '17.15.5',
      imageCode: null,
      decision: 'ALLOW',
      sourceType: 'CATALOG',
      explanation: 'Supported',
      isActive: true,
      validFrom: null,
      validUntil: null,
    },
  ])
  mocks.overrides.mockResolvedValue([])
  mocks.exceptions.mockResolvedValue([])
  mocks.plans.mockResolvedValue([plan()])
  mocks.plan.mockResolvedValue({ ...plan(), events: [] })
  mocks.count.mockResolvedValue(1)
  mocks.events.mockResolvedValue([])
  mocks.targets.mockResolvedValue([])
  mocks.models.mockResolvedValue([{ id: 'model' }])
})

describe('live work-plan resolution from batched repository context', () => {
  it('leaves an unchanged active target non-stale without changing the snapshot', async () => {
    const target = snapshot()
    const before = structuredClone(target)
    expect((await live(target)).staleness).toEqual({
      stale: false,
      reasons: [],
    })
    expect(target).toEqual(before)
  })
  it('detects a new policy version', async () => {
    const changed = technical()
    changed.effectivePolicy.policy = {
      ...changed.effectivePolicy.policy!,
      policyVersion: 2,
    }
    mocks.compliance.mockResolvedValue(new Map([['device', changed]]))
    expect((await live()).staleness.reasons).toEqual(['POLICY_CHANGED'])
  })
  it('detects preferred-target drift while testing the saved exact release compatibility', async () => {
    mocks.compliance.mockResolvedValue(
      new Map([
        [
          'device',
          result({
            ...technical(),
            preferredTarget: release('17.15.6'),
            resolvedTarget: release('17.15.6'),
            targetCompatibility: null,
          }),
        ],
      ]),
    )
    const current = await live()
    expect(current.staleness.reasons).toEqual([
      'POLICY_CHANGED',
      'PREFERRED_TARGET_CHANGED',
    ])
    expect(current.current?.targetFirmwareReleaseId).toBe('17.15.5')
    expect(current.current?.targetCompatibilityResolved).toBe(true)
    expect(mocks.releases).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['17.15.5'] } } }),
    )
  })
  it.each(['BLOCKED', 'WITHDRAWN'])(
    'detects a %s catalog target',
    async (catalogState) => {
      mocks.releases.mockResolvedValue([release('17.15.5', { catalogState })])
      expect((await live()).staleness.reasons).toEqual([
        'TARGET_BLOCKED_OR_WITHDRAWN',
      ])
    },
  )
  it("detects missing exact targets without substituting today's preferred image", async () => {
    mocks.releases.mockResolvedValue([])
    expect((await live()).staleness.reasons).toEqual([
      'TARGET_UNRESOLVED',
      'COMPATIBILITY_CHANGED',
    ])
  })
  it('treats an archived release as unresolved', async () => {
    mocks.releases.mockResolvedValue([release('17.15.5', { isActive: false })])
    expect((await live()).staleness.reasons).toContain('TARGET_UNRESOLVED')
  })
  it('detects a changed device model', async () => {
    mocks.devices.mockResolvedValue([
      {
        ...device(),
        deviceModelId: 'other',
        deviceModel: { ...device().deviceModel, id: 'other' },
      },
    ])
    expect((await live()).staleness.reasons).toEqual([
      'DEVICE_MODEL_CHANGED',
      'COMPATIBILITY_CHANGED',
    ])
  })
  it('marks a deleted device reviewable without throwing or overwriting evidence', async () => {
    mocks.devices.mockResolvedValue([])
    mocks.compliance.mockResolvedValue(new Map())
    const value = await live()
    expect(value.current?.deviceMissing).toBe(true)
    expect(value.staleness.reasons).toContain('DEVICE_MODEL_CHANGED')
  })
  it('detects changed observed firmware evidence', async () => {
    mocks.devices.mockResolvedValue([
      { ...device(), currentFirmwareRawVersion: '17.15.1' },
    ])
    expect((await live()).staleness.reasons).toEqual([
      'OBSERVED_FIRMWARE_CHANGED',
    ])
  })
  it('detects lost compatibility evidence', async () => {
    mocks.rules.mockResolvedValue([])
    expect((await live()).staleness.reasons).toEqual(['COMPATIBILITY_CHANGED'])
  })
  it('honors a manual DENY over an ALLOW rule', async () => {
    mocks.overrides.mockResolvedValue([
      {
        id: 'override',
        deviceModelId: 'model',
        firmwareReleaseId: '17.15.5',
        decision: 'DENY',
        reason: 'Not supported',
        version: 1,
        isActive: true,
        createdAt: observedAt,
      },
    ])
    expect((await live()).staleness.reasons).toEqual(['COMPATIBILITY_CHANGED'])
  })
  it('detects a newly active accepted exception', async () => {
    mocks.exceptions.mockResolvedValue([exception()])
    expect((await live()).staleness.reasons).toEqual(['ACTIVE_EXCEPTION_ADDED'])
  })
  it.each([
    { expiresAt: observedAt },
    { supersededAt: observedAt },
    { decidedAt: new Date('2027-01-01') },
    { subject: 'RELEASE', releaseId: 'another-release' },
    { duration: 'POLICY_CHANGE', policySnapshots: { device: 'old-policy' } },
    { scope: 'DEVICE', scopeId: 'another-device' },
  ])(
    'reuses #59 expiry, scope, subject and policy-change rules (%j)',
    async (change) => {
      mocks.exceptions.mockResolvedValue([exception(change)])
      expect((await live()).activeException).toBeNull()
      expect((await live()).staleness.stale).toBe(false)
    },
  )
  it('reuses #59 precedence and does not select exceptions for NO_ACTION', async () => {
    mocks.exceptions.mockResolvedValue([
      exception({
        id: 'customer-exception',
        scope: 'CUSTOMER',
        scopeId: 'customer',
      }),
      exception(),
    ])
    expect((await live()).activeException?.id).toBe('exception')
    mocks.compliance.mockResolvedValue(
      new Map([['device', { ...technical(), recommendation: 'NO_ACTION' }]]),
    )
    expect((await live()).activeException).toBeNull()
  })
  it('acknowledges only the exact overridden exception and preserves historical evidence', async () => {
    const target = snapshot({
      exceptionOverride: true,
      exceptionSnapshot: { id: 'exception', reasonCode: 'CUSTOMER_DECLINED' },
    })
    mocks.exceptions.mockResolvedValue([exception()])
    expect(await live(target)).toMatchObject({
      activeExceptionOverridden: true,
      staleness: { stale: false },
    })
    mocks.exceptions.mockResolvedValue([exception({ id: 'new-exception' })])
    expect((await live(target)).staleness.reasons).toEqual([
      'ACTIVE_EXCEPTION_ADDED',
    ])
    expect(target.exceptionSnapshot).toEqual({
      id: 'exception',
      reasonCode: 'CUSTOMER_DECLINED',
    })
    mocks.exceptions.mockResolvedValue([])
    expect((await live(target)).staleness.stale).toBe(false)
    expect(target.exceptionOverride).toBe(true)
  })
  it('collects multiple independent stale reasons', async () => {
    mocks.releases.mockResolvedValue([
      release('17.15.5', { catalogState: 'BLOCKED' }),
    ])
    mocks.rules.mockResolvedValue([])
    mocks.exceptions.mockResolvedValue([exception()])
    mocks.devices.mockResolvedValue([
      { ...device(), currentFirmwareRawVersion: '17.15.1' },
    ])
    expect((await live()).staleness.reasons).toEqual([
      'TARGET_BLOCKED_OR_WITHDRAWN',
      'OBSERVED_FIRMWARE_CHANGED',
      'COMPATIBILITY_CHANGED',
      'ACTIVE_EXCEPTION_ADDED',
    ])
  })
  it.each(['DONE', 'CANCELLED'] as const)(
    '%s history does not load or reinterpret live state',
    async (state) => {
      mocks.devices.mockRejectedValue(
        new Error('Historical reads must not touch inventory'),
      )
      expect(await live(snapshot(), state)).toEqual({
        current: null,
        activeException: null,
        activeExceptionOverridden: false,
        staleness: { stale: false, reasons: [] },
      })
      for (const name of [
        'devices',
        'compliance',
        'releases',
        'rules',
        'overrides',
        'exceptions',
      ] as const)
        expect(mocks[name]).not.toHaveBeenCalled()
    },
  )
  it('batches populations once, independent of plan and target count', async () => {
    const targets = Array.from({ length: 30 }, (_, i) => ({
      state: 'SCHEDULED' as const,
      snapshot: snapshot({ id: `target-${i}`, planId: `plan-${i}` }),
    }))
    expect((await resolveFirmwareWorkPlanLiveTargets(targets, at)).size).toBe(
      30,
    )
    for (const name of [
      'devices',
      'compliance',
      'releases',
      'rules',
      'overrides',
      'exceptions',
    ] as const)
      expect(mocks[name]).toHaveBeenCalledTimes(1)
    expect(mocks.compliance).toHaveBeenCalledWith(
      ['device'],
      at,
      expect.anything(),
    )
  })
})

describe('planning list/detail/history and device projections', () => {
  it('preserves every snapshot field and transition event in list/detail/history', async () => {
    const saved = snapshot({
      exceptionOverride: true,
      exceptionSnapshot: { id: 'expired', reasonCode: 'CUSTOMER_DECLINED' },
    })
    const before = structuredClone(saved)
    const events = [
      {
        id: 'event',
        planId: 'plan',
        targetId: 'target',
        fromState: 'APPROVED',
        toState: 'SCHEDULED',
        actorUserId: 'actor',
        reason: 'Agreed',
        notes: 'Keep',
        metadata: { scheduledFor: at.toISOString(), previousTarget: '17.15.4' },
        createdAt: observedAt,
      },
    ]
    mocks.plans.mockResolvedValue([plan('SCHEDULED', [saved])])
    mocks.plan.mockResolvedValue({ ...plan('SCHEDULED', [saved]), events })
    mocks.events.mockResolvedValue(events)
    const list = await listFirmwareWorkPlans()
    const detail = await getFirmwareWorkPlan('plan')
    expect(list.data[0].targets[0].snapshot).toEqual(before)
    expect(detail?.targets[0].snapshot).toEqual(before)
    expect(detail?.events).toEqual(events)
    expect(await listFirmwareWorkPlanHistory('plan')).toEqual(events)
    expect(list.data[0]).toMatchObject({
      state: 'SCHEDULED',
      scheduledFor: at,
      targetCount: 1,
      stale: false,
      customers: [{ id: 'customer', name: 'Saved customer', targetCount: 1 }],
      sites: [
        {
          id: 'site',
          name: 'Saved site',
          customerId: 'customer',
          targetCount: 1,
        },
      ],
      targetDistribution: [
        {
          firmwareReleaseId: '17.15.5',
          imageCode: 'saved image',
          variant: 'saved variant',
          count: 1,
        },
      ],
      exceptionOverrides: [
        { targetId: 'target', exceptionSnapshot: saved.exceptionSnapshot },
      ],
    })
    expect(saved).toEqual(before)
    expect(mocks.events).toHaveBeenCalledWith({
      where: { planId: 'plan' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  })
  it('returns stable pagination/filter queries and aggregates per-target stale reasons', async () => {
    mocks.plans.mockResolvedValue([
      plan('SCHEDULED', [
        snapshot(),
        snapshot({
          id: 'target-2',
          deviceId: 'device-2',
          customerId: 'other-customer',
          customerName: 'Other',
        }),
      ]),
    ])
    mocks.devices.mockResolvedValue([device(), { ...device(), id: 'device-2' }])
    mocks.compliance.mockResolvedValue(
      new Map([
        ['device', technical()],
        ['device-2', technical()],
      ]),
    )
    mocks.releases.mockResolvedValue([
      release('17.15.5', { catalogState: 'BLOCKED' }),
    ])
    const value = await listFirmwareWorkPlans({
      customerId: 'customer',
      vendorId: 'synthetic-vendor',
      deviceModelFamilyId: 'family',
      deviceModelId: 'model',
      recommendation: 'UPDATE_RECOMMENDED',
      scheduledFrom: new Date('2026-09-20T00:00:00Z'),
      scheduledUntil: new Date('2026-09-21T00:00:00Z'),
      states: ['SCHEDULED'],
      page: 2,
      pageSize: 10,
    })
    expect(value.data[0]).toMatchObject({
      targetCount: 2,
      stale: true,
      staleReasonCounts: { TARGET_BLOCKED_OR_WITHDRAWN: 2 },
    })
    expect(value.data[0].targetDistribution[0].count).toBe(2)
    expect(mocks.models).toHaveBeenCalledWith({
      where: {
        id: 'model',
        vendorId: 'synthetic-vendor',
        familyId: 'family',
      },
      select: { id: true },
    })
    expect(mocks.plans).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          state: { in: ['SCHEDULED'] },
          targets: {
            some: {
              customerId: 'customer',
              recommendation: 'UPDATE_RECOMMENDED',
              deviceModelId: { in: ['model'] },
            },
          },
          scheduledFor: {
            gte: new Date('2026-09-20T00:00:00Z'),
            lt: new Date('2026-09-21T00:00:00Z'),
          },
        },
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    )
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      timeout: 30_000,
    })
  })
  it('keeps an unmatched vendor or family filter restrictive', async () => {
    mocks.models.mockResolvedValue([])
    mocks.plans.mockResolvedValue([])
    mocks.count.mockResolvedValue(0)

    const value = await listFirmwareWorkPlans({
      vendorId: 'vendor-with-no-models',
      deviceModelFamilyId: 'family-with-no-models',
    })

    expect(value.data).toEqual([])
    expect(mocks.plans).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          targets: {
            some: {
              deviceModelId: { in: [] },
            },
          },
        },
      }),
    )
  })

  it('preserves historical targets and recommendation with no live lookup in detail', async () => {
    const saved = snapshot({
      recommendation: 'UNKNOWN_LEGACY',
      exceptionOverride: true,
      exceptionSnapshot: { id: 'old' },
    })
    mocks.plan.mockResolvedValue({ ...plan('DONE', [saved]), events: [] })
    const detail = await getFirmwareWorkPlan('plan')
    expect(detail?.targets[0].snapshot).toEqual(saved)
    expect(detail).toMatchObject({
      stale: false,
      active: false,
      staleReasonCounts: {},
    })
    expect(mocks.compliance).not.toHaveBeenCalled()
  })
  it('returns null for missing detail and handles empty lists without live reads', async () => {
    mocks.plan.mockResolvedValue(null)
    mocks.plans.mockResolvedValue([])
    mocks.count.mockResolvedValue(0)
    expect(await getFirmwareWorkPlan('missing')).toBeNull()
    expect((await listFirmwareWorkPlans()).data).toEqual([])
    expect(mocks.compliance).not.toHaveBeenCalled()
  })
  it('keeps multiple completed plans separate from the new active plan', async () => {
    const reference = (id: string, state: string) => ({
      id: `target-${id}`,
      deviceId: 'device',
      plan: {
        id,
        state,
        scheduledFor: at,
        completedAt: state === 'DONE' ? observedAt : null,
        cancelledAt: null,
      },
    })
    mocks.targets.mockResolvedValue([
      reference('done-1', 'DONE'),
      reference('active', 'PROPOSED'),
      reference('done-2', 'DONE'),
      reference('cancelled', 'CANCELLED'),
    ])
    const value = (
      await resolveDeviceWorkPlanning(['device', 'unplanned'])
    ).get('device')!
    expect(value.state).toBe('PROPOSED')
    expect(value.activePlans.map((p) => p.id)).toEqual(['active'])
    expect(value.history.map((p) => p.id)).toEqual([
      'done-1',
      'done-2',
      'cancelled',
    ])
  })
  it('derives NOT_PLANNED for completed-only history and absent work, never persisting it', async () => {
    mocks.targets.mockResolvedValue([
      {
        id: 'target',
        deviceId: 'device',
        plan: {
          id: 'done',
          state: 'DONE',
          scheduledFor: null,
          completedAt: at,
          cancelledAt: null,
        },
      },
    ])
    const value = await resolveDeviceWorkPlanning(['device', 'unplanned'])
    expect(value.get('device')).toMatchObject({
      planned: false,
      state: 'NOT_PLANNED',
      activePlans: [],
      history: [{ id: 'done' }],
    })
    expect(value.get('unplanned')).toEqual({
      deviceId: 'unplanned',
      planned: false,
      state: 'NOT_PLANNED',
      activePlans: [],
      history: [],
    })
    expect(await resolveDeviceWorkPlanning([])).toEqual(new Map())
    expect(mocks.targets).toHaveBeenCalledTimes(1)
  })
})
