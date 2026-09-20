// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'
import type { FirmwareWorkPlanState } from './firmware-work-planning'

vi.mock('./prisma', async () => {
  const connectionString = process.env.PLANNING_TEST_DATABASE_URL
  if (!connectionString)
    throw new Error('PLANNING_TEST_DATABASE_URL is not set for planning integration tests.')

  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@/generated/prisma/client')
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 8,
      }),
    }),
  }
})

describe('firmware work plan PostgreSQL persistence', () => {
  const prefix = `planning-test-${randomUUID()}`
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousPlanningDatabaseUrl = process.env.PLANNING_TEST_DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let store: typeof import('./firmware-work-plan-store')
  let queryStore: typeof import('./firmware-work-plan-query-store')

  const ids = {
    actor: `${prefix}-actor`,
    customer: `${prefix}-customer`,
    site: `${prefix}-site`,
    vendor: `${prefix}-vendor`,
    type: `${prefix}-type`,
    family: `${prefix}-family`,
    model: `${prefix}-model`,
    train: `${prefix}-train`,
    currentRelease: `${prefix}-current`,
    targetRelease: `${prefix}-target`,
    futureRelease: `${prefix}-future`,
    policy: `${prefix}-policy`,
    compatibilityRule: `${prefix}-compatibility`,
    devices: Array.from({ length: 10 }, (_, index) => `${prefix}-device-${index}`),
  }

  const observedAt = new Date('2026-09-01T08:00:00.000Z')
  const scheduledFor = new Date('2026-10-04T22:00:00.000Z')

  async function seedPlanningFixture() {
    await db.user.create({
      data: {
        id: ids.actor,
        name: 'Planning integration engineer',
        email: `${prefix}@example.test`,
      },
    })
    await db.customer.create({
      data: { id: ids.customer, name: `${prefix} customer` },
    })
    await db.site.create({
      data: {
        id: ids.site,
        customerId: ids.customer,
        name: `${prefix} site`,
      },
    })
    await db.vendor.create({
      data: {
        id: ids.vendor,
        code: `${prefix}-vendor`,
        name: `${prefix} vendor`,
      },
    })
    await db.deviceType.create({
      data: {
        id: ids.type,
        code: `${prefix}-switch`,
        name: `${prefix} switch`,
      },
    })
    await db.deviceModelFamily.create({
      data: {
        id: ids.family,
        vendorId: ids.vendor,
        name: `${prefix} family`,
      },
    })
    await db.deviceModel.create({
      data: {
        id: ids.model,
        vendorId: ids.vendor,
        deviceTypeId: ids.type,
        familyId: ids.family,
        model: `${prefix}-C9300`,
        platform: 'IOS XE',
      },
    })
    await db.firmwareTrain.create({
      data: {
        id: ids.train,
        vendorId: ids.vendor,
        platform: 'IOS XE',
        name: `${prefix} 17.x`,
      },
    })
    await db.firmwareRelease.createMany({
      data: [
        {
          id: ids.currentRelease,
          vendorId: ids.vendor,
          firmwareTrainId: ids.train,
          platform: 'IOS XE',
          version: '17.12.5',
          logicalVersion: '17.12.5',
          catalogState: 'VERIFIED',
          policyEligibility: 'ALLOWED',
          variantEquivalence: 'EXACT_ONLY',
          status: 'APPROVED',
        },
        {
          id: ids.targetRelease,
          vendorId: ids.vendor,
          firmwareTrainId: ids.train,
          platform: 'IOS XE',
          version: '17.15.5',
          logicalVersion: '17.15.5',
          catalogState: 'VERIFIED',
          policyEligibility: 'ALLOWED',
          variantEquivalence: 'EXACT_ONLY',
          status: 'APPROVED',
          imageCode: 'cat9k_iosxe.17.15.05.SPA.bin',
        },
        {
          id: ids.futureRelease,
          vendorId: ids.vendor,
          firmwareTrainId: ids.train,
          platform: 'IOS XE',
          version: '17.15.6',
          logicalVersion: '17.15.6',
          catalogState: 'VERIFIED',
          policyEligibility: 'ALLOWED',
          variantEquivalence: 'EXACT_ONLY',
          status: 'APPROVED',
          imageCode: 'cat9k_iosxe.17.15.06.SPA.bin',
        },
      ],
    })
    await db.firmwareCompatibilityRule.create({
      data: {
        id: ids.compatibilityRule,
        vendorId: ids.vendor,
        deviceModelId: ids.model,
        platform: 'IOS XE',
        decision: 'ALLOW',
        sourceType: 'CATALOG',
        explanation: 'Integration fixture supports IOS XE for this model.',
      },
    })
    await db.firmwarePolicy.create({
      data: {
        id: ids.policy,
        policyMode: 'EXACT',
        targetFirmwareReleaseId: ids.targetRelease,
        desiredPlatform: 'IOS XE',
        trackKey: 'default',
        trackName: 'Preferred',
        trackClass: 'PREFERRED',
        isDefaultTrack: true,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        policyVersion: 1,
        isActive: true,
        deviceModelId: ids.model,
      },
    })
    await db.device.createMany({
      data: ids.devices.map((id, index) => ({
        id,
        customerId: ids.customer,
        siteId: ids.site,
        deviceModelId: ids.model,
        name: `${prefix}-SW-${index}`,
        currentFirmwareReleaseId: ids.currentRelease,
        currentFirmwareObservedAt: observedAt,
        currentFirmwareSource: 'MANUAL',
        currentFirmwareRawVersion: '17.12.5',
        currentFirmwareNormalizedVersion: '17.12.5',
        isActive: true,
      })),
    })
  }

  async function readPlan(planId: string) {
    return db.firmwareWorkPlan.findUniqueOrThrow({ where: { id: planId } })
  }

  async function readEvents(planId: string) {
    return db.firmwareWorkPlanEvent.findMany({
      where: { planId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  }

  async function readAudits(planId: string) {
    return db.auditEvent.findMany({
      where: {
        entityType: 'FirmwareWorkPlan',
        entityId: planId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  }

  async function capturePersistence(planId: string) {
    return {
      plan: await readPlan(planId),
      events: await readEvents(planId),
      audits: await readAudits(planId),
    }
  }

  async function createPlan(
    deviceIndex: number,
    proposal?: {
      proposedFor: string
      proposedMaintenanceWindowReference?: string
    },
  ) {
    const raw = {
      deviceIds: [ids.devices[deviceIndex]],
      title: `Plan for device ${deviceIndex}`,
      externalReference: `CHG-${deviceIndex}`,
      reason: 'Integration planning fixture',
      notes: 'Created through the real planning store.',
      upgradeCapability: 'MANUAL_REVIEW',
      ...proposal,
    }
    const preview = await store.previewFirmwareWorkPlan(raw)
    expect(preview.counts).toMatchObject({
      requested: 1,
      included: 1,
      activeException: 0,
      alreadyPlanned: 0,
      reviewRequired: 0,
    })

    const created = await store.createFirmwareWorkPlan(raw, preview.token, ids.actor)
    expect(created).toMatchObject({
      state: 'PROPOSED',
      externalReference: `CHG-${deviceIndex}`,
      createdByUserId: ids.actor,
    })
    expect(created.targets).toHaveLength(1)
    expect(created.events).toHaveLength(1)
    expect(created.events[0]).toMatchObject({
      fromState: null,
      toState: 'PROPOSED',
      actorUserId: ids.actor,
      reason: raw.reason,
      notes: raw.notes,
    })
    const audits = await readAudits(created.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorUserId: ids.actor,
      action: 'FIRMWARE_WORK_PLAN_CREATED',
      entityType: 'FirmwareWorkPlan',
      entityId: created.id,
      after: {
        state: 'PROPOSED',
        targetCount: 1,
        title: raw.title,
      },
    })
    return created
  }

  async function transitionContext(planId: string) {
    const plan = await readPlan(planId)
    return {
      expectedState: plan.state as FirmwareWorkPlanState,
      expectedUpdatedAt: plan.updatedAt,
    }
  }

  async function expectAcceptedTransition<T>(
    planId: string,
    expected: {
      fromState: FirmwareWorkPlanState
      toState: FirmwareWorkPlanState
      actorUserId: string | null
      reason?: string | null
      notes?: string | null
    },
    run: () => Promise<T>,
  ) {
    const beforeEvents = await readEvents(planId)
    const beforeAudits = await readAudits(planId)
    const value = await run()
    const afterEvents = await readEvents(planId)
    const afterAudits = await readAudits(planId)

    expect(afterEvents).toHaveLength(beforeEvents.length + 1)
    expect(afterAudits).toHaveLength(beforeAudits.length + 1)

    for (const earlier of beforeEvents)
      expect(afterEvents.find((row) => row.id === earlier.id)).toEqual(earlier)
    for (const earlier of beforeAudits)
      expect(afterAudits.find((row) => row.id === earlier.id)).toEqual(earlier)

    const knownEventIds = new Set(beforeEvents.map((row) => row.id))
    const appendedEvent = afterEvents.find((row) => !knownEventIds.has(row.id))
    expect(appendedEvent).toMatchObject({
      planId,
      fromState: expected.fromState,
      toState: expected.toState,
      actorUserId: expected.actorUserId,
      reason: expected.reason ?? null,
      notes: expected.notes ?? null,
    })

    const knownAuditIds = new Set(beforeAudits.map((row) => row.id))
    const appendedAudit = afterAudits.find((row) => !knownAuditIds.has(row.id))
    expect(appendedAudit).toMatchObject({
      actorUserId: expected.actorUserId,
      action: 'FIRMWARE_WORK_PLAN_TRANSITIONED',
      entityType: 'FirmwareWorkPlan',
      entityId: planId,
      before: { state: expected.fromState },
      after: { state: expected.toState },
      metadata: {
        reason: expected.reason ?? null,
        notes: expected.notes ?? null,
      },
    })
    expect(appendedAudit?.createdAt).toEqual(appendedEvent?.createdAt)

    return value
  }

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    await testDatabase.reset()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    process.env.PLANNING_TEST_DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    store = await import('./firmware-work-plan-store')
    queryStore = await import('./firmware-work-plan-query-store')
    await seedPlanningFixture()
  }, 120_000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousPlanningDatabaseUrl === undefined)
        delete process.env.PLANNING_TEST_DATABASE_URL
      else process.env.PLANNING_TEST_DATABASE_URL = previousPlanningDatabaseUrl
    }
  }, 120_000)

  it('persists the complete approval-to-DONE workflow with immutable snapshots and append-only audit history', async () => {
    const created = await createPlan(0)
    const targetBefore = await db.firmwareWorkPlanTarget.findFirstOrThrow({
      where: { planId: created.id },
    })

    const approvalReason = 'Engineer approved the exact target.'
    const approvalNotes = 'Approval notes retained.'
    const approvedContext = await transitionContext(created.id)
    const approved = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'PROPOSED',
        toState: 'APPROVED',
        actorUserId: ids.actor,
        reason: approvalReason,
        notes: approvalNotes,
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...approvedContext,
          toState: 'APPROVED',
          actorUserId: ids.actor,
          reason: approvalReason,
          notes: approvalNotes,
        }),
    )
    expect(approved).toMatchObject({
      state: 'APPROVED',
      approvedByUserId: ids.actor,
      scheduledAt: null,
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    })
    expect(approved.approvedAt).toBeInstanceOf(Date)

    const scheduleReason = 'Customer maintenance window confirmed.'
    const scheduleNotes = 'Use the Sunday outage window.'
    const scheduleContext = await transitionContext(created.id)
    const scheduled = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'APPROVED',
        toState: 'SCHEDULED',
        actorUserId: ids.actor,
        reason: scheduleReason,
        notes: scheduleNotes,
      },
      () =>
        store.scheduleFirmwareWorkPlan(created.id, {
          ...scheduleContext,
          actorUserId: ids.actor,
          scheduledFor,
          maintenanceWindowReference: 'MW-SUNDAY-2200',
          reason: scheduleReason,
          notes: scheduleNotes,
        }),
    )
    expect(scheduled).toMatchObject({
      state: 'SCHEDULED',
      approvedByUserId: ids.actor,
      scheduledFor,
      maintenanceWindowReference: 'MW-SUNDAY-2200',
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    })
    expect(scheduled.scheduledAt).toBeInstanceOf(Date)

    const startReason = 'Maintenance started.'
    const startNotes = 'Execution handoff recorded.'
    const startContext = await transitionContext(created.id)
    const inProgress = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'SCHEDULED',
        toState: 'IN_PROGRESS',
        actorUserId: ids.actor,
        reason: startReason,
        notes: startNotes,
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...startContext,
          toState: 'IN_PROGRESS',
          actorUserId: ids.actor,
          reason: startReason,
          notes: startNotes,
        }),
    )
    expect(inProgress).toMatchObject({
      state: 'IN_PROGRESS',
      scheduledFor,
      maintenanceWindowReference: 'MW-SUNDAY-2200',
      completedAt: null,
      cancelledAt: null,
    })
    expect(inProgress.startedAt).toBeInstanceOf(Date)

    const doneReason = 'Firmware maintenance completed.'
    const doneNotes = 'Historical evidence must remain immutable.'
    const doneContext = await transitionContext(created.id)
    const done = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'IN_PROGRESS',
        toState: 'DONE',
        actorUserId: ids.actor,
        reason: doneReason,
        notes: doneNotes,
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...doneContext,
          toState: 'DONE',
          actorUserId: ids.actor,
          reason: doneReason,
          notes: doneNotes,
        }),
    )
    expect(done).toMatchObject({
      state: 'DONE',
      approvedByUserId: ids.actor,
      scheduledFor,
      maintenanceWindowReference: 'MW-SUNDAY-2200',
      cancelledAt: null,
    })
    expect(done.completedAt).toBeInstanceOf(Date)

    const transitionEvents = (await readEvents(created.id)).filter(
      (event) => event.fromState !== null,
    )
    expect(transitionEvents).toHaveLength(4)
    const eventByState = new Map(transitionEvents.map((event) => [event.toState, event]))
    expect(eventByState.get('APPROVED')?.createdAt).toEqual(done.approvedAt)
    expect(eventByState.get('SCHEDULED')?.createdAt).toEqual(done.scheduledAt)
    expect(eventByState.get('IN_PROGRESS')?.createdAt).toEqual(done.startedAt)
    expect(eventByState.get('DONE')?.createdAt).toEqual(done.completedAt)

    const transitionAudits = (await readAudits(created.id)).filter(
      (audit) => audit.action === 'FIRMWARE_WORK_PLAN_TRANSITIONED',
    )
    expect(transitionAudits).toHaveLength(4)

    expect(
      await db.firmwareWorkPlanTarget.findFirstOrThrow({
        where: { planId: created.id },
      }),
    ).toEqual(targetBefore)

    await db.firmwarePolicy.update({
      where: { id: ids.policy },
      data: { targetFirmwareReleaseId: ids.futureRelease },
    })
    await db.firmwareRelease.update({
      where: { id: ids.targetRelease },
      data: { catalogState: 'BLOCKED' },
    })
    try {
      const targetAfterPolicyChange =
        await db.firmwareWorkPlanTarget.findFirstOrThrow({
          where: { planId: created.id },
        })
      expect(targetAfterPolicyChange).toEqual(targetBefore)

      const historical = await queryStore.getFirmwareWorkPlan(created.id)
      expect(historical).toMatchObject({
        state: 'DONE',
        active: false,
        stale: false,
      })
      expect(historical?.targets[0]?.snapshot).toEqual(targetBefore)
    } finally {
      await db.firmwarePolicy.update({
        where: { id: ids.policy },
        data: { targetFirmwareReleaseId: ids.targetRelease },
      })
      await db.firmwareRelease.update({
        where: { id: ids.targetRelease },
        data: { catalogState: 'VERIFIED' },
      })
    }

    const beforeReopen = await capturePersistence(created.id)
    await expect(
      store.transitionFirmwareWorkPlan(created.id, {
        expectedState: 'DONE',
        expectedUpdatedAt: done.updatedAt,
        toState: 'PROPOSED',
        actorUserId: ids.actor,
        reason: 'Should not reopen.',
      }),
    ).rejects.toThrow('cannot transition from DONE to PROPOSED')
    await expect(
      store.amendFirmwareWorkPlanProposal(created.id, {
        expectedState: 'DONE',
        expectedUpdatedAt: done.updatedAt,
        proposedFor: new Date('2026-11-01T22:00:00.000Z'),
        actorUserId: ids.actor,
      }),
    ).rejects.toThrow('only be amended before scheduling')
    expect(await capturePersistence(created.id)).toEqual(beforeReopen)
  })

  it('persists the AWAITING_CUSTOMER path and controlled pre-execution rollback without erasing history', async () => {
    const created = await createPlan(1)
    const originalProposed = await readPlan(created.id)

    let context = await transitionContext(created.id)
    const awaiting = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'PROPOSED',
        toState: 'AWAITING_CUSTOMER',
        actorUserId: ids.actor,
        reason: 'Awaiting customer approval.',
        notes: 'Customer contact is pending.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'AWAITING_CUSTOMER',
          actorUserId: ids.actor,
          reason: 'Awaiting customer approval.',
          notes: 'Customer contact is pending.',
        }),
    )
    expect(awaiting).toMatchObject({
      state: 'AWAITING_CUSTOMER',
      approvedAt: null,
      scheduledAt: null,
      scheduledFor: null,
      startedAt: null,
      completedAt: null,
    })

    context = await transitionContext(created.id)
    await expectAcceptedTransition(
      created.id,
      {
        fromState: 'AWAITING_CUSTOMER',
        toState: 'PROPOSED',
        actorUserId: ids.actor,
        reason: 'Proposal withdrawn for correction.',
        notes: 'Keep the prior customer-wait event.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'PROPOSED',
          actorUserId: ids.actor,
          reason: 'Proposal withdrawn for correction.',
          notes: 'Keep the prior customer-wait event.',
        }),
    )

    context = await transitionContext(created.id)
    await expectAcceptedTransition(
      created.id,
      {
        fromState: 'PROPOSED',
        toState: 'AWAITING_CUSTOMER',
        actorUserId: ids.actor,
        reason: 'Resubmitted to customer.',
        notes: 'Corrected proposal sent.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'AWAITING_CUSTOMER',
          actorUserId: ids.actor,
          reason: 'Resubmitted to customer.',
          notes: 'Corrected proposal sent.',
        }),
    )

    context = await transitionContext(created.id)
    await expectAcceptedTransition(
      created.id,
      {
        fromState: 'AWAITING_CUSTOMER',
        toState: 'APPROVED',
        actorUserId: ids.actor,
        reason: 'Customer approved.',
        notes: 'Approval captured.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'APPROVED',
          actorUserId: ids.actor,
          reason: 'Customer approved.',
          notes: 'Approval captured.',
        }),
    )

    context = await transitionContext(created.id)
    await expectAcceptedTransition(
      created.id,
      {
        fromState: 'APPROVED',
        toState: 'SCHEDULED',
        actorUserId: ids.actor,
        reason: 'Window selected.',
        notes: 'Schedule will later be withdrawn.',
      },
      () =>
        store.scheduleFirmwareWorkPlan(created.id, {
          ...context,
          actorUserId: ids.actor,
          scheduledFor,
          maintenanceWindowReference: 'MW-ROLLBACK',
          reason: 'Window selected.',
          notes: 'Schedule will later be withdrawn.',
        }),
    )

    const historyBeforeScheduleRollback = await readEvents(created.id)
    context = await transitionContext(created.id)
    const rolledBackToApproved = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'SCHEDULED',
        toState: 'APPROVED',
        actorUserId: ids.actor,
        reason: 'Maintenance window withdrawn.',
        notes: 'Return to approved but unscheduled.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'APPROVED',
          actorUserId: ids.actor,
          reason: 'Maintenance window withdrawn.',
          notes: 'Return to approved but unscheduled.',
        }),
    )
    expect(rolledBackToApproved).toMatchObject({
      state: 'APPROVED',
      approvedByUserId: ids.actor,
      scheduledAt: null,
      scheduledFor: null,
      maintenanceWindowReference: null,
      startedAt: null,
      completedAt: null,
    })
    for (const earlier of historyBeforeScheduleRollback)
      expect(
        (await readEvents(created.id)).find((event) => event.id === earlier.id),
      ).toEqual(earlier)

    context = await transitionContext(created.id)
    const rolledBackToProposed = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'APPROVED',
        toState: 'PROPOSED',
        actorUserId: ids.actor,
        reason: 'Approval withdrawn.',
        notes: 'Current approval fields must be cleared, history retained.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'PROPOSED',
          actorUserId: ids.actor,
          reason: 'Approval withdrawn.',
          notes: 'Current approval fields must be cleared, history retained.',
        }),
    )
    expect(rolledBackToProposed).toMatchObject({
      state: 'PROPOSED',
      approvedAt: null,
      approvedByUserId: null,
      scheduledAt: null,
      scheduledFor: null,
      maintenanceWindowReference: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    })

    const beforeStaleIntent = await capturePersistence(created.id)
    await expect(
      store.transitionFirmwareWorkPlan(created.id, {
        expectedState: 'PROPOSED',
        expectedUpdatedAt: originalProposed.updatedAt,
        toState: 'APPROVED',
        actorUserId: ids.actor,
        reason: 'Stale intent after ABA rollback.',
      }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await capturePersistence(created.id)).toEqual(beforeStaleIntent)
  })

  it('persists, amends, audits and promotes the proposed customer window without mutating target snapshots', async () => {
    const initialProposedFor = new Date('2026-10-11T22:00:00.000Z')
    const amendedProposedFor = new Date('2026-10-18T22:00:00.000Z')
    const created = await createPlan(7, {
      proposedFor: initialProposedFor.toISOString(),
      proposedMaintenanceWindowReference: 'MW-PROPOSED-1',
    })
    expect(created).toMatchObject({
      state: 'PROPOSED',
      proposedFor: initialProposedFor,
      proposedMaintenanceWindowReference: 'MW-PROPOSED-1',
      scheduledFor: null,
    })
    const targetBefore = await db.firmwareWorkPlanTarget.findFirstOrThrow({
      where: { planId: created.id },
    })

    let context = await transitionContext(created.id)
    const awaiting = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'PROPOSED',
        toState: 'AWAITING_CUSTOMER',
        actorUserId: ids.actor,
        reason: 'Proposal sent to customer.',
        notes: null,
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'AWAITING_CUSTOMER',
          actorUserId: ids.actor,
          reason: 'Proposal sent to customer.',
        }),
    )
    expect(awaiting).toMatchObject({
      state: 'AWAITING_CUSTOMER',
      proposedFor: initialProposedFor,
      proposedMaintenanceWindowReference: 'MW-PROPOSED-1',
      scheduledFor: null,
    })

    const eventsBeforeAmendment = await readEvents(created.id)
    const auditsBeforeAmendment = await readAudits(created.id)
    context = await transitionContext(created.id)
    const amended = await store.amendFirmwareWorkPlanProposal(created.id, {
      ...context,
      actorUserId: ids.actor,
      proposedFor: amendedProposedFor,
      proposedMaintenanceWindowReference: 'MW-PROPOSED-2',
      reason: 'Customer requested another Sunday.',
    })
    expect(amended).toMatchObject({
      state: 'AWAITING_CUSTOMER',
      proposedFor: amendedProposedFor,
      proposedMaintenanceWindowReference: 'MW-PROPOSED-2',
      scheduledFor: null,
    })

    const eventsAfterAmendment = await readEvents(created.id)
    const auditsAfterAmendment = await readAudits(created.id)
    expect(eventsAfterAmendment).toHaveLength(eventsBeforeAmendment.length + 1)
    expect(eventsAfterAmendment.at(-1)).toMatchObject({
      fromState: 'AWAITING_CUSTOMER',
      toState: 'AWAITING_CUSTOMER',
      actorUserId: ids.actor,
      reason: 'Customer requested another Sunday.',
      metadata: {
        kind: 'PROPOSED_MAINTENANCE_WINDOW_AMENDED',
        before: {
          proposedFor: initialProposedFor.toISOString(),
          proposedMaintenanceWindowReference: 'MW-PROPOSED-1',
        },
        after: {
          proposedFor: amendedProposedFor.toISOString(),
          proposedMaintenanceWindowReference: 'MW-PROPOSED-2',
        },
      },
    })
    expect(auditsAfterAmendment).toHaveLength(auditsBeforeAmendment.length + 1)
    expect(auditsAfterAmendment.at(-1)).toMatchObject({
      action: 'FIRMWARE_WORK_PLAN_PROPOSED_WINDOW_AMENDED',
      before: {
        proposedFor: initialProposedFor.toISOString(),
        proposedMaintenanceWindowReference: 'MW-PROPOSED-1',
      },
      after: {
        proposedFor: amendedProposedFor.toISOString(),
        proposedMaintenanceWindowReference: 'MW-PROPOSED-2',
      },
    })
    expect(
      await db.firmwareWorkPlanTarget.findFirstOrThrow({
        where: { planId: created.id },
      }),
    ).toEqual(targetBefore)

    context = await transitionContext(created.id)
    const scheduled = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'AWAITING_CUSTOMER',
        toState: 'SCHEDULED',
        actorUserId: ids.actor,
        reason: 'Customer approved the amended proposed window.',
        notes: null,
      },
      () =>
        store.scheduleFirmwareWorkPlan(created.id, {
          ...context,
          actorUserId: ids.actor,
          reason: 'Customer approved the amended proposed window.',
        }),
    )
    expect(scheduled).toMatchObject({
      state: 'SCHEDULED',
      proposedFor: amendedProposedFor,
      proposedMaintenanceWindowReference: 'MW-PROPOSED-2',
      scheduledFor: amendedProposedFor,
      maintenanceWindowReference: 'MW-PROPOSED-2',
      approvedByUserId: ids.actor,
    })
    expect(scheduled.approvedAt).toBeInstanceOf(Date)
    expect(scheduled.scheduledAt).toBeInstanceOf(Date)
    expect(
      await db.firmwareWorkPlanTarget.findFirstOrThrow({
        where: { planId: created.id },
      }),
    ).toEqual(targetBefore)
  })

  it('persists cancellation as terminal history and never reopens it', async () => {
    const created = await createPlan(2)
    let context = await transitionContext(created.id)
    await expectAcceptedTransition(
      created.id,
      {
        fromState: 'PROPOSED',
        toState: 'AWAITING_CUSTOMER',
        actorUserId: ids.actor,
        reason: 'Waiting before cancellation.',
        notes: null,
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'AWAITING_CUSTOMER',
          actorUserId: ids.actor,
          reason: 'Waiting before cancellation.',
        }),
    )

    context = await transitionContext(created.id)
    const cancelled = await expectAcceptedTransition(
      created.id,
      {
        fromState: 'AWAITING_CUSTOMER',
        toState: 'CANCELLED',
        actorUserId: ids.actor,
        reason: 'Customer cancelled maintenance.',
        notes: 'Cancellation is historical.',
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'CANCELLED',
          actorUserId: ids.actor,
          reason: 'Customer cancelled maintenance.',
          notes: 'Cancellation is historical.',
        }),
    )
    expect(cancelled).toMatchObject({
      state: 'CANCELLED',
      approvedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
    })
    expect(cancelled.cancelledAt).toBeInstanceOf(Date)

    const beforeReopen = await capturePersistence(created.id)
    await expect(
      store.transitionFirmwareWorkPlan(created.id, {
        expectedState: 'CANCELLED',
        expectedUpdatedAt: cancelled.updatedAt,
        toState: 'PROPOSED',
        actorUserId: ids.actor,
      }),
    ).rejects.toThrow('cannot transition from CANCELLED to PROPOSED')
    await expect(
      store.amendFirmwareWorkPlanProposal(created.id, {
        expectedState: 'CANCELLED',
        expectedUpdatedAt: cancelled.updatedAt,
        proposedFor: new Date('2026-11-01T22:00:00.000Z'),
        actorUserId: ids.actor,
      }),
    ).rejects.toThrow('only be amended before scheduling')
    expect(await capturePersistence(created.id)).toEqual(beforeReopen)
  })

  it('rejects invalid transitions without changing state, timestamps, events, or audits', async () => {
    const created = await createPlan(3)
    const before = await capturePersistence(created.id)

    await expect(
      store.transitionFirmwareWorkPlan(created.id, {
        expectedState: 'PROPOSED',
        expectedUpdatedAt: before.plan.updatedAt,
        toState: 'DONE',
        actorUserId: ids.actor,
        reason: 'Invalid shortcut.',
      }),
    ).rejects.toThrow('cannot transition from PROPOSED to DONE')

    expect(await capturePersistence(created.id)).toEqual(before)
  })

  it('rejects invalid scheduling data before any PostgreSQL writes', async () => {
    const created = await createPlan(4)
    let context = await transitionContext(created.id)
    await expectAcceptedTransition(
      created.id,
      {
        fromState: 'PROPOSED',
        toState: 'APPROVED',
        actorUserId: ids.actor,
        reason: 'Ready to schedule.',
        notes: null,
      },
      () =>
        store.transitionFirmwareWorkPlan(created.id, {
          ...context,
          toState: 'APPROVED',
          actorUserId: ids.actor,
          reason: 'Ready to schedule.',
        }),
    )

    const before = await capturePersistence(created.id)
    context = await transitionContext(created.id)
    await expect(
      store.scheduleFirmwareWorkPlan(created.id, {
        ...context,
        actorUserId: ids.actor,
      }),
    ).rejects.toThrow('stored proposedFor')
    expect(await capturePersistence(created.id)).toEqual(before)

    context = await transitionContext(created.id)
    await expect(
      store.transitionFirmwareWorkPlan(created.id, {
        ...context,
        toState: 'SCHEDULED',
        actorUserId: ids.actor,
        scheduledFor: new Date('invalid'),
        maintenanceWindowReference: 'MW-INVALID',
      }),
    ).rejects.toThrow('scheduledFor')

    expect(await capturePersistence(created.id)).toEqual(before)
  })

  it('rolls back the plan update and already-inserted event when the real audit foreign key rejects the transition', async () => {
    const created = await createPlan(5)
    const missingActor = `${prefix}-missing-audit-actor`
    expect(await db.user.findUnique({ where: { id: missingActor } })).toBeNull()

    const before = await capturePersistence(created.id)
    await expect(
      store.transitionFirmwareWorkPlan(created.id, {
        expectedState: 'PROPOSED',
        expectedUpdatedAt: before.plan.updatedAt,
        toState: 'APPROVED',
        actorUserId: missingActor,
        reason: 'Force the AuditEvent actor foreign-key constraint.',
        notes: 'The plan update and event insert must roll back.',
      }),
    ).rejects.toThrow()

    expect(await capturePersistence(created.id)).toEqual(before)
  })

  it('rolls back every selected plan when a real PostgreSQL bulk transition contains one stale item', async () => {
    const first = await createPlan(8)
    const second = await createPlan(9)
    const firstBefore = await capturePersistence(first.id)
    const secondBefore = await capturePersistence(second.id)

    await expect(
      store.bulkTransitionFirmwareWorkPlans({
        items: [
          {
            id: first.id,
            expectedState: 'PROPOSED',
            expectedUpdatedAt: firstBefore.plan.updatedAt,
          },
          {
            id: second.id,
            expectedState: 'PROPOSED',
            expectedUpdatedAt: new Date(
              secondBefore.plan.updatedAt.getTime() - 1,
            ),
          },
        ],
        toState: 'APPROVED',
        actorUserId: ids.actor,
        reason: 'Bulk approval must be all-or-nothing.',
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(await capturePersistence(first.id)).toEqual(firstBefore)
    expect(await capturePersistence(second.id)).toEqual(secondBefore)

    const approved = await store.bulkTransitionFirmwareWorkPlans({
      items: [
        {
          id: first.id,
          expectedState: 'PROPOSED',
          expectedUpdatedAt: firstBefore.plan.updatedAt,
        },
        {
          id: second.id,
          expectedState: 'PROPOSED',
          expectedUpdatedAt: secondBefore.plan.updatedAt,
        },
      ],
      toState: 'APPROVED',
      actorUserId: ids.actor,
      reason: 'Bulk approval after refreshing both plans.',
    })

    expect(approved.map((plan) => plan.state)).toEqual([
      'APPROVED',
      'APPROVED',
    ])
    for (const planId of [first.id, second.id]) {
      expect(await readPlan(planId)).toMatchObject({
        state: 'APPROVED',
        approvedByUserId: ids.actor,
      })
      expect(await readEvents(planId)).toHaveLength(2)
      expect(await readAudits(planId)).toHaveLength(2)
    }
  })

  it('allows exactly one real concurrent compare-and-set transition and rejects the competing stale intent', async () => {
    const created = await createPlan(6)
    const initial = await readPlan(created.id)
    const shared = {
      expectedState: 'PROPOSED' as const,
      expectedUpdatedAt: initial.updatedAt,
      actorUserId: ids.actor,
    }

    const results = await Promise.allSettled([
      store.transitionFirmwareWorkPlan(created.id, {
        ...shared,
        toState: 'APPROVED',
        reason: 'Concurrent approval.',
        notes: 'Only one writer may win.',
      }),
      store.transitionFirmwareWorkPlan(created.id, {
        ...shared,
        toState: 'CANCELLED',
        reason: 'Concurrent cancellation.',
        notes: 'Only one writer may win.',
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const winner = fulfilled[0]
    const loser = rejected[0]
    if (!winner || winner.status !== 'fulfilled')
      throw new Error('Expected exactly one fulfilled planning transition.')
    if (!loser || loser.status !== 'rejected')
      throw new Error('Expected exactly one rejected planning transition.')

    expect(loser.reason).toMatchObject({ status: 409 })

    const finalPlan = await readPlan(created.id)
    expect(finalPlan.state).toBe(winner.value.state)

    const events = await readEvents(created.id)
    const transitionEvents = events.filter((event) => event.fromState !== null)
    expect(events).toHaveLength(2)
    expect(transitionEvents).toHaveLength(1)
    expect(transitionEvents[0]).toMatchObject({
      fromState: 'PROPOSED',
      toState: finalPlan.state,
      actorUserId: ids.actor,
    })

    const audits = await readAudits(created.id)
    const transitionAudits = audits.filter(
      (audit) => audit.action === 'FIRMWARE_WORK_PLAN_TRANSITIONED',
    )
    expect(audits).toHaveLength(2)
    expect(transitionAudits).toHaveLength(1)
    expect(transitionAudits[0]).toMatchObject({
      actorUserId: ids.actor,
      before: { state: 'PROPOSED' },
      after: { state: finalPlan.state },
    })
  })
})
