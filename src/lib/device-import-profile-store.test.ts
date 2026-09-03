import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportProfile: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
  },
}))

import {
  DeviceImportProfileError,
  listDeviceImportProfiles,
  saveDeviceImportProfile,
} from '@/lib/device-import-profile-store'

const settings = {
  sheetName: 'Devices',
  headerRow: 1,
  mapping: {
    '0': 'organizationSite',
    '1': 'hostname',
    '2': 'firmwareVersion',
    '3': 'softwareVersion',
  },
  defaults: {
    customerId: null,
    siteId: null,
    externalProvider: 'Auvik',
  },
  organizationSiteDelimiter: ' - ',
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    name: 'AUVIK EXPORT',
    externalProvider: 'Auvik',
    settings,
    isActive: true,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    updatedAt: new Date('2026-09-01T12:00:00Z'),
    ...overrides,
  }
}

describe('device XLSX import profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue(null)
    mocks.create.mockResolvedValue(record())
    mocks.update.mockResolvedValue(record())
    mocks.findMany.mockResolvedValue([record()])
  })

  it('persists a reusable exporter mapping and provider', async () => {
    const result = await saveDeviceImportProfile({
      name: 'AUVIK EXPORT',
      externalProvider: 'Auvik',
      settings,
    })

    expect(result).toMatchObject({
      id: 'profile-1',
      name: 'AUVIK EXPORT',
      externalProvider: 'Auvik',
      settings: expect.objectContaining({
        sheetName: 'Devices',
        mapping: expect.objectContaining({ '0': 'organizationSite', '2': 'firmwareVersion' }),
        organizationSiteDelimiter: ' - ',
      }),
    })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'AUVIK EXPORT', externalProvider: 'Auvik' }),
    }))
  })

  it('updates the selected saved profile instead of creating another profile', async () => {
    await saveDeviceImportProfile({
      id: 'profile-1',
      name: 'AUVIK EXPORT',
      externalProvider: 'Auvik',
      settings,
    })

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'profile-1' } }))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('returns saved profiles with validated settings', async () => {
    const result = await listDeviceImportProfiles()
    expect(result).toHaveLength(1)
    expect(result[0].settings.mapping['0']).toBe('organizationSite')
  })

  it('rejects duplicate profile names', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'other-profile' })
    await expect(saveDeviceImportProfile({
      name: 'AUVIK EXPORT',
      externalProvider: 'Auvik',
      settings,
    })).rejects.toBeInstanceOf(DeviceImportProfileError)
  })
})
