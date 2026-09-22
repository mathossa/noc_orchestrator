import { expect, test } from '@playwright/test'
import { prisma } from '../../src/lib/prisma'

let modelId = ''

test.beforeAll(async () => {
  const vendor = await prisma.vendor.create({
    data: { code: 'PW-FW106', name: 'Playwright Firmware 106' },
  })
  const deviceType = await prisma.deviceType.create({
    data: { code: 'PW-FW106-SW', name: 'Playwright Firmware 106 Switch' },
  })
  const family = await prisma.deviceModelFamily.create({
    data: { vendorId: vendor.id, name: 'PW C9000 Family' },
  })
  const model = await prisma.deviceModel.create({
    data: {
      vendorId: vendor.id,
      deviceTypeId: deviceType.id,
      familyId: family.id,
      model: 'PW-C9300',
      platform: 'IOS XE',
    },
  })
  modelId = model.id

  const preferredTrain = await prisma.firmwareTrain.create({
    data: {
      vendorId: vendor.id,
      platform: 'IOS XE',
      name: '17.15',
      state: 'PREFERRED',
    },
  })
  const acceptedTrain = await prisma.firmwareTrain.create({
    data: {
      vendorId: vendor.id,
      platform: 'IOS XE',
      name: '17.12',
      state: 'ACCEPTED',
    },
  })

  const minimum = await prisma.firmwareRelease.create({
    data: {
      vendorId: vendor.id,
      firmwareTrainId: preferredTrain.id,
      platform: 'IOS XE',
      version: '17.15.4',
      logicalVersion: '17.15.4',
      catalogState: 'VERIFIED',
      policyEligibility: 'ALLOWED',
      status: 'APPROVED',
    },
  })
  const preferred = await prisma.firmwareRelease.create({
    data: {
      vendorId: vendor.id,
      firmwareTrainId: preferredTrain.id,
      platform: 'IOS XE',
      version: '17.15.5',
      logicalVersion: '17.15.5',
      catalogState: 'VERIFIED',
      policyEligibility: 'ALLOWED',
      status: 'APPROVED',
    },
  })
  const accepted = await prisma.firmwareRelease.create({
    data: {
      vendorId: vendor.id,
      firmwareTrainId: acceptedTrain.id,
      platform: 'IOS XE',
      version: '17.12.5',
      logicalVersion: '17.12.5',
      catalogState: 'VERIFIED',
      policyEligibility: 'ALLOWED',
      status: 'APPROVED',
    },
  })
  await prisma.firmwareRelease.create({
    data: {
      vendorId: vendor.id,
      platform: 'IOS XE',
      version: '17.15.7',
      logicalVersion: '17.15.7',
      catalogState: 'OBSERVED',
      policyEligibility: 'NOT_EVALUATED',
      status: 'AVAILABLE',
      source: 'IMPORT',
      externalProvider: 'Playwright',
    },
  })

  await prisma.firmwareTrain.update({
    where: { id: preferredTrain.id },
    data: {
      preferredFirmwareReleaseId: preferred.id,
      minimumAcceptableFirmwareReleaseId: minimum.id,
    },
  })
  await prisma.firmwareTrain.update({
    where: { id: acceptedTrain.id },
    data: { preferredFirmwareReleaseId: accepted.id },
  })

  await prisma.firmwareCompatibilityRule.createMany({
    data: [
      {
        vendorId: vendor.id,
        deviceModelFamilyId: family.id,
        platform: 'IOS XE',
        firmwareTrainId: preferredTrain.id,
        decision: 'DENY',
        sourceType: 'CATALOG',
        explanation: 'PW-C9300 family cannot use the preferred 17.15 train.',
      },
      {
        vendorId: vendor.id,
        deviceModelFamilyId: family.id,
        platform: 'IOS XE',
        firmwareTrainId: acceptedTrain.id,
        decision: 'ALLOW',
        sourceType: 'CATALOG',
        explanation: 'PW-C9300 family supports the accepted 17.12 train.',
      },
    ],
  })
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test('uses the train-centric catalog workflow end to end', async ({ page }) => {
  await page.goto('/firmware')
  await expect(page.getByRole('heading', { name: 'Firmware catalog', exact: true })).toBeVisible()
  await expect(
    page.getByRole('button').filter({ hasText: 'Playwright Firmware 106' }).filter({ hasText: 'IOS XE' }).first(),
  ).toBeVisible()

  const preferredRow = page.getByRole('row').filter({ hasText: '17.15' })
  await expect(preferredRow).toContainText('Preferred')
  await expect(preferredRow).toContainText('17.15.5')
  await expect(preferredRow).toContainText('17.15.4')

  await expect(page.getByText('1 firmware release needs review')).toBeVisible()
  await page.getByRole('button', { name: 'Review now' }).click()
  await expect(page.getByRole('link', { name: '17.15.7', exact: true }).last()).toBeVisible()
  await page.getByLabel('Train for 17.15.7').selectOption({ label: '17.15' })
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('17.15.7 marked allowed.')

  await page.getByRole('button', { name: 'Show all platform releases' }).click()
  const observedRelease = page
    .getByRole('link', { name: '17.15.7', exact: true })
    .last()
    .locator('xpath=ancestor::div[contains(@class,"p-3")][1]')
  await observedRelease.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByRole('status')).toContainText('17.15.7 archived.')
  await expect(page.getByRole('link', { name: '17.15.7', exact: true })).toHaveCount(0)

  await page.getByLabel('Show archived').check()
  const archivedRelease = page
    .getByRole('link', { name: '17.15.7', exact: true })
    .last()
    .locator('xpath=ancestor::div[contains(@class,"p-3")][1]')
  await expect(archivedRelease).toBeVisible()
  await expect(archivedRelease).toContainText('Archived')

  await page.getByRole('button', { name: 'Add release' }).first().click()
  const addForm = page.locator('form').filter({ hasText: 'Advanced details (optional)' })
  await addForm.getByLabel('Train', { exact: true }).selectOption({ label: '17.15 · PREFERRED' })
  await addForm.getByLabel('Version').fill('17.15.6')
  await addForm.getByLabel('Make preferred for this train').check()
  await addForm.getByRole('button', { name: 'Add release' }).click()
  await expect(page.getByRole('status')).toContainText('17.15.6 added to the catalog.')

  const updatedPreferredRow = page.getByRole('row').filter({ hasText: '17.15' })
  await expect(updatedPreferredRow).toContainText('17.15.6')

  await updatedPreferredRow.getByRole('link', { name: '17.15', exact: true }).click()
  await expect(page.getByRole('heading', { name: '17.15', exact: true })).toBeVisible()
  await page.getByLabel('Minimum acceptable').selectOption({ label: '17.15.5' })
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByRole('status')).toContainText('Train defaults updated.')
  await page.getByLabel('Minimum acceptable').selectOption({ label: '17.15.4' })
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(page.getByRole('status')).toContainText('Train defaults updated.')

  await page.goto(`/models/${modelId}`)
  await expect(page.getByRole('heading', { name: 'PW-C9300', exact: true })).toBeVisible()
  await page.getByText('Advanced compatibility evidence', { exact: true }).click()
  await expect(page.getByText('Default train: 17.12', { exact: true })).toBeVisible()
  await expect(page.getByText(/Preferred train 17\.15 is incompatible/)).toBeVisible()
})
