import { expect, request as playwrightRequest, test as setup } from '@playwright/test'
import { hashPassword } from 'better-auth/crypto'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { prisma } from '../../src/lib/prisma'

// Entirely synthetic, disposable E2E identities. The test runner provisions a
// separate PostgreSQL container and resets it before starting Playwright.
export const ADMIN_EMAIL = 'playwright-admin@example.invalid'
export const USER_EMAIL = 'playwright-reader@example.invalid'
export const TEST_PASSWORD = 'Synthetic-e2e-only-password-2026!'
const baseURL = 'http://127.0.0.1:3100'
const adminState = 'test-results/playwright/.auth/administrator.json'
const userState = 'test-results/playwright/.auth/non-admin.json'

async function seedUser(email: string, role: 'admin' | 'user') {
  const user = await prisma.user.create({
    data: { name: role === 'admin' ? 'Synthetic Administrator' : 'Synthetic Reader', email, emailVerified: true, role },
  })
  await prisma.authAccount.create({
    data: {
      userId: user.id,
      providerId: 'credential',
      issuer: 'local:credential',
      accountId: user.id,
      password: await hashPassword(TEST_PASSWORD),
    },
  })
}

setup('create synthetic sessions for integration smoke and security tests', async ({ request }) => {
  await seedUser(ADMIN_EMAIL, 'admin')
  await seedUser(USER_EMAIL, 'user')
  await mkdir(dirname(adminState), { recursive: true })

  async function signIn(email: string, state: string, context = request) {
    const response = await context.post(baseURL + '/api/auth/sign-in/email', {
      data: { email, password: TEST_PASSWORD },
    })
    expect(response.ok(), 'Synthetic E2E sign-in must succeed').toBeTruthy()
    await context.storageState({ path: state })
  }

  await signIn(ADMIN_EMAIL, adminState)
  // Distinct cookie jar: an admin session must never bleed into a non-admin test.
  const nonAdminContext = await playwrightRequest.newContext({ baseURL })
  try {
    await signIn(USER_EMAIL, userState, nonAdminContext)
  } finally {
    await nonAdminContext.dispose()
    await prisma.$disconnect()
  }
})
