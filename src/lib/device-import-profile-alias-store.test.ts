import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profileFindUnique: vi.fn(),
  aliasDeleteMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportProfile: { findUnique: mocks.profileFindUnique },
    deviceImportProfileAlias: { deleteMany: mocks.aliasDeleteMany },
  },
}))

import { deleteImportProfileAliases } from '@/lib/device-import-profile-alias-store'

describe('import profile learned mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profileFindUnique.mockResolvedValue({ id: 'profile-1' })
    mocks.aliasDeleteMany.mockResolvedValue({ count: 2 })
  })

  it('forgets selected learned mappings only inside the selected profile', async () => {
    await expect(deleteImportProfileAliases('profile-1', ['alias-1', 'alias-2', 'alias-1'])).resolves.toEqual({ deleted: 2 })
    expect(mocks.aliasDeleteMany).toHaveBeenCalledWith({
      where: {
        profileId: 'profile-1',
        id: { in: ['alias-1', 'alias-2'] },
      },
    })
  })
})
