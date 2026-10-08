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
    page.getByRole('button', { name: 'API setup help for Auvik Network Management' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'API setup help for Cisco Meraki Dashboard' }),
  ).toBeVisible()
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

test('opens contextual Auvik help without navigation or losing unsaved credentials', async ({ page }) => {
  await page.goto('/settings/integrations/auvik/new')
  await page.getByLabel('Auvik username').fill('svc-noc@example.invalid')
  await page.getByLabel('API key').fill('test-only-not-a-real-secret')
  await page.getByLabel('Region').fill('eu1')

  await page.getByRole('button', { name: 'API setup help for Auvik Network Management' }).click()
  const guide = page.getByRole('dialog', { name: 'API setup: Auvik Network Management' })
  await expect(guide).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/integrations\/auvik\/new$/)
  await expect(guide.getByRole('heading', { name: '1. Create the API account' })).toBeVisible()
  await expect(guide.getByText(/API Access Only role or a more restricted custom API role/)).toBeVisible()

  await guide.getByText('Official vendor guides and screenshots').click()
  await expect(guide.getByRole('link', { name: /Auvik – user profile and API key management/ }))
    .toHaveAttribute('href', 'https://support.auvik.com/hc/en-us/articles/204309114-How-do-I-update-my-user-profile')
  await guide.getByRole('button', { name: 'Back to connection' }).click()
  await expect(guide).toHaveCount(0)

  await expect(page.getByLabel('Auvik username')).toHaveValue('svc-noc@example.invalid')
  await expect(page.getByLabel('API key')).toHaveValue('test-only-not-a-real-secret')
  await expect(page.getByLabel('Region')).toHaveValue('eu1')
})

test('opens Meraki API help in place and restores focus on Escape', async ({ page }) => {
  await page.goto('/settings/integrations/meraki/new')
  await page.getByLabel('Dashboard API key').fill('dummy-meraki-value')
  const help = page.getByRole('button', { name: 'API setup help for Cisco Meraki Dashboard' })
  await help.focus()
  await page.keyboard.press('Enter')

  const guide = page.getByRole('dialog', { name: 'API setup: Cisco Meraki Dashboard' })
  await expect(guide).toBeVisible()
  await expect(guide.getByRole('heading', { name: '1. Enable API access and create the account' })).toBeVisible()
  await expect(guide.getByText(/read-only organization or appropriately scoped network access/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(guide).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings\/integrations\/meraki\/new$/)
  await expect(page.getByLabel('Dashboard API key')).toHaveValue('dummy-meraki-value')
  await expect(help).toBeFocused()
})

test('shows fixed help actions on the integrations overview', async ({ page }) => {
  await page.goto('/settings/integrations')
  await page.getByRole('button', { name: 'API setup help for Auvik Network Management' }).click()
  const guide = page.getByRole('dialog', { name: 'API setup: Auvik Network Management' })
  await expect(guide.getByLabel('API connection setup sequence')).toBeVisible()
  await guide.getByRole('button', { name: 'Close API setup: Auvik Network Management' }).click()
  await expect(guide).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings\/integrations$/)
})

test('supports a bookmarkable full Meraki guide', async ({ page }) => {
  await page.goto('/settings/integrations/help/meraki')
  await expect(page.getByRole('heading', { name: 'API setup: Cisco Meraki Dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '2. Generate the API key' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add connection', exact: true }))
    .toHaveAttribute('href', '/settings/integrations/meraki/new')
})
