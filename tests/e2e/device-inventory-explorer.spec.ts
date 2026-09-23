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
  blockedRelease: prefix + '-blocked',
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
  await prisma.firmwareRelease.create({ data: {
    id: ids.blockedRelease, vendorId: ids.vendor, platform: 'PW-OS', version: '1.0', logicalVersion: '1.0', catalogState: 'BLOCKED',
  } })
  await prisma.device.createMany({
    data: [
      {
        id: ids.first,
        customerId: ids.customer,
        siteId: ids.site,
        deviceModelId: ids.model,
        name: 'PW-SW-01',
        currentFirmwareReleaseId: ids.blockedRelease,
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

  await expect(customerRow).toContainText('1 critical · 1 attention')
  await customerLink.click()
  await expect(page).toHaveURL(
    new RegExp('/devices/customers/' + ids.customer + '$'),
  )
  await expect(
    page.getByRole('link', { name: 'Playwright HQ', exact: true }),
  ).toBeVisible()

  await expect(page.getByRole('link', { name: 'Playwright HQ', exact: true }).locator('xpath=ancestor::tr')).toContainText('1 critical · 1 attention')
  await page.getByRole('link', { name: 'Playwright HQ', exact: true }).click()
  await expect(page).toHaveURL(
    new RegExp('/devices/customers/' + ids.customer + '/sites/' + ids.site + '$'),
  )

  await expect(page.getByRole('link', { name: 'Playwright Switches', exact: true }).locator('xpath=ancestor::tr')).toContainText('1 critical · 1 attention')
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
  await expect(page.getByRole('heading', { name: 'Firmware', exact: true })).toBeVisible({
    timeout: 20_000,
  })

  await expect(page.getByRole('link', { name: 'Playwright Switches', exact: true })).toHaveAttribute('href', `/devices/customers/${ids.customer}/sites/${ids.site}/types/${ids.type}`)
  await page.getByRole('link', { name: 'Edit device', exact: true }).click()
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('PW-SW-01', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/devices/' + ids.first + '$'))

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


test('debounces scoped search and exposes a direct site link', async ({ page }) => {
  const clockStart = Date.now()
  // Install before navigation so the application consistently uses fake timers.
  await page.clock.install({ time: clockStart })
  await page.goto('/devices')
  // install() alone keeps time flowing between Playwright commands. Pause before
  // typing so only runFor() advances the debounce window, including its reset.
  await page.clock.pauseAt(clockStart + 60 * 60 * 1000)
  const queries: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/devices' && url.searchParams.has('q')) queries.push(url.searchParams.get('q')!)
  })
  const search = page.getByRole('searchbox', { name: 'Search inventory' })
  await search.fill('PW')
  await page.clock.runFor(200)
  await search.fill('PWHQ')
  await page.clock.runFor(399)
  expect(queries).toEqual([])
  await page.clock.runFor(1)
  // The debounce has fired; allow Next.js navigation/render timers to run normally.
  await page.clock.resume()
  await expect(page).toHaveURL(/q=PWHQ/)
  expect(queries).not.toContain('PW')
  await expect(page.getByRole('link', { name: 'Site: Playwright Inventory Customer / Playwright HQ' })).toHaveAttribute('href', `/devices/customers/${ids.customer}/sites/${ids.site}`)
})


test('keeps device details compact and records a note and issue without changing firmware', async ({ page }) => {
  await page.goto('/devices/' + ids.first)
  await expect(page.getByRole('heading', { name: 'Firmware', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Record decision', exact: true })).toHaveCount(0)
  await expect(page.locator('details')).toHaveCount(0)
  await page.getByRole('button', { name: 'Details & history', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Device details & history' })
  await expect(details).toBeVisible()
  await expect(details.getByRole('heading', { name: 'Firmware details', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Details & history', exact: true })).toBeFocused()

  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  const note = page.getByRole('dialog', { name: 'Add note', exact: true })
  await note.getByLabel('Note', { exact: true }).fill('Check cabling at next site visit.')
  await note.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(note).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Device notes' })).toContainText('Check cabling')

  await page.getByRole('button', { name: 'Flag issue', exact: true }).click()
  const flag = page.getByRole('dialog', { name: 'Flag issue', exact: true })
  await flag.getByLabel('What needs investigation?').fill('Management address unreachable')
  await flag.getByRole('button', { name: 'Flag issue', exact: true }).click()
  await expect(flag).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Open device issue' })).toContainText('Management address unreachable')
  const stored = await prisma.device.findUniqueOrThrow({ where: { id: ids.first } })
  expect(stored.currentFirmwareReleaseId).toBe(ids.blockedRelease)
  expect(stored.issueReason).toBe('Management address unreachable')

  await page.goto('/devices?flagged=1')
  const customer = page.getByRole('link', { name: 'Playwright Inventory Customer', exact: true }).locator('xpath=ancestor::tr')
  await expect(customer).toContainText('1 flagged')
  await page.goto('/devices/' + ids.first)
  await page.getByRole('button', { name: 'Resolve issue', exact: true }).click()
  await page.getByRole('dialog', { name: 'Resolve issue', exact: true }).getByRole('button', { name: 'Resolve issue', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Open device issue' })).toHaveCount(0)
  expect(await prisma.auditEvent.count({ where: { entityId: ids.first, action: 'DEVICE_ISSUE_RESOLVED' } })).toBe(1)
})
