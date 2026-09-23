import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  startPostgresTestDatabase,
  type TestPostgresDatabase,
} from '../../tests/support/postgres.mjs'
import { parseInventoryQuery } from './inventory-explorer'

vi.mock('./prisma', async () => {
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { PrismaClient } = await import('@/generated/prisma/client')
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.INVENTORY_TEST_DATABASE_URL,
        max: 2,
      }),
    }),
  }
})

describe('inventory explorer PostgreSQL read model', () => {
  const prefix = 'inventory-107-' + randomUUID()
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousInventoryDatabaseUrl = process.env.INVENTORY_TEST_DATABASE_URL
  let testDatabase: TestPostgresDatabase | undefined
  let db: (typeof import('./prisma'))['prisma']
  let store: typeof import('./inventory-explorer-store')

  const ids = {
    acme: prefix + '-acme',
    beta: prefix + '-beta',
    hq: prefix + '-hq',
    branch: prefix + '-branch',
    vendor: prefix + '-vendor',
    switchType: prefix + '-switch',
    apType: prefix + '-ap',
    switchModel: prefix + '-switch-model',
    apModel: prefix + '-ap-model',
  }

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase()
    await testDatabase.reset()
    process.env.DATABASE_URL = testDatabase.databaseUrl
    process.env.INVENTORY_TEST_DATABASE_URL = testDatabase.databaseUrl

    db = (await import('./prisma')).prisma
    store = await import('./inventory-explorer-store')

    await db.customer.createMany({
      data: [
        { id: ids.acme, name: 'Acme Inventory 107' },
        { id: ids.beta, name: 'Beta Inventory 107' },
      ],
    })
    await db.site.createMany({
      data: [
        { id: ids.hq, customerId: ids.acme, name: 'HQ 107', code: 'HQ107' },
        {
          id: ids.branch,
          customerId: ids.acme,
          name: 'Branch 107',
          code: 'BR107',
        },
      ],
    })
    await db.vendor.create({
      data: { id: ids.vendor, code: prefix, name: 'Vendor 107' },
    })
    await db.deviceType.createMany({
      data: [
        { id: ids.switchType, code: prefix + '-SW', name: 'Switches 107' },
        { id: ids.apType, code: prefix + '-AP', name: 'Access Points 107' },
      ],
    })
    await db.deviceModel.createMany({
      data: [
        {
          id: ids.switchModel,
          vendorId: ids.vendor,
          deviceTypeId: ids.switchType,
          model: 'Switch Model 107',
        },
        {
          id: ids.apModel,
          vendorId: ids.vendor,
          deviceTypeId: ids.apType,
          model: 'AP Model 107',
        },
      ],
    })

    await db.device.createMany({
      data: [
        ...Array.from({ length: 30 }, (_, index) => ({
          id: prefix + '-switch-' + String(index + 1).padStart(2, '0'),
          customerId: ids.acme,
          siteId: ids.hq,
          deviceModelId: ids.switchModel,
          name: 'HQ-SW-' + String(index + 1).padStart(2, '0'),
          hostname: 'hq-sw-' + String(index + 1).padStart(2, '0'),
          serialNumber: index === 0 ? 'SERIAL-LOOKUP-107' : null,
          managementAddress: '10.107.0.' + (index + 1),
        })),
        {
          id: prefix + '-ap-1',
          customerId: ids.acme,
          siteId: ids.branch,
          deviceModelId: ids.apModel,
          name: 'BR-AP-01',
        },
        {
          id: prefix + '-beta-1',
          customerId: ids.beta,
          deviceModelId: ids.switchModel,
          name: 'BETA-SW-01',
        },
      ],
    })
  }, 120_000)

  afterAll(async () => {
    try {
      if (db) await db.$disconnect()
    } finally {
      await testDatabase?.stop()
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousInventoryDatabaseUrl === undefined) {
        delete process.env.INVENTORY_TEST_DATABASE_URL
      } else {
        process.env.INVENTORY_TEST_DATABASE_URL =
          previousInventoryDatabaseUrl
      }
    }
  }, 120_000)

  it('aggregates root, customer, site and device-type scopes without client-side inventory loading', async () => {
    const root = await store.getInventoryOverview(
      parseInventoryQuery(new URLSearchParams()),
    )
    const acme = root.customers.find((row) => row.id === ids.acme)
    const beta = root.customers.find((row) => row.id === ids.beta)
    expect(acme).toMatchObject({
      siteCount: 2,
      deviceCount: 31,
      attentionCount: 31,
    })
    expect(beta).toMatchObject({
      siteCount: 0,
      deviceCount: 1,
      attentionCount: 1,
    })

    const customer = await store.getCustomerInventory(
      ids.acme,
      parseInventoryQuery(new URLSearchParams()),
    )
    expect(customer?.sites.map((row) => row.id)).toEqual([
      ids.hq,
      ids.branch,
    ])

    const site = await store.getSiteInventory(
      ids.acme,
      ids.hq,
      parseInventoryQuery(new URLSearchParams()),
    )
    expect(site?.deviceTypes).toEqual([
      expect.objectContaining({
        id: ids.switchType,
        deviceCount: 30,
        attentionCount: 30,
      }),
    ])
  })

  it('keeps contextual search server-scoped across serial, customer and site context', async () => {
    const root = await store.getInventoryOverview(
      parseInventoryQuery(new URLSearchParams({ q: 'serial-lookup-107' })),
    )
    expect(root.customers.map((row) => row.id)).toEqual([ids.acme])
    expect(root.searchHits.map((row) => row.name)).toEqual(['HQ-SW-01'])

    const wrongCustomer = await store.getCustomerInventory(
      ids.beta,
      parseInventoryQuery(new URLSearchParams({ q: 'serial-lookup-107' })),
    )
    expect(wrongCustomer?.counts.total).toBe(0)
    expect(wrongCustomer?.searchHits).toEqual([])

    const branch = await store.getSiteInventory(
      ids.acme,
      ids.branch,
      parseInventoryQuery(new URLSearchParams({ q: 'BR-AP-01' })),
    )
    expect(branch?.searchHits.map((row) => row.name)).toEqual(['BR-AP-01'])
  })

  it('paginates the individual device group and keeps the query bounded', async () => {
    const group = await store.getDeviceTypeInventory(
      ids.acme,
      ids.hq,
      ids.switchType,
      parseInventoryQuery(
        new URLSearchParams({ page: '2', pageSize: '25' }),
      ),
    )
    expect(group?.pagination).toEqual({
      page: 2,
      pageSize: 25,
      total: 30,
      totalPages: 2,
    })
    expect(group?.devices).toHaveLength(5)
  })

  it('exports only the selected customer scope with detailed device data', async () => {
    const rows = await store.getInventoryExportRecords(
      { kind: 'customer', customerId: ids.beta },
      parseInventoryQuery(new URLSearchParams()),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      customer: 'Beta Inventory 107',
      name: 'BETA-SW-01',
      deviceType: 'Switches 107',
      primaryStatus: 'Unknown',
    })
  })
})
