import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  trainFindMany: vi.fn(),
  trainFindUnique: vi.fn(),
  trainCreate: vi.fn(),
  trainUpdate: vi.fn(),
  trainDelete: vi.fn(),
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
      delete: mocks.trainDelete,
    },
    firmwareRelease: { count: mocks.releaseCount },
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
  notes: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  _count: { releases: 0 },
}

describe('firmware train persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1' })
    mocks.trainFindMany.mockResolvedValue([])
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

  it('blocks permanent deletion while releases reference the train', async () => {
    mocks.trainFindUnique.mockResolvedValue({ id: 'train-1' })
    mocks.releaseCount.mockResolvedValue(2)
    mocks.auditCount.mockResolvedValue(0)
    await expect(deleteFirmwareTrain('train-1')).rejects.toBeInstanceOf(FirmwareTrainInUseError)
    expect(mocks.trainDelete).not.toHaveBeenCalled()
  })
})
