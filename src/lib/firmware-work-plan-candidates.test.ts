import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: {
      findMany: mocks.findMany,
    },
  },
}))

import {
  FirmwareWorkPlanCandidateError,
  listFirmwareWorkPlanCandidates,
  parseFirmwareWorkPlanCandidateScope,
} from './firmware-work-plan-candidates'

describe('firmware work plan candidate scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes and de-duplicates selected site and DeviceType IDs', () => {
    expect(
      parseFirmwareWorkPlanCandidateScope({
        siteIds: ['site-b', ' site-a ', 'site-a'],
        deviceTypeIds: ['type-switch', 'type-ap', 'type-switch'],
      }),
    ).toEqual({
      siteIds: ['site-a', 'site-b'],
      deviceTypeIds: ['type-ap', 'type-switch'],
    })
  })

  it('requires both a site scope and a device-type scope', () => {
    expect(() =>
      parseFirmwareWorkPlanCandidateScope({
        siteIds: [],
        deviceTypeIds: ['type-switch'],
      }),
    ).toThrow(FirmwareWorkPlanCandidateError)

    expect(() =>
      parseFirmwareWorkPlanCandidateScope({
        siteIds: ['site-a'],
        deviceTypeIds: [],
      }),
    ).toThrow(FirmwareWorkPlanCandidateError)
  })

  it('resolves all matching active devices without pagination or firmware business rules', async () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      id: `device-${index + 1}`,
    }))
    mocks.findMany.mockResolvedValue(rows)

    await expect(
      listFirmwareWorkPlanCandidates({
        siteIds: ['site-a', 'site-b'],
        deviceTypeIds: ['type-switch', 'type-ap'],
      }),
    ).resolves.toEqual(rows)

    expect(mocks.findMany).toHaveBeenCalledTimes(1)
    const query = mocks.findMany.mock.calls[0][0]
    expect(query.where).toEqual({
      isActive: true,
      siteId: { in: ['site-a', 'site-b'] },
      deviceModel: {
        deviceTypeId: { in: ['type-ap', 'type-switch'] },
      },
    })
    expect(query).not.toHaveProperty('take')
    expect(query).not.toHaveProperty('skip')
  })
})
