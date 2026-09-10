import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set')
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl })
  return new PrismaClient({
    adapter,
    transactionOptions: {
      // Importer v2 publication intentionally commits the approved batch as one
      // atomic interactive transaction. Prisma's 5 second default is too short
      // even for a normal ~200-device batch once identity, catalog, topology,
      // firmware, audit and source-snapshot writes are included.
      //
      // Keep the transaction bounded, but allow enough time for the atomic
      // publication path to complete instead of expiring halfway through.
      maxWait: 15_000,
      timeout: 120_000,
    },
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
