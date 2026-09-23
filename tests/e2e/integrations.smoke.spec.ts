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
})
