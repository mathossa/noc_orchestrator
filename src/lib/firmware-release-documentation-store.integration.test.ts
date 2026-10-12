// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

vi.mock('./prisma', async () => {
  const connectionString = process.env.FIRMWARE_DOC_TEST_DATABASE_URL
  if (!connectionString) throw new Error('FIRMWARE_DOC_TEST_DATABASE_URL must be configured for documentation integration tests.')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@/generated/prisma/client')
  return { prisma: new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) }) }
})

describe('release documentation PostgreSQL persistence', () => {
  let database: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let docs: typeof import('./firmware-release-documentation-store')
  const prefix = randomUUID()
  const ids = {
    vendor: `docs-vendor-${prefix}`,
    running: `docs-running-${prefix}`,
    preferred: `docs-preferred-${prefix}`,
    plan: `docs-plan-${prefix}`,
    target: `docs-target-${prefix}`,
  }
  const prevDb = process.env.DATABASE_URL
  const prevDocsDb = process.env.FIRMWARE_DOC_TEST_DATABASE_URL

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
    await database.reset()
    process.env.DATABASE_URL = database.databaseUrl
    process.env.FIRMWARE_DOC_TEST_DATABASE_URL = database.databaseUrl
    db = (await import('./prisma')).prisma
    docs = await import('./firmware-release-documentation-store')
    await db.vendor.create({ data: {
      id: ids.vendor, code: `DOCS-${prefix}`, name: `Firmware Docs ${prefix}`,
    } })
    await db.firmwareRelease.createMany({ data: [
      { id: ids.running, vendorId: ids.vendor, version: '7.4.6',
        logicalVersion: '7.4.6', platform: 'FortiOS' },
      { id: ids.preferred, vendorId: ids.vendor, version: '7.6.4',
        logicalVersion: '7.6.4', platform: 'FortiOS' },
    ] })
    await db.firmwareWorkPlan.create({ data: {
      id: ids.plan, state: 'DONE', title: 'Historical firmware change',
    } })
    await db.firmwareWorkPlanTarget.create({ data: {
      id: ids.target,
      planId: ids.plan,
      deviceId: `docs-device-${prefix}`,
      deviceName: 'FGT-01',
      customerId: `docs-customer-${prefix}`,
      customerName: 'Documentation test customer',
      deviceModelId: `docs-model-${prefix}`,
      deviceModelName: 'FortiGate 120G',
      observedFirmwareReleaseId: ids.running,
      observedFirmwareVersion: '7.4.6',
      recommendation: 'UPDATE_REQUIRED',
      targetFirmwareReleaseId: ids.preferred,
      targetVersion: '7.6.4',
      targetLogicalVersion: '7.6.4',
      targetPlatform: 'FortiOS',
    } })
  }, 120_000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await database?.stop()
      if (prevDb === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = prevDb
      if (prevDocsDb === undefined) delete process.env.FIRMWARE_DOC_TEST_DATABASE_URL
      else process.env.FIRMWARE_DOC_TEST_DATABASE_URL = prevDocsDb
    }
  }, 120_000)

  it('keeps running, preferred and historical target links attached to the correct canonical release', async () => {
    const running = await docs.createReleaseDocumentation(ids.running, {
      type: 'RELEASE_NOTES', title: 'Running release notes',
      url: 'https://vendor.example.com/7.4.6', source: 'Vendor',
    })
    const preferred = await docs.createReleaseDocumentation(ids.preferred, {
      type: 'UPGRADE_GUIDE', title: 'Preferred upgrade guide',
      url: 'https://vendor.example.com/7.6.4', source: 'Vendor',
    })
    const [runningDocs, preferredDocs] = await Promise.all([
      docs.listReleaseDocumentation(ids.running),
      docs.listReleaseDocumentation(ids.preferred),
    ])
    expect(runningDocs.data.map((x) => x.id)).toContain(running.id)
    expect(runningDocs.data.map((x) => x.id)).not.toContain(preferred.id)
    expect(preferredDocs.data.map((x) => x.id)).toContain(preferred.id)
    expect(preferredDocs.data.map((x) => x.id)).not.toContain(running.id)

    const originalTarget = await db.firmwareWorkPlanTarget.findUniqueOrThrow({ where: { id: ids.target } })
    expect(originalTarget.targetFirmwareReleaseId).toBe(ids.preferred)
    await docs.updateReleaseDocumentation(ids.preferred, preferred.id, { title: 'Revised guide' })
    const updatedDocs = await docs.listReleaseDocumentation(ids.preferred)
    expect(updatedDocs.data.find((item) => item.id === preferred.id)?.title).toBe('Revised guide')
    const historicalTarget = await db.firmwareWorkPlanTarget.findUniqueOrThrow({ where: { id: ids.target } })
    expect(historicalTarget).toEqual(originalTarget)

    await docs.deleteReleaseDocumentation(ids.preferred, preferred.id)
    expect(await db.firmwareWorkPlanTarget.findUniqueOrThrow({ where: { id: ids.target } }))
      .toEqual(originalTarget)
  })

  it('rejects cross-release link mutations and duplicate URLs atomically', async () => {
    const original = await docs.createReleaseDocumentation(ids.preferred, {
      type: 'SECURITY', title: 'Vendor advisory', url: 'https://vendor.example.com/advisory',
      source: 'Vendor',
    })
    await expect(docs.deleteReleaseDocumentation(ids.running, original.id))
      .rejects.toMatchObject({ status: 404 })
    await expect(docs.createReleaseDocumentation(ids.preferred, {
      type: 'SECURITY', title: 'Same URL',
      url: original.url, source: 'Vendor',
    })).rejects.toMatchObject({ status: 409 })
    expect(await db.firmwareReleaseDocument.count({
      where: { firmwareReleaseId: ids.preferred, url: original.url },
    })).toBe(1)
  })
})
