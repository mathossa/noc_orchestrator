// Opt in only against a disposable, migrated database. No external dependencies
// beyond the application's PostgreSQL adapter are required.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
const fault = vi.hoisted(() => ({ audit: false }))
vi.mock('./prisma', async () => {
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@/generated/prisma/client')
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.EXCEPTION_TEST_DATABASE_URL,
        max: 1,
      }),
    }).$extends({
      query: {
        auditEvent: {
          create({ args, query }) {
            if (fault.audit) throw new Error('Injected audit failure')
            return query(args)
          },
        },
      },
    }),
  }
})
const databaseUrl = process.env.EXCEPTION_TEST_DATABASE_URL
describe.skipIf(!databaseUrl)(
  'firmware exceptions PostgreSQL transactions',
  () => {
    const prefix = `exception-test-${randomUUID()}`
    let db: (typeof import('./prisma'))['prisma']
    let store: typeof import('./firmware-exception-store')
    const ids = {
      actor: `${prefix}-actor`,
      customer: `${prefix}-customer`,
      vendor: `${prefix}-vendor`,
      type: `${prefix}-type`,
      model: `${prefix}-model`,
      device: `${prefix}-device`,
    }
    const raw = {
      scope: 'DEVICE',
      scopeId: ids.device,
      subject: 'ALL_MAINTENANCE',
      reasonCode: 'CUSTOMER_DECLINED',
      duration: 'PERMANENT',
      notes: 'Integration decision',
    }
    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl
      db = (await import('./prisma')).prisma
      store = await import('./firmware-exception-store')
      await db.user.create({
        data: {
          id: ids.actor,
          name: 'Test engineer',
          email: `${prefix}@example.test`,
        },
      })
      await db.customer.create({ data: { id: ids.customer, name: prefix } })
      await db.vendor.create({
        data: { id: ids.vendor, code: prefix, name: prefix },
      })
      await db.deviceType.create({
        data: { id: ids.type, code: prefix, name: prefix },
      })
      await db.deviceModel.create({
        data: {
          id: ids.model,
          vendorId: ids.vendor,
          deviceTypeId: ids.type,
          model: prefix,
        },
      })
      await db.device.create({
        data: {
          id: ids.device,
          customerId: ids.customer,
          deviceModelId: ids.model,
          name: prefix,
        },
      })
    }, 30000)
    afterAll(async () => {
      if (!db) return
      const rows = await db.firmwareException.findMany({
        where: { scopeId: ids.device },
        select: { id: true },
      })
      await db.auditEvent.deleteMany({
        where: { entityId: { in: rows.map((r) => r.id) } },
      })
      await db.firmwareException.deleteMany({ where: { scopeId: ids.device } })
      await db.device.deleteMany({ where: { id: ids.device } })
      await db.deviceModel.deleteMany({ where: { id: ids.model } })
      await db.deviceType.deleteMany({ where: { id: ids.type } })
      await db.vendor.deleteMany({ where: { id: ids.vendor } })
      await db.customer.deleteMany({ where: { id: ids.customer } })
      await db.user.deleteMany({ where: { id: ids.actor } })
      await db.$disconnect()
    }, 30000)
    it('rolls back the real database transaction if the audit write fails', async () => {
      const preview = await store.previewFirmwareException(raw)
      fault.audit = true
      await expect(
        store.createFirmwareException(raw, ids.actor, preview.token),
      ).rejects.toThrow('Injected audit failure')
      fault.audit = false
      expect(
        await db.firmwareException.count({ where: { scopeId: ids.device } }),
      ).toBe(0)
    })
    it('saves audit and decision atomically and inventory observations preserve it', async () => {
      const preview = await store.previewFirmwareException(raw)
      const saved = await store.createFirmwareException(
        raw,
        ids.actor,
        preview.token,
      )
      expect(await db.auditEvent.count({ where: { entityId: saved.id } })).toBe(
        1,
      )
      await db.device.update({
        where: { id: ids.device },
        data: {
          currentFirmwareRawVersion: 'updated import observation',
          currentFirmwareSource: 'IMPORT',
        },
      })
      expect(
        await db.firmwareException.findUnique({ where: { id: saved.id } }),
      ).toEqual(saved)
      const view = await store.listFirmwareExceptions(ids.device)
      expect(view.resolutions[0].selectedId).toBe(saved.id)
      expect(view.resolutions[0].compliance).toBe('UNKNOWN_FIRMWARE')
    })
    it('ends a decision and restores the recommendation while retaining history', async () => {
      const [saved] = await db.firmwareException.findMany({
        where: { scopeId: ids.device },
      })
      await store.supersedeFirmwareException(saved.id, ids.actor)
      const view = await store.listFirmwareExceptions(ids.device)
      expect(view.resolutions[0].operationalRecommendation).toBe(
        'REVIEW_REQUIRED',
      )
      expect(view.records[0].status).toBe('SUPERSEDED')
      expect(await db.auditEvent.count({ where: { entityId: saved.id } })).toBe(
        2,
      )
    })
  },
)
