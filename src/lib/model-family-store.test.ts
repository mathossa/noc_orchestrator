import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  familyFindMany: vi.fn(),
  familyFindUnique: vi.fn(),
  familyCreate: vi.fn(),
  familyUpdate: vi.fn(),
  familyDelete: vi.fn(),
  vendorFindUnique: vi.fn(),
  modelCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModelFamily: {
      findMany: mocks.familyFindMany,
      findUnique: mocks.familyFindUnique,
      create: mocks.familyCreate,
      update: mocks.familyUpdate,
      delete: mocks.familyDelete,
    },
    vendor: { findUnique: mocks.vendorFindUnique },
    deviceModel: { count: mocks.modelCount },
  },
}))

import {
  createDeviceModelFamily,
  deleteDeviceModelFamily,
  DeviceModelFamilyConflictError,
  DeviceModelFamilyInUseError,
  updateDeviceModelFamily,
} from '@/lib/model-family-store'

const now = new Date('2026-09-01T12:00:00Z')
const baseFamily = {
  id: 'family-2530',
  vendorId: 'vendor-aruba',
  name: '2530',
  notes: null,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  vendor: { id: 'vendor-aruba', code: 'ARUBA', name: 'Aruba', isActive: true },
  _count: { models: 0 },
}

describe('device model family persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-aruba' })
    mocks.familyFindMany.mockResolvedValue([])
    mocks.familyCreate.mockResolvedValue(baseFamily)
    mocks.modelCount.mockResolvedValue(0)
  })

  it('creates a vendor-scoped family / series', async () => {
    const result = await createDeviceModelFamily({ vendorId: 'vendor-aruba', name: '2530' })

    expect(mocks.familyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { vendorId: 'vendor-aruba', name: '2530', notes: null, isActive: true },
    }))
    expect(result).toMatchObject({ id: 'family-2530', name: '2530', modelCount: 0 })
  })

  it('rejects normalized duplicate family names within the same vendor', async () => {
    mocks.familyFindMany.mockResolvedValue([{ id: 'existing', name: '  2530  ' }])

    await expect(createDeviceModelFamily({ vendorId: 'vendor-aruba', name: '2530' }))
      .rejects.toBeInstanceOf(DeviceModelFamilyConflictError)
    expect(mocks.familyCreate).not.toHaveBeenCalled()
  })

  it('allows the same family label for another vendor', async () => {
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-other' })
    mocks.familyCreate.mockResolvedValue({
      ...baseFamily,
      id: 'other-2530',
      vendorId: 'vendor-other',
      vendor: { id: 'vendor-other', code: 'OTHER', name: 'Other', isActive: true },
    })

    await createDeviceModelFamily({ vendorId: 'vendor-other', name: '2530' })
    expect(mocks.familyFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: 'vendor-other' } }))
  })

  it('blocks moving a populated family to another vendor', async () => {
    mocks.familyFindUnique.mockResolvedValue({
      id: 'family-2530', vendorId: 'vendor-aruba', name: '2530', notes: null, isActive: true,
    })
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-cisco' })
    mocks.modelCount.mockResolvedValue(2)

    await expect(updateDeviceModelFamily('family-2530', { vendorId: 'vendor-cisco' }))
      .rejects.toBeInstanceOf(DeviceModelFamilyInUseError)
    expect(mocks.familyUpdate).not.toHaveBeenCalled()
  })

  it('blocks deleting a family while concrete models reference it', async () => {
    mocks.familyFindUnique.mockResolvedValue({ id: 'family-2530', name: '2530' })
    mocks.modelCount.mockResolvedValue(3)

    await expect(deleteDeviceModelFamily('family-2530')).rejects.toBeInstanceOf(DeviceModelFamilyInUseError)
    expect(mocks.familyDelete).not.toHaveBeenCalled()
  })
})
