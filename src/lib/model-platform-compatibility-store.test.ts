import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  ruleUpdateMany: vi.fn(),
  ruleCreateMany: vi.fn(),
  releaseFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    firmwareRelease: { findMany: mocks.releaseFindMany },
    firmwareCompatibilityRule: { findMany: mocks.ruleFindMany },
    $transaction: mocks.transaction,
  },
}))

import {
  listConfiguredModelSupportedPlatforms,
  syncModelSupportedPlatforms,
} from '@/lib/model-platform-compatibility-store'

describe('model supported-platform synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ruleFindMany.mockResolvedValue([])
    mocks.releaseFindMany.mockResolvedValue([{ platform: 'AOS-S' }, { platform: 'AOS-S-v2' }])
    mocks.ruleUpdateMany.mockResolvedValue({ count: 0 })
    mocks.ruleCreateMany.mockResolvedValue({ count: 2 })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwareCompatibilityRule: {
        updateMany: mocks.ruleUpdateMany,
        createMany: mocks.ruleCreateMany,
      },
    }))
  })

  it('synchronizes one supported platform into broad ALLOW/DENY evidence', async () => {
    await syncModelSupportedPlatforms({
      deviceModelId: 'model-1',
      vendorId: 'vendor-1',
      supportedPlatforms: ['AOS-S'],
    })

    expect(mocks.ruleUpdateMany).toHaveBeenCalled()
    expect(mocks.ruleCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ platform: 'AOS-S', decision: 'ALLOW' }),
        expect.objectContaining({ platform: 'AOS-S-v2', decision: 'DENY' }),
      ]),
    })
  })

  it('supports more than one platform without vendor-specific evaluator code', async () => {
    await syncModelSupportedPlatforms({
      deviceModelId: 'model-1',
      vendorId: 'vendor-1',
      supportedPlatforms: ['AOS-S', 'AOS-S-v2'],
    })

    expect(mocks.ruleCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ platform: 'AOS-S', decision: 'ALLOW' }),
        expect.objectContaining({ platform: 'AOS-S-v2', decision: 'ALLOW' }),
      ]),
    })
  })

  it('leaves broad compatibility unknown when supported platforms are empty', async () => {
    await syncModelSupportedPlatforms({
      deviceModelId: 'model-1',
      vendorId: 'vendor-1',
      supportedPlatforms: [],
    })

    expect(mocks.ruleUpdateMany).toHaveBeenCalled()
    expect(mocks.ruleCreateMany).not.toHaveBeenCalled()
  })

  it('lists only configured broad ALLOW platforms as model supported platforms', async () => {
    mocks.ruleFindMany.mockResolvedValue([
      { deviceModelId: 'model-1', platform: 'AOS-S' },
      { deviceModelId: 'model-1', platform: 'AOS-S-v2' },
      { deviceModelId: 'model-2', platform: 'AOS-10' },
    ])
    const result = await listConfiguredModelSupportedPlatforms(['model-1', 'model-2'])
    expect(result.get('model-1')).toEqual(['AOS-S', 'AOS-S-v2'])
    expect(result.get('model-2')).toEqual(['AOS-10'])
  })
})
