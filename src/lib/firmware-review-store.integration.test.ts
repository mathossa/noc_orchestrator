// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

vi.mock('./prisma', async () => {
  const connectionString = process.env.FIRMWARE_REVIEW_TEST_DATABASE_URL
  if (!connectionString)
    throw new Error(
      'FIRMWARE_REVIEW_TEST_DATABASE_URL is not set for firmware review integration tests.',
    )

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

describe('firmware review PostgreSQL snapshot persistence', () => {
  const prefix = 'review-test-' + randomUUID()
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousReviewDatabaseUrl =
    process.env.FIRMWARE_REVIEW_TEST_DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let store: typeof import('./firmware-review-store')

  const ids = {
    customer: prefix + '-customer',
    site: prefix + '-site',
    vendor: prefix + '-vendor',
    type: prefix + '-type',
    model: prefix + '-model',
    train: prefix + '-train',
    currentRelease: prefix + '-current',
    targetRelease: prefix + '-target',
    futureRelease: prefix + '-future',
    policy: prefix + '-policy',
    device: prefix + '-device',
    exceptionReason: prefix + '-exception-reason',
  }

  async function seedFixture() {
    await db.customer.create({
      data: { id: ids.customer, name: 'Snapshot Customer' },
    })
    await db.site.create({
      data: {
        id: ids.site,
        customerId: ids.customer,
        name: 'Snapshot Site',
      },
    })
    await db.vendor.create({
      data: {
        id: ids.vendor,
        code: (prefix + '-vendor-code').slice(0, 80),
        name: prefix + ' vendor',
      },
    })
    await db.deviceType.create({
      data: {
        id: ids.type,
        code: (prefix + '-switch').slice(0, 80),
        name: prefix + ' switch',
      },
    })
    await db.deviceModel.create({
      data: {
        id: ids.model,
        vendorId: ids.vendor,
        deviceTypeId: ids.type,
        model: prefix + ' model',
        platform: 'ReviewOS',
        preferredPlatform: 'ReviewOS',
      },
    })
    await db.firmwareTrain.create({
      data: {
        id: ids.train,
        vendorId: ids.vendor,
        platform: 'ReviewOS',
        name: prefix + ' train',
        state: 'PREFERRED',
      },
    })
    await db.firmwareRelease.createMany({
      data: [
        {
          id: ids.currentRelease,
          vendorId: ids.vendor,
          firmwareTrainId: ids.train,
          platform: 'ReviewOS',
          version: '1.0',
          logicalVersion: '1.0',
          catalogState: 'VERIFIED',
          policyEligibility: 'ALLOWED',
        },
        {
          id: ids.targetRelease,
          vendorId: ids.vendor,
          firmwareTrainId: ids.train,
          platform: 'ReviewOS',
          version: '2.0',
          logicalVersion: '2.0',
          catalogState: 'VERIFIED',
          policyEligibility: 'ALLOWED',
        },
        {
          id: ids.futureRelease,
          vendorId: ids.vendor,
          firmwareTrainId: ids.train,
          platform: 'ReviewOS',
          version: '3.0',
          logicalVersion: '3.0',
          catalogState: 'VERIFIED',
          policyEligibility: 'ALLOWED',
        },
      ],
    })
    await db.firmwarePolicy.create({
      data: {
        id: ids.policy,
        policyMode: 'EXACT',
        targetFirmwareReleaseId: ids.targetRelease,
        desiredPlatform: 'ReviewOS',
        trackKey: 'preferred',
        trackName: 'Preferred',
        trackClass: 'PREFERRED',
        isDefaultTrack: true,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        policyVersion: 1,
        isActive: true,
        deviceModelId: ids.model,
      },
    })
    await db.device.create({
      data: {
        id: ids.device,
        customerId: ids.customer,
        siteId: ids.site,
        deviceModelId: ids.model,
        name: 'Snapshot-SW-01',
        currentFirmwareReleaseId: ids.currentRelease,
        currentFirmwareObservedAt: new Date('2026-09-01T08:00:00.000Z'),
        currentFirmwareRawVersion: '1.0',
        currentFirmwareNormalizedVersion: '1.0',
      },
    })
  }

  async function createVersionOne() {
    const cycle = await store.createFirmwareReviewCycle({
      customerId: ids.customer,
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      nextReviewAt: '2026-12-01T00:00:00.000Z',
      reviewerName: 'Snapshot engineer',
    })
    const report = await store.generateFirmwareReviewReport(cycle.id)
    return { cycle, report }
  }

  async function storedReport(id: string) {
    return db.firmwareReviewReport.findUniqueOrThrow({ where: { id } })
  }

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    process.env.FIRMWARE_REVIEW_TEST_DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    store = await import('./firmware-review-store')
    await seedFixture()
  }, 120_000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousReviewDatabaseUrl === undefined)
        delete process.env.FIRMWARE_REVIEW_TEST_DATABASE_URL
      else
        process.env.FIRMWARE_REVIEW_TEST_DATABASE_URL =
          previousReviewDatabaseUrl
    }
  }, 120_000)

  it('keeps the historical snapshot unchanged after preferred policy changes', async () => {
    const { report } = await createVersionOne()
    const before = await storedReport(report.id)

    await db.firmwarePolicy.update({
      where: { id: ids.policy },
      data: {
        targetFirmwareReleaseId: ids.futureRelease,
        policyVersion: 2,
      },
    })

    const after = await storedReport(report.id)
    expect(after.snapshot).toEqual(before.snapshot)
    expect(after.snapshotHash).toBe(before.snapshotHash)

    const snapshot = before.snapshot as {
      sites: Array<{
        devices: Array<{
          technical: { preferredTarget: { id: string } | null }
        }>
      }>
    }
    expect(snapshot.sites[0]?.devices[0]?.technical.preferredTarget?.id).toBe(
      ids.targetRelease,
    )
  })

  it('keeps the historical snapshot unchanged after observed firmware changes', async () => {
    const { report } = await createVersionOne()
    const before = await storedReport(report.id)

    await db.device.update({
      where: { id: ids.device },
      data: {
        currentFirmwareReleaseId: ids.futureRelease,
        currentFirmwareRawVersion: '3.0',
        currentFirmwareNormalizedVersion: '3.0',
        currentFirmwareObservedAt: new Date('2026-09-23T10:00:00.000Z'),
      },
    })

    const after = await storedReport(report.id)
    expect(after.snapshot).toEqual(before.snapshot)
    expect(after.snapshotHash).toBe(before.snapshotHash)

    const snapshot = before.snapshot as {
      sites: Array<{
        devices: Array<{ currentFirmware: { version: string | null } }>
      }>
    }
    expect(snapshot.sites[0]?.devices[0]?.currentFirmware.version).toBe('1.0')
  })

  it('keeps exception, planning and Site changes out of an old version while a new version captures them', async () => {
    const { cycle, report } = await createVersionOne()
    const before = await storedReport(report.id)

    await db.firmwareExceptionReason.create({
      data: {
        code: ids.exceptionReason,
        label: 'Temporary review acceptance',
        replacementRelated: false,
      },
    })
    await db.firmwareException.create({
      data: {
        scope: 'SITE',
        scopeId: ids.site,
        scopeLabel: 'Snapshot Site',
        subject: 'ALL_MAINTENANCE',
        reasonCode: ids.exceptionReason,
        duration: 'CUSTOM_DATE',
        expiresAt: new Date('2026-11-01T00:00:00.000Z'),
        policySnapshots: {},
      },
    })

    const plan = await db.firmwareWorkPlan.create({
      data: {
        state: 'AWAITING_CUSTOMER',
        title: 'Snapshot customer proposal',
        proposedFor: new Date('2026-10-04T20:00:00.000Z'),
        proposedMaintenanceWindowReference: 'Sunday proposal',
      },
    })
    await db.firmwareWorkPlanTarget.create({
      data: {
        planId: plan.id,
        deviceId: ids.device,
        deviceName: 'Snapshot-SW-01',
        customerId: ids.customer,
        customerName: 'Snapshot Customer',
        siteId: ids.site,
        siteName: 'Snapshot Site',
        deviceModelId: ids.model,
        deviceModelName: prefix + ' model',
        recommendation: 'UPDATE_REQUIRED',
        targetFirmwareReleaseId: ids.targetRelease,
        targetVersion: '2.0',
        targetLogicalVersion: '2.0',
        targetPlatform: 'ReviewOS',
      },
    })

    await db.site.update({
      where: { id: ids.site },
      data: { name: 'Renamed Site' },
    })
    await db.customer.update({
      where: { id: ids.customer },
      data: { name: 'Renamed Customer' },
    })

    const oldAfterMutations = await storedReport(report.id)
    expect(oldAfterMutations.snapshot).toEqual(before.snapshot)
    expect(oldAfterMutations.snapshotHash).toBe(before.snapshotHash)

    const versionTwo = await store.generateFirmwareReviewReport(cycle.id)
    expect(versionTwo.version).toBe(2)

    const detail = await store.getFirmwareReviewCycle(cycle.id)
    expect(detail?.reports.map((row) => row.version)).toEqual([2, 1])

    const firstSnapshot = detail?.reports.find((row) => row.version === 1)
      ?.snapshot as {
      sites: Array<{
        siteName: string
        devices: Array<{
          exception: unknown
          planning: unknown
        }>
      }>
    }
    const secondSnapshot = detail?.reports.find((row) => row.version === 2)
      ?.snapshot as {
      sites: Array<{
        siteName: string
        devices: Array<{
          exception: { reasonCode: string } | null
          planning: { id: string; state: string } | null
        }>
      }>
    }

    expect(firstSnapshot.sites[0]?.siteName).toBe('Snapshot Site')
    expect(firstSnapshot.sites[0]?.devices[0]?.exception).toBeNull()
    expect(firstSnapshot.sites[0]?.devices[0]?.planning).toBeNull()

    expect(secondSnapshot.sites[0]?.siteName).toBe('Renamed Site')
    expect(secondSnapshot.sites[0]?.devices[0]?.exception).toMatchObject({
      reasonCode: ids.exceptionReason,
    })
    expect(secondSnapshot.sites[0]?.devices[0]?.planning).toMatchObject({
      id: plan.id,
      state: 'AWAITING_CUSTOMER',
    })
  })
})
