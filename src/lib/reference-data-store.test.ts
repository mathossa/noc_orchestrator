import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vendorFindMany: vi.fn(),
  vendorCreate: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorUpdate: vi.fn(),
  vendorDelete: vi.fn(),
  deviceModelCount: vi.fn(),
  firmwareTrainCount: vi.fn(),
  firmwareReleaseCount: vi.fn(),
  firmwarePolicyCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vendor: {
      findMany: mocks.vendorFindMany,
      create: mocks.vendorCreate,
      findUnique: mocks.vendorFindUnique,
      update: mocks.vendorUpdate,
      delete: mocks.vendorDelete,
    },
    deviceType: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    contractType: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    deviceModel: { count: mocks.deviceModelCount },
    firmwareTrain: { count: mocks.firmwareTrainCount },
    firmwareRelease: { count: mocks.firmwareReleaseCount },
    firmwarePolicy: { count: mocks.firmwarePolicyCount },
    customer: { count: vi.fn() },
  },
}))

import {
  createReferenceRecord,
  deleteReferenceRecord,
  ReferenceConflictError,
  ReferenceInUseError,
  updateReferenceRecord,
} from '@/lib/reference-data-store'

describe('reference-data persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a vendor with canonical code and cleaned name', async () => {
    mocks.vendorFindMany.mockResolvedValue([])
    mocks.vendorCreate.mockImplementation(async ({ data }) => ({ id: 'vendor-1', ...data }))

    const result = await createReferenceRecord('vendors', {
      code: 'cisco_systems',
      name: '  Cisco   Systems ',
      websiteUrl: 'https://www.cisco.com',
    })

    expect(mocks.vendorCreate).toHaveBeenCalledWith({
      data: {
        code: 'CISCO-SYSTEMS',
        name: 'Cisco Systems',
        websiteUrl: 'https://www.cisco.com',
        isActive: true,
      },
    })
    expect(result).toMatchObject({ id: 'vendor-1', name: 'Cisco Systems' })
  })

  it('rejects a normalized duplicate name before creating', async () => {
    mocks.vendorFindMany.mockResolvedValue([{ id: 'vendor-1', code: 'CISCO', name: 'Cisco Systems' }])

    await expect(
      createReferenceRecord('vendors', { code: 'OTHER', name: '  CISCO   SYSTEMS  ' }),
    ).rejects.toBeInstanceOf(ReferenceConflictError)
    expect(mocks.vendorCreate).not.toHaveBeenCalled()
  })

  it('supports a partial PATCH for archive/reactivate', async () => {
    mocks.vendorFindUnique.mockResolvedValue({
      id: 'vendor-1',
      code: 'CISCO',
      name: 'Cisco',
      websiteUrl: null,
      isActive: true,
    })
    mocks.vendorFindMany.mockResolvedValue([{ id: 'vendor-1', code: 'CISCO', name: 'Cisco' }])
    mocks.vendorUpdate.mockImplementation(async ({ data }) => ({ id: 'vendor-1', ...data }))

    const result = await updateReferenceRecord('vendors', 'vendor-1', { isActive: false })

    expect(mocks.vendorUpdate).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
      data: { code: 'CISCO', name: 'Cisco', websiteUrl: null, isActive: false },
    })
    expect(result).toMatchObject({ id: 'vendor-1', isActive: false })
  })

  it('blocks deletion of a vendor referenced by models, trains, releases, or policies', async () => {
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1', name: 'Cisco' })
    mocks.deviceModelCount.mockResolvedValue(0)
    mocks.firmwareTrainCount.mockResolvedValue(1)
    mocks.firmwareReleaseCount.mockResolvedValue(0)
    mocks.firmwarePolicyCount.mockResolvedValue(0)

    await expect(deleteReferenceRecord('vendors', 'vendor-1')).rejects.toBeInstanceOf(ReferenceInUseError)
    expect(mocks.vendorDelete).not.toHaveBeenCalled()
  })

  it('permanently deletes an unreferenced vendor', async () => {
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1', name: 'Unused vendor' })
    mocks.deviceModelCount.mockResolvedValue(0)
    mocks.firmwareTrainCount.mockResolvedValue(0)
    mocks.firmwareReleaseCount.mockResolvedValue(0)
    mocks.firmwarePolicyCount.mockResolvedValue(0)
    mocks.vendorDelete.mockResolvedValue({ id: 'vendor-1' })

    await expect(deleteReferenceRecord('vendors', 'vendor-1')).resolves.toEqual({ id: 'vendor-1' })
    expect(mocks.vendorDelete).toHaveBeenCalledWith({ where: { id: 'vendor-1' } })
  })
})
