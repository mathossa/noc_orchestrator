import { expect, test } from '@playwright/test'

// The default browser project is signed in as the synthetic administrator.
test('administrator can access protected integration screens and inventory APIs', async ({ page, request }) => {
  await page.goto('/settings/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible()
  const result = await request.get('/api/v1/customers')
  expect(result.status()).toBe(200)
  expect(result.headers()['cache-control']).toContain('no-store')
})

test.describe('anonymous visitor', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('redirects protected page and returns 401 on protected API methods', async ({ page, request }) => {
    await page.goto('/settings/integrations')
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
    for (const [method, url] of [
      ['GET', '/api/v1/devices'],
      ['POST', '/api/v1/devices'],
      ['PATCH', '/api/v1/devices/synthetic-id'],
      ['DELETE', '/api/v1/devices/synthetic-id'],
    ] as const) {
      const response = await request.fetch(url, { method })
      expect(response.status()).toBe(401)
      expect(response.headers()['cache-control']).toContain('no-store')
    }
  })

  test('keeps health and Better Auth available, including anonymous session reads', async ({ request }) => {
    expect((await request.get('/api/v1/health')).status()).toBe(200)
    expect((await request.get('/api/auth/get-session')).status()).toBe(200)
  })

  test('rejects an invalid or expired-looking session cookie', async ({ request }) => {
    const response = await request.get('/api/v1/customers', {
      headers: { cookie: 'better-auth.session_token=synthetic-expired-token' },
    })
    expect(response.status()).toBe(401)
  })

  test('supports email login and logout using synthetic administrator', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill('playwright-admin@example.invalid')
    await page.getByLabel('Password').fill('Synthetic-e2e-only-password-2026!')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await page.goto('/customers')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe('authenticated non-administrator', () => {
  test.use({ storageState: 'test-results/playwright/.auth/non-admin.json' })

  test('receives 403 from data APIs and cannot visit customer pages', async ({ page, request }) => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      const response = await request.fetch('/api/v1/customers', { method })
      expect(response.status()).toBe(403)
    }
    await page.goto('/customers')
    await expect(page).toHaveURL(/\/sign-in\?error=forbidden/)
  })
})
