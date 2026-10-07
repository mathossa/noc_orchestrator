import { describe, expect, it, vi } from 'vitest'

const capture = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
}))

vi.mock('better-auth', () => ({
  betterAuth: (config: Record<string, unknown>) => {
    capture.config = config
    return { api: {} }
  },
}))

vi.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: () => ({}),
}))

vi.mock('better-auth/plugins', () => ({
  admin: () => ({}),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

import '@/lib/auth'

describe('Better Auth configuration', () => {
  it('keeps Prisma joins disabled for the custom authentication model names', () => {
    expect(capture.config).not.toBeNull()

    const advanced = capture.config?.advanced as
      | { database?: Record<string, unknown> }
      | undefined

    expect(advanced?.database).toMatchObject({
      generateId: 'uuid',
    })
    expect(advanced?.database).not.toHaveProperty('joins')
    expect(capture.config?.account).toMatchObject({
      modelName: 'AuthAccount',
    })
  })
})
