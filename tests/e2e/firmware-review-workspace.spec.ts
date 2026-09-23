import { PrismaPg } from '@prisma/adapter-pg'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '../../src/generated/prisma/client'

const prefix = 'pw-review-62'
const ids = {
  customer: prefix + '-customer',
  site: prefix + '-site',
  cycle: prefix + '-cycle',
  report1: prefix + '-report-1',
  report2: prefix + '-report-2',
  type: prefix + '-type',
  model: prefix + '-model',
  train: prefix + '-train',
  target: prefix + '-target',
  exception: prefix + '-exception',
  plan: prefix + '-plan',
  device: prefix + '-device',
}

let prisma: PrismaClient

function reviewSnapshot(version: number) {
  const latest = version === 2
  const device = {
    deviceId: ids.device,
    deviceName: 'PW-REVIEW-SW-01',
    hostname: 'pw-review-sw-01',
    siteId: ids.site,
    siteName: 'Review UI Site',
    organizationUnit: null,
    vendor: { id: prefix + '-vendor', code: 'PW62', name: 'Review Vendor' },
    deviceType: { id: ids.type, code: 'SWITCH', name: 'Switch' },
    model: {
      id: ids.model,
      name: 'Review Switch',
      familyId: null,
      familyName: null,
      platform: 'ReviewOS',
      preferredPlatform: 'ReviewOS',
    },
    inventorySource: { source: 'IMPORT', externalProvider: 'Fixture' },
    currentFirmware: {
      releaseId: prefix + '-current',
      platform: 'ReviewOS',
      version: latest ? '1.1' : '1.0',
      rawVersion: latest ? '1.1' : '1.0',
      observedAt: '2026-09-20T08:00:00.000Z',
      catalogState: 'VERIFIED',
      policyEligibility: 'ALLOWED',
    },
    technical: {
      compliance: latest ? 'BELOW_MINIMUM' : 'ACCEPTED',
      relationToPreferred: 'BELOW_PREFERRED',
      recommendation: latest ? 'UPDATE_REQUIRED' : 'UPDATE_RECOMMENDED',
      label: latest
        ? 'Below minimum — update required'
        : 'Accepted — update recommended',
      explanation: latest
        ? 'Running firmware is below the accepted lower boundary.'
        : 'Accepted — update recommended.',
      effectiveTrack: null,
      policy: {
        id: prefix + '-policy',
        mode: 'MINIMUM',
        version: 1,
        trackKey: 'preferred',
        trackName: 'Preferred',
        trackClass: 'PREFERRED',
        desiredPlatform: 'ReviewOS',
        minimumFirmwareReleaseId: prefix + '-minimum',
        targetFirmwareReleaseId: ids.target,
        maximumFirmwareReleaseId: null,
        firmwareTrainId: ids.train,
      },
      policySource: {
        scope: 'SITE',
        scopeId: ids.site,
        subject: 'MODEL',
        subjectId: ids.model,
        policyId: prefix + '-policy',
        trackKey: 'preferred',
        trackName: 'Preferred',
        trackClass: 'PREFERRED',
        policyVersion: 1,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
      preferredTarget: {
        id: ids.target,
        platform: 'ReviewOS',
        version: '2.0',
        logicalVersion: '2.0',
        trainId: ids.train,
        trainName: 'Preferred',
      },
      resolvedTarget: {
        id: ids.target,
        platform: 'ReviewOS',
        version: '2.0',
        logicalVersion: '2.0',
        variant: null,
        imageCode: null,
      },
    },
    exception: latest
      ? null
      : {
          id: ids.exception,
          reasonCode: 'CUSTOMER_DECLINED',
          scope: 'SITE',
          scopeId: ids.site,
          scopeLabel: 'Review UI Site',
          subject: 'RELEASE',
          duration: 'CUSTOM_DATE',
          decidedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-10-15T00:00:00.000Z',
          contactReference: null,
          ticketReference: null,
          replacementRelated: false,
        },
    planning: {
      id: ids.plan,
      title: 'Review UI plan',
      state: latest ? 'SCHEDULED' : 'AWAITING_CUSTOMER',
      proposedFor: '2026-10-05T20:00:00.000Z',
      proposedMaintenanceWindowReference: 'Customer proposal',
      scheduledFor: latest ? '2026-10-12T20:00:00.000Z' : null,
      maintenanceWindowReference: latest ? 'Confirmed window' : null,
      externalReference: latest ? 'CHG-PW62' : null,
    },
    attentionClass: 'FIRMWARE',
  }

  const summary = {
    totalDevices: 1,
    preferred: 0,
    accepted: latest ? 0 : 1,
    updateRecommended: latest ? 0 : 1,
    updateRequired: latest ? 1 : 0,
    platformMigration: 0,
    reviewRequired: 0,
    acceptedException: latest ? 0 : 1,
    customerDeclined: latest ? 0 : 1,
    replacementOrEol: 0,
    unmanaged: 0,
    planned: 0,
    awaitingCustomer: latest ? 0 : 1,
    scheduled: latest ? 1 : 0,
  }

  return {
    schemaVersion: 2,
    reviewCycleId: ids.cycle,
    reportVersion: version,
    generatedAt: latest
      ? '2026-09-23T12:00:00.000Z'
      : '2026-09-20T12:00:00.000Z',
    reviewPeriod: {
      start: '2026-06-01T00:00:00.000Z',
      end: '2026-09-01T00:00:00.000Z',
    },
    customer: { id: ids.customer, name: 'Review UI Customer' },
    summary,
    sites: [
      {
        siteId: ids.site,
        siteName: 'Review UI Site',
        organizationUnit: null,
        summary,
        devices: [device],
      },
    ],
  }
}

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for Playwright')

  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }),
  })

  await prisma.customer.create({
    data: { id: ids.customer, name: 'Review UI Customer', code: 'PW62' },
  })
  await prisma.site.create({
    data: {
      id: ids.site,
      customerId: ids.customer,
      name: 'Review UI Site',
    },
  })
  await prisma.firmwareReviewCycle.create({
    data: {
      id: ids.cycle,
      customerId: ids.customer,
      customerName: 'Review UI Customer',
      periodStart: new Date('2026-06-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      asOf: new Date('2026-09-23T12:00:00.000Z'),
      nextReviewAt: new Date('2020-01-01T00:00:00.000Z'),
      state: 'READY',
    },
  })
  await prisma.firmwareReviewReport.createMany({
    data: [
      {
        id: ids.report1,
        reviewCycleId: ids.cycle,
        version: 1,
        generatedAt: new Date('2026-09-20T12:00:00.000Z'),
        snapshot: reviewSnapshot(1),
        snapshotHash: '1'.repeat(64),
      },
      {
        id: ids.report2,
        reviewCycleId: ids.cycle,
        version: 2,
        generatedAt: new Date('2026-09-23T12:00:00.000Z'),
        snapshot: reviewSnapshot(2),
        snapshotHash: '2'.repeat(64),
      },
    ],
  })
})

