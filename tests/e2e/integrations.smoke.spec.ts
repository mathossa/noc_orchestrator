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
  await expect(
    page.getByRole('link', { name: 'Add connection', exact: true }),
  ).toHaveAttribute('href', '/settings/integrations/auvik/new')
})

test('opens the Auvik connection creation flow without exposing a fake live connection', async ({ page }) => {
  await page.goto('/settings/integrations/auvik/new')

  await expect(
    page.getByRole('heading', { name: 'Add Auvik connection', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Name')).toBeVisible()
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
