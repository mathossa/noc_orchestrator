import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  trainFindMany: vi.fn(),
  trainFindUnique: vi.fn(),
  trainCreate: vi.fn(),
  trainUpdate: vi.fn(),
  trainUpdateMany: vi.fn(),
  trainDelete: vi.fn(),
  releaseFindMany: vi.fn(),
  releaseCount: vi.fn(),
  auditCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vendor: { findUnique: mocks.vendorFindUnique },
    firmwareTrain: {
      findMany: mocks.trainFindMany,
      findUnique: mocks.trainFindUnique,
      create: mocks.trainCreate,
      update: mocks.trainUpdate,
      updateMany: mocks.trainUpdateMany,
      delete: mocks.trainDelete,
    },
    firmwareRelease: { findMany: mocks.releaseFindMany, count: mocks.releaseCount },
    auditEvent: { count: mocks.auditCount },
  },
}))

import {
  createFirmwareTrain,
  deleteFirmwareTrain,
  FirmwareTrainConflictError,
  FirmwareTrainInUseError,
  updateFirmwareTrain,
} from '@/lib/firmware-train-store'

const vendor = { id: 'vendor-1', code: 'FORTINET', name: 'Fortinet', isActive: true }
const storedTrain = {
  id: 'train-1',
  vendorId: 'vendor-1',
  vendor,
  platform: 'FortiOS',
  name: '8.13.x',
  state: 'ACCEPTED',
  preferredFirmwareReleaseId: null,
  minimumAcceptableFirmwareReleaseId: null,
  preferredRelease: null,
  minimumAcceptableRelease: null,
  notes: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  releases: [],
  _count: { releases: 0 },
}

describe('firmware train persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1', code: 'FORTINET' })
    mocks.trainFindMany.mockResolvedValue([])
    mocks.trainUpdateMany.mockResolvedValue({ count: 0 })
    mocks.releaseFindMany.mockResolvedValue([])
  })

  it('creates an explicit train without deriving releases', async () => {
    mocks.trainCreate.mockResolvedValue(storedTrain)
    const result = await createFirmwareTrain({ vendorId: 'vendor-1', platform: 'FortiOS', name: '8.13.x' })
    expect(result.name).toBe('8.13.x')
    expect(result.releaseCount).toBe(0)
  })

  it('rejects normalized duplicate train names in the same vendor/platform', async () => {
    mocks.trainFindMany.mockResolvedValue([{ id: 'existing', platform: ' fortios ', name: '8.13.X' }])
    await expect(createFirmwareTrain({ vendorId: 'vendor-1', platform: 'FortiOS', name: '8.13.x' })).rejects.toBeInstanceOf(FirmwareTrainConflictError)
    expect(mocks.trainCreate).not.toHaveBeenCalled()
  })

  it('supports archive-only PATCH without changing train identity', async () => {
    mocks.trainFindUnique.mockResolvedValue({
      id: 'train-1',
      vendorId: 'vendor-1',
      platform: 'FortiOS',
      name: '8.13.x',
      notes: null,
      isActive: true,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
    })
    mocks.trainFindMany.mockResolvedValue([{ id: 'train-1', platform: 'FortiOS', name: '8.13.x' }])
    mocks.trainUpdate.mockResolvedValue({ ...storedTrain, isActive: false })

    await updateFirmwareTrain('train-1', { isActive: false })
    expect(mocks.trainUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'train-1' },
      data: expect.objectContaining({ vendorId: 'vendor-1', platform: 'FortiOS', name: '8.13.x', isActive: false }),
    }))
  })

  it('makes one train platform-preferred by demoting the previous preferred train', async () => {
    mocks.trainFindUnique.mockResolvedValue({
      ...storedTrain,
      state: 'ACCEPTED',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mocks.trainFindMany.mockResolvedValue([{ id: 'train-1', platform: 'FortiOS', name: '8.13.x' }])
    mocks.trainUpdate.mockResolvedValue({ ...storedTrain, state: 'PREFERRED' })

    await updateFirmwareTrain('train-1', { state: 'PREFERRED' })

    expect(mocks.trainUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { not: 'train-1' },
        vendorId: 'vendor-1',
        platform: 'FortiOS',
        state: 'PREFERRED',
        isActive: true,
      }),
      data: { state: 'ACCEPTED' },
    }))
  })

  it('rejects a blocked release as a preferred train target', async () => {
    mocks.trainFindUnique.mockResolvedValue({
      ...storedTrain,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mocks.trainFindMany.mockResolvedValue([{ id: 'train-1', platform: 'FortiOS', name: '8.13.x' }])
    mocks.releaseFindMany.mockResolvedValue([{
      id: 'blocked',
      firmwareTrainId: 'train-1',
      vendorId: 'vendor-1',
      platform: 'FortiOS',
      version: '8.13.2',
      catalogState: 'BLOCKED',
      policyEligibility: 'DISALLOWED',
      isActive: true,
    }])

    await expect(updateFirmwareTrain('train-1', { preferredFirmwareReleaseId: 'blocked' }))
      .rejects.toBeInstanceOf(expect.any(Error).constructor)
    expect(mocks.trainUpdate).not.toHaveBeenCalled()
  })

  it('rejects a minimum newer than the preferred release using the shared comparator', async () => {
    mocks.trainFindUnique.mockResolvedValue({
      ...storedTrain,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mocks.trainFindMany.mockResolvedValue([{ id: 'train-1', platform: 'FortiOS', name: '8.13.x' }])
    mocks.releaseFindMany.mockResolvedValue([
      {
        id: 'preferred',
        firmwareTrainId: 'train-1',
        vendorId: 'vendor-1',
        platform: 'FortiOS',
        version: '7.4.10',
        catalogState: 'VERIFIED',
        policyEligibility: 'ALLOWED',
        isActive: true,
      },
      {
        id: 'minimum',
        firmwareTrainId: 'train-1',
        vendorId: 'vendor-1',
        platform: 'FortiOS',
        version: '7.4.11',
        catalogState: 'VERIFIED',
        policyEligibility: 'ALLOWED',
        isActive: true,
      },
    ])

    await expect(updateFirmwareTrain('train-1', {
      preferredFirmwareReleaseId: 'preferred',
      minimumAcceptableFirmwareReleaseId: 'minimum',
    })).rejects.toThrow('Minimum acceptable release cannot be newer than the preferred release.')
  })

    it('blocks permanent deletion while releases reference the train', async () => {
    mocks.trainFindUnique.mockResolvedValue({ id: 'train-1' })
    mocks.releaseCount.mockResolvedValue(2)
    mocks.auditCount.mockResolvedValue(0)
    await expect(deleteFirmwareTrain('train-1')).rejects.toBeInstanceOf(FirmwareTrainInUseError)
    expect(mocks.trainDelete).not.toHaveBeenCalled()
  })
})
