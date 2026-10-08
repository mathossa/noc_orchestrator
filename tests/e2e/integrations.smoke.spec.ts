import { expect, test } from '@playwright/test'

test('opens the generic integrations foundation from Settings', async ({ page }) => {
  await page.goto('/settings/integrations')

  await expect(
    page.getByRole('heading', { name: 'Integrations', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('XLSX file upload', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Inventory sources', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Inventory Sync Profiles', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Import XLSX' })).toHaveAttribute(
    'href',
    '/devices/import',
  )
  await expect(
    page.getByRole('link', { name: 'Manage import automation' }),
  ).toHaveAttribute('href', '/settings/integrations/import-automation')
  await expect(
    page.getByText('Auvik Network Management', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Cisco Meraki Dashboard', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'API setup help for Auvik Network Management' }),
  ).toHaveAttribute('href', '/settings/integrations/help/auvik')
  await expect(
    page.getByRole('link', { name: 'API setup help for Cisco Meraki Dashboard' }),
  ).toHaveAttribute('href', '/settings/integrations/help/meraki')
  await expect(page.getByRole('link', { name: 'Add Meraki connection' })).toHaveAttribute(
    'href',
    '/settings/integrations/meraki/new',
  )
  await expect(
    page.locator('a[href="/settings/integrations/auvik/new"]').filter({ hasText: 'Add connection' }),
  ).toHaveAttribute('href', '/settings/integrations/auvik/new')
})

test('opens the Auvik connection creation flow without exposing a fake live connection', async ({ page }) => {
  await page.goto('/settings/integrations/auvik/new')

  await expect(
    page.getByRole('heading', { name: 'Add Auvik connection', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Name', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Region')).toBeVisible()
  await expect(page.getByLabel('Auvik username')).toBeVisible()
  await expect(page.getByLabel('API key')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add tenant' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save Auvik connection' }),
  ).toBeVisible()
})

test('opens saved importer rules and exact mappings management', async ({ page }) => {
  await page.goto('/settings/integrations/import-automation')

  await expect(
    page.getByRole('heading', { name: 'Import automation', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Rules/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Exact mappings/ })).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Search import automations' }),
  ).toBeVisible()
  await expect(
    page.getByText(/Saved importer decisions are versioned/),
  ).toBeVisible()
})


test('opens the Cisco Meraki connection creation flow', async ({ page }) => {
  await page.goto('/settings/integrations/meraki/new')
  await expect(page.getByRole('heading', { name: 'Add Cisco Meraki connection', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible()
  await expect(page.getByLabel('API environment')).toBeVisible()
  await expect(page.getByLabel('Dashboard API key')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save Meraki connection' })).toBeVisible()
})

test('opens Auvik API user setup from the integration overview and creation form', async ({ page }) => {
  await page.goto('/settings/integrations')
  await page.getByRole('link', { name: 'API setup help for Auvik Network Management' }).click()

  await expect(page.getByRole('heading', { name: 'API setup: Auvik Network Management' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. Create the API account' })).toBeVisible()
  await expect(page.getByText(/API Access Only role or a more restricted custom API role/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Auvik – user profile and API key management/ }))
    .toHaveAttribute('href', 'https://support.auvik.com/hc/en-us/articles/204309114-How-do-I-update-my-user-profile')

  await page.getByRole('link', { name: 'Add connection', exact: true }).click()
  await expect(page.getByRole('link', { name: 'API setup help for Auvik Network Management' }))
    .toHaveAttribute('href', '/settings/integrations/help/auvik')
})

test('opens Meraki API user setup from the creation form', async ({ page }) => {
  await page.goto('/settings/integrations/meraki/new')
  await page.getByRole('link', { name: 'API setup help for Cisco Meraki Dashboard' }).click()

  await expect(page.getByRole('heading', { name: 'API setup: Cisco Meraki Dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. Enable API access and create the account' })).toBeVisible()
  await expect(page.getByText(/read-only organization or appropriately scoped network access/)).toBeVisible()
  await expect(page.getByText(/Authorization: Bearer/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Cisco Meraki – Dashboard API authorization/ }))
    .toHaveAttribute('href', 'https://developer.cisco.com/meraki/api-v1/authorization/')
})
