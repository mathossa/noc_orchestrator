import { PrismaPg } from '@prisma/adapter-pg'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/client'

const prefix = 'pw-inventory-107'
const ids = {
  customer: prefix + '-customer',
  site: prefix + '-site',
  vendor: prefix + '-vendor',
  type: prefix + '-type',
  model: prefix + '-model',
  first: prefix + '-device-1',
  second: prefix + '-device-2',
}

let prisma: PrismaClient

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for Playwright')

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }),
  })

  await prisma.customer.create({
    data: { id: ids.customer, name: 'Playwright Inventory Customer' },
  })
  await prisma.site.create({
    data: {
      id: ids.site,
      customerId: ids.customer,
      name: 'Playwright HQ',
      code: 'PWHQ',
    },
  })
  await prisma.vendor.create({
    data: {
      id: ids.vendor,
      code: 'PW107',
      name: 'Playwright Vendor',
    },
  })
  await prisma.deviceType.create({
    data: {
      id: ids.type,
      code: 'PW107-SW',
      name: 'Playwright Switches',
    },
  })
  await prisma.deviceModel.create({
    data: {
      id: ids.model,
      vendorId: ids.vendor,
      deviceTypeId: ids.type,
      model: 'PW-C9300',
    },
  })
  await prisma.device.createMany({
    data: [
      {
        id: ids.first,
        customerId: ids.customer,
        siteId: ids.site,
        deviceModelId: ids.model,
        name: 'PW-SW-01',
        hostname: 'pw-sw-01',
        serialNumber: 'PW-SERIAL-107',
        managementAddress: '10.107.10.1',
      },
      {
        id: ids.second,
        customerId: ids.customer,
        siteId: ids.site,
        deviceModelId: ids.model,
        name: 'PW-SW-02',
        hostname: 'pw-sw-02',
        managementAddress: '10.107.10.2',
      },
    ],
  })
})

test.afterAll(async () => {
  await prisma?.$disconnect()
})

test('navigates customer, site, device group and device detail with attention drill-down', async ({
  page,
}) => {
  await page.goto('/devices')
  await expect(
    page.getByRole('heading', { name: 'Devices', exact: true }),
  ).toBeVisible()

  const customerLink = page.getByRole('link', {
    name: 'Playwright Inventory Customer',
    exact: true,
  })
  await expect(customerLink).toBeVisible()

  const customerRow = customerLink.locator('xpath=ancestor::tr')
  await expect(
    customerRow.getByRole('link', { name: /2 devices need attention/i }),
  ).toBeVisible()

  await customerLink.click()
  await expect(page).toHaveURL(
    new RegExp('/devices/customers/' + ids.customer + '$'),
  )
  await expect(
    page.getByRole('link', { name: 'Playwright HQ', exact: true }),
  ).toBeVisible()

  await page.getByRole('link', { name: 'Playwright HQ', exact: true }).click()
  await expect(page).toHaveURL(
    new RegExp('/devices/customers/' + ids.customer + '/sites/' + ids.site + '$'),
  )

  await page
    .getByRole('link', { name: 'Playwright Switches', exact: true })
    .click()
  await expect(page).toHaveURL(
    new RegExp(
      '/devices/customers/' +
        ids.customer +
        '/sites/' +
        ids.site +
        '/types/' +
        ids.type +
        '$',
    ),
  )

  await expect(page.getByRole('link', { name: 'pw-sw-01' })).toBeVisible()
  await page.getByRole('link', { name: 'pw-sw-01' }).click()
  await expect(page).toHaveURL(new RegExp('/devices/' + ids.first + '$'))
  await expect(page.getByText('Inventory status')).toBeVisible({
    timeout: 20_000,
  })

  await page.goto('/devices')
  await customerRow
    .getByRole('link', { name: /2 devices need attention/i })
    .click()
  await expect(page).toHaveURL(
    new RegExp(
      '/devices/customers/' + ids.customer + '\\?attention=1$',
    ),
  )
})

test('uses root inventory search for direct device lookup', async ({ page }) => {
  await page.goto('/devices')
  await page.getByRole('searchbox', { name: 'Search inventory' }).fill(
    'PW-SERIAL-107',
  )
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page.getByText('Direct device matches')).toBeVisible()
  await expect(page.getByRole('link', { name: 'pw-sw-01' })).toBeVisible()
  await expect(
    page.getByRole('link', {
      name: 'Playwright Inventory Customer',
      exact: true,
    }),
  ).toBeVisible()
})
