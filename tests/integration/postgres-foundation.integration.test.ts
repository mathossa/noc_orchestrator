import { PrismaPg } from '@prisma/adapter-pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../src/generated/prisma/client'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../support/postgres.mjs'

function createPrismaClient(databaseUrl: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }),
  })
}

describe('shared PostgreSQL test foundation', () => {
  let testDatabase: TestPostgresDatabase | undefined
  let prisma: ReturnType<typeof createPrismaClient> | undefined

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    prisma = createPrismaClient(testDatabase.databaseUrl)
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (!testDatabase) return
    await testDatabase.stop()
    await expect(testDatabase.stop()).resolves.toBeUndefined()
  }, 120_000)

  it('applies tracked migrations and restores the migrated baseline after seeding', async () => {
    if (!testDatabase || !prisma) throw new Error('PostgreSQL test database was not started')

    const migrationsBefore = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `
    expect(migrationsBefore.length).toBeGreaterThan(0)

    await testDatabase.seed(async (databaseUrl) => {
      const seedClient = createPrismaClient(databaseUrl)
      try {
        await seedClient.customer.create({
          data: {
            id: 'issue-98-foundation-seed',
            name: 'Issue 98 Foundation Seed',
          },
        })
      } finally {
        await seedClient.$disconnect()
      }
    })

    expect(
      await prisma.customer.count({ where: { id: 'issue-98-foundation-seed' } }),
    ).toBe(1)

    // PostgreSqlContainer snapshots require clients to be disconnected before
    // restoring the database. Re-open afterward to prove the restored database
    // is immediately usable by Prisma again.
    await prisma.$disconnect()
    prisma = undefined
    await testDatabase.reset()
    prisma = createPrismaClient(testDatabase.databaseUrl)

    expect(
      await prisma.customer.count({ where: { id: 'issue-98-foundation-seed' } }),
    ).toBe(0)

    const migrationsAfter = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `
    expect(migrationsAfter).toEqual(migrationsBefore)
  })
})