test.afterAll(async () => {
  await prisma?.$disconnect()
})

test('reviews cross-customer attention and opens immutable report versions with operational drill-downs', async ({
  page,
}) => {
  await page.goto('/reports')
  await expect(
    page.getByRole('heading', { name: 'Firmware review', exact: true }),
  ).toBeVisible()

  const customer = page.getByRole('link', {
    name: 'Review UI Customer',
    exact: true,
  })
  await expect(customer).toBeVisible()
  const row = customer.locator('xpath=ancestor::tr')
  await expect(row).toContainText('Overdue')
  await expect(row).toContainText('1 required')
  await expect(row).toContainText('Version 2')

  await customer.click()
  await expect(page).toHaveURL(new RegExp('/reports/' + ids.cycle + '$'))
  await expect(page.getByText('v2 · latest')).toBeVisible()
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible()
  await expect(page.getByText('1.1')).toBeVisible()

  await page.getByRole('link', { name: 'v1' }).click()
  await expect(page).toHaveURL(
    new RegExp('/reports/' + ids.cycle + '\\?version=1$'),
  )
  await expect(page.getByText(/Viewing version/)).toContainText('1')
  await expect(page.getByText('Proposed', { exact: true })).toBeVisible()
  await expect(page.getByText('1.0')).toBeVisible()
  await expect(page.getByText('Update Recommended')).toBeVisible()

  await expect(
    page.getByRole('link', { name: 'View affected devices →' }),
  ).toHaveAttribute(
    'href',
    '/devices/customers/' +
      ids.customer +
      '/sites/' +
      ids.site +
      '/types/' +
      ids.type +
      '?model=' +
      ids.model,
  )
  await expect(
    page.getByRole('link', { name: 'Open plan' }),
  ).toHaveAttribute('href', '/planning/' + ids.plan)
  await expect(
    page.getByRole('link', { name: 'Open Site exception →' }),
  ).toHaveAttribute(
    'href',
    '/firmware/exceptions?scope=SITE&scopeId=' + ids.site,
  )
  await expect(
    page.getByRole('link', { name: 'Open Site workspace' }),
  ).toHaveAttribute(
    'href',
    '/customers/' + ids.customer + '/sites/' + ids.site,
  )
})
