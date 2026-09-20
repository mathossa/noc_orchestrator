import { expect, test } from '@playwright/test'

test('creates a customer and opens its lifecycle detail', async ({ page }) => {
  const customerName = 'Playwright Smoke Customer'

  await page.goto('/customers')
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()

  await page.getByLabel('Name').fill(customerName)
  await page.getByLabel('Code').fill('PW-SMOKE')
  await page.getByRole('button', { name: 'Create customer' }).click()

  await expect(page.getByRole('status')).toContainText('Customer created.')
  const customerLink = page.getByRole('link', { name: customerName })
  await expect(customerLink).toBeVisible()

  await customerLink.click()
  await expect(page).toHaveURL(/\/customers\/[^/]+$/)
  await expect(page.getByRole('heading', { name: customerName, exact: true })).toBeVisible()
  await expect(page.getByText('Technical firmware state')).toBeVisible()
})
