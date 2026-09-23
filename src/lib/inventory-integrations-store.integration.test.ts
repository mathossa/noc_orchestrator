import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'

vi.mock('./prisma', async () => {
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@/generated/prisma/client')
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.INVENTORY_INTEGRATIONS_TEST_DATABASE_URL,
        max: 2,
      }),
    }),
  }
})

describe('inventory integrations PostgreSQL foundation', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousIntegrationDatabaseUrl =
    process.env.INVENTORY_INTEGRATIONS_TEST_DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let store: typeof import('./inventory-integrations-store')

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    await testDatabase.reset()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    process.env.INVENTORY_INTEGRATIONS_TEST_DATABASE_URL =
      testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    store = await import('./inventory-integrations-store')
  }, 120_000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousIntegrationDatabaseUrl === undefined) {
        delete process.env.INVENTORY_INTEGRATIONS_TEST_DATABASE_URL
      } else {
        process.env.INVENTORY_INTEGRATIONS_TEST_DATABASE_URL =
          previousIntegrationDatabaseUrl
      }
    }
  }, 120_000)

  it('keeps provider identity separate from adapter and transport identity', async () => {
    const source = await store.createInventorySource({
      provider: 'AUVIK',
      adapterType: 'xlsx',
      sourceAdapterId: 'auvik-xlsx',
      name: 'Auvik XLSX',
      enabled: true,
      configuration: { upload: true },
      metadata: { format: 'xlsx' },
    })

    expect(source).toMatchObject({
      provider: 'AUVIK',
      adapterType: 'xlsx',
      sourceAdapterId: 'auvik-xlsx',
    })
  })

  it('allows one sync profile to reference multiple inventory sources', async () => {
    const auvik = await db.inventorySource.findFirstOrThrow({
      where: { provider: 'AUVIK', sourceAdapterId: 'auvik-xlsx' },
    })
    const cmdb = await store.createInventorySource({
      provider: 'CMDB',
      adapterType: 'xlsx',
      sourceAdapterId: 'cmdb-xlsx',
      name: 'CMDB XLSX',
      enabled: true,
      configuration: { upload: true },
      metadata: null,
    })

    const profile = await store.createInventorySyncProfile({
      name: 'Network Inventory',
      sourceIds: [auvik.id, cmdb.id],
    })

    expect(profile.sources).toHaveLength(2)
    expect(profile.sources.map((link) => link.source.sourceAdapterId)).toEqual([
      'auvik-xlsx',
      'cmdb-xlsx',
    ])

    const listed = await store.listInventorySyncProfiles()
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'Network Inventory',
        sources: [
          expect.objectContaining({
            source: expect.objectContaining({ provider: 'AUVIK' }),
          }),
          expect.objectContaining({
            source: expect.objectContaining({ provider: 'CMDB' }),
          }),
        ],
      }),
    ])
  })
})
