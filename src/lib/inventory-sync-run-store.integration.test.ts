import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startPostgresTestDatabase, type TestPostgresDatabase } from '../../tests/support/postgres.mjs'

describe('Inventory sync run history', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let store: typeof import('./inventory-sync-run-store')

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    db = (await import('./prisma')).prisma
    store = await import('./inventory-sync-run-store')
  }, 120000)

  afterAll(async () => {
    try { if (db) await db.$disconnect() } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }
  }, 120000)

  it('persists counts and rejects overlapping runs for one source', async () => {
    const suffix = randomUUID().slice(0, 8)
    const source = await db.inventorySource.create({
      data: {
        provider: 'MERAKI',
        adapterType: 'meraki-dashboard-api-v1',
        sourceAdapterId: `test-${suffix}`,
        name: `Meraki ${suffix}`,
        enabled: true,
        configuration: {},
      },
    })
    const run = await store.beginInventorySyncRun(source.id, 'MANUAL')
    await expect(store.beginInventorySyncRun(source.id, 'SCHEDULED')).rejects.toThrow(
      'already running',
    )
    await store.completeInventorySyncRun({
      runId: run.id,
      status: 'SUCCEEDED',
      batchId: 'batch-1',
      fetchedCount: 3,
      stagedCount: 3,
      autoPublishedCount: 2,
      reviewRequiredCount: 1,
    })
    await expect(store.listInventorySyncRuns(source.id)).resolves.toEqual([
      expect.objectContaining({
        id: run.id,
        status: 'SUCCEEDED',
        trigger: 'MANUAL',
        fetchedCount: 3,
        autoPublishedCount: 2,
        reviewRequiredCount: 1,
      }),
    ])
  }, 120000)
})
