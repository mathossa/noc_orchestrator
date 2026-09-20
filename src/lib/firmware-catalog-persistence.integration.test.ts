import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

describe('Firmware catalog PostgreSQL integrity', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    db = (await import('./prisma')).prisma
  }, 120000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }
  }, 120000)

  it('constrains train defaults while preserving archived historical references', async () => {
    const vendor = await db.vendor.create({
      data: { code: 'FW106-INTEGRITY', name: 'Firmware 106 Integrity Vendor' },
    })
    const deviceType = await db.deviceType.create({
      data: { code: 'FW106-INTEGRITY-SW', name: 'Firmware 106 Integrity Switch' },
    })
    const model = await db.deviceModel.create({
      data: {
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        model: 'Firmware 106 Integrity Model',
        platform: 'IOS XE',
      },
    })
    const customer = await db.customer.create({
      data: { code: 'FW106-INTEGRITY-CUSTOMER', name: 'Firmware 106 Integrity Customer' },
    })

    const preferredTrain = await db.firmwareTrain.create({
      data: {
        vendorId: vendor.id,
        platform: 'IOS XE',
        name: '17.15',
        state: 'PREFERRED',
      },
    })
    const acceptedTrain = await db.firmwareTrain.create({
      data: {
        vendorId: vendor.id,
        platform: 'IOS XE',
        name: '17.12',
        state: 'ACCEPTED',
      },
    })
    const minimum = await db.firmwareRelease.create({
      data: {
        vendorId: vendor.id,
        firmwareTrainId: preferredTrain.id,
        platform: 'IOS XE',
        version: '17.15.4',
        logicalVersion: '17.15.4',
        catalogState: 'VERIFIED',
        policyEligibility: 'ALLOWED',
        status: 'APPROVED',
      },
    })
    const preferred = await db.firmwareRelease.create({
      data: {
        vendorId: vendor.id,
        firmwareTrainId: preferredTrain.id,
        platform: 'IOS XE',
        version: '17.15.5',
        logicalVersion: '17.15.5',
        catalogState: 'VERIFIED',
        policyEligibility: 'ALLOWED',
        status: 'APPROVED',
      },
    })
    const wrongTrainRelease = await db.firmwareRelease.create({
      data: {
        vendorId: vendor.id,
        firmwareTrainId: acceptedTrain.id,
        platform: 'IOS XE',
        version: '17.12.5',
        logicalVersion: '17.12.5',
        catalogState: 'VERIFIED',
        policyEligibility: 'ALLOWED',
        status: 'APPROVED',
      },
    })

    await db.firmwareTrain.update({
      where: { id: preferredTrain.id },
      data: {
        preferredFirmwareReleaseId: preferred.id,
        minimumAcceptableFirmwareReleaseId: minimum.id,
      },
    })

    await expect(
      db.firmwareTrain.update({
        where: { id: preferredTrain.id },
        data: { preferredFirmwareReleaseId: wrongTrainRelease.id },
      }),
    ).rejects.toThrow()

    await expect(
      db.firmwareRelease.update({
        where: { id: preferred.id },
        data: { firmwareTrainId: acceptedTrain.id },
      }),
    ).rejects.toThrow()

    await expect(
      db.firmwareTrain.update({
        where: { id: preferredTrain.id },
        data: { state: 'INVALID' },
      }),
    ).rejects.toThrow()

    const device = await db.device.create({
      data: {
        customerId: customer.id,
        deviceModelId: model.id,
        name: 'fw106-integrity-device',
        currentFirmwareReleaseId: preferred.id,
        currentFirmwareRawVersion: preferred.version,
      },
    })
    const lifecycle = await db.firmwareLifecycleRecord.create({
      data: {
        deviceId: device.id,
        targetFirmwareReleaseId: preferred.id,
        state: 'DONE',
        completedAt: new Date('2026-09-20T12:00:00Z'),
      },
    })

    await db.firmwareRelease.update({
      where: { id: preferred.id },
      data: {
        catalogState: 'BLOCKED',
        policyEligibility: 'DISALLOWED',
        status: 'BLOCKED',
        isActive: false,
      },
    })

    const [archivedRelease, preservedDevice, preservedHistory, train] = await Promise.all([
      db.firmwareRelease.findUniqueOrThrow({ where: { id: preferred.id } }),
      db.device.findUniqueOrThrow({ where: { id: device.id } }),
      db.firmwareLifecycleRecord.findUniqueOrThrow({ where: { id: lifecycle.id } }),
      db.firmwareTrain.findUniqueOrThrow({ where: { id: preferredTrain.id } }),
    ])

    expect(archivedRelease).toMatchObject({
      id: preferred.id,
      isActive: false,
      catalogState: 'BLOCKED',
      policyEligibility: 'DISALLOWED',
    })
    expect(preservedDevice.currentFirmwareReleaseId).toBe(preferred.id)
    expect(preservedHistory.targetFirmwareReleaseId).toBe(preferred.id)
    expect(train.preferredFirmwareReleaseId).toBe(preferred.id)
  }, 120000)
})
