import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  vendorFindMany: vi.fn(),
  trainFindUnique: vi.fn(),
  trainFindMany: vi.fn(),
  releaseFindMany: vi.fn(),
  releaseFindUnique: vi.fn(),
  releaseCreate: vi.fn(),
  releaseUpdate: vi.fn(),
  releaseDelete: vi.fn(),
  modelFindMany: vi.fn(),
  deviceCount: vi.fn(),
  policyCount: vi.fn(),
  lifecycleCount: vi.fn(),
  auditCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vendor: { findUnique: mocks.vendorFindUnique, findMany: mocks.vendorFindMany },
    firmwareTrain: { findUnique: mocks.trainFindUnique, findMany: mocks.trainFindMany },
    firmwareRelease: {
      findMany: mocks.releaseFindMany,
      findUnique: mocks.releaseFindUnique,
      create: mocks.releaseCreate,
      update: mocks.releaseUpdate,
      delete: mocks.releaseDelete,
    },
    deviceModel: { findMany: mocks.modelFindMany },
    device: { count: mocks.deviceCount },
    firmwarePolicy: { count: mocks.policyCount },
    firmwareLifecycleRecord: { count: mocks.lifecycleCount },
    auditEvent: { count: mocks.auditCount },
  },
}))

import {
  createFirmwareRelease,
  deleteFirmwareRelease,
  FirmwareReleaseConflictError,
  FirmwareReleaseInUseError,
  FirmwareReleaseReferenceError,
  updateFirmwareRelease,
} from '@/lib/firmware-release-store'

const vendor = { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true }
const storedRelease = {
  id: 'release-1',
  vendorId: 'vendor-1',
  firmwareTrainId: null,
  firmwareTrain: null,
  vendor,
  platform: 'IOS XE',
  version: '17.15.5',
  filename: null,
  sha256: null,
  fileSizeBytes: null,
  releaseNotesUrl: null,
  status: 'AVAILABLE',
  notes: null,
  releasedAt: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
}

describe('firmware release persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1' })
    mocks.releaseFindMany.mockResolvedValue([])
  })

  it('creates a manual firmware release without making it desired', async () => {
    mocks.releaseCreate.mockResolvedValue(storedRelease)

    const result = await createFirmwareRelease({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5' })

    expect(mocks.releaseCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vendorId: 'vendor-1',
        firmwareTrainId: null,
        platform: 'IOS XE',
        version: '17.15.5',
        status: 'AVAILABLE',
        isActive: true,
      }),
    }))
    expect(result.version).toBe('17.15.5')
    expect(mocks.policyCount).not.toHaveBeenCalled()
  })

  it('accepts an explicitly assigned train from the same vendor and normalized platform', async () => {
    const train = { id: 'train-1', vendorId: 'vendor-1', platform: ' ios   xe ', name: '17.15.x', isActive: true }
    mocks.trainFindUnique.mockResolvedValue(train)
    mocks.releaseCreate.mockResolvedValue({ ...storedRelease, firmwareTrainId: 'train-1', firmwareTrain: train })

    const result = await createFirmwareRelease({
      vendorId: 'vendor-1',
      firmwareTrainId: 'train-1',
      platform: 'IOS XE',
      version: '17.15.5',
    })

    expect(result.firmwareTrain?.name).toBe('17.15.x')
    expect(mocks.releaseCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firmwareTrainId: 'train-1' }),
    }))
  })

  it('rejects a train from another vendor or platform', async () => {
    mocks.trainFindUnique.mockResolvedValue({ id: 'train-1', vendorId: 'vendor-2', platform: 'IOS XE' })

    await expect(createFirmwareRelease({
      vendorId: 'vendor-1',
      firmwareTrainId: 'train-1',
      platform: 'IOS XE',
      version: '17.15.5',
    })).rejects.toBeInstanceOf(FirmwareReleaseReferenceError)

    expect(mocks.releaseCreate).not.toHaveBeenCalled()
  })

  it('rejects the same exact version on a case/whitespace-equivalent platform for one vendor', async () => {
    mocks.releaseFindMany.mockResolvedValue([{ id: 'existing', platform: ' ios   xe ' }])

    await expect(createFirmwareRelease({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5' })).rejects.toBeInstanceOf(FirmwareReleaseConflictError)
    expect(mocks.releaseCreate).not.toHaveBeenCalled()
  })

  it('allows the same platform to carry a different opaque version string', async () => {
    mocks.releaseFindMany.mockResolvedValue([])
    mocks.releaseCreate.mockResolvedValue({ ...storedRelease, version: '17.15.5a' })

    await createFirmwareRelease({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5a' })
    expect(mocks.releaseCreate).toHaveBeenCalled()
  })

  it('supports archive-only PATCH without overwriting catalog identity or train membership', async () => {
    mocks.releaseFindUnique.mockResolvedValue({
      ...storedRelease,
      firmwareTrainId: null,
      vendor: undefined,
      firmwareTrain: undefined,
      createdAt: new Date('2026-08-31T00:00:00Z'),
      updatedAt: new Date('2026-08-31T00:00:00Z'),
    })
    mocks.releaseUpdate.mockResolvedValue({ ...storedRelease, isActive: false })

    await updateFirmwareRelease('release-1', { isActive: false })

    expect(mocks.releaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'release-1' },
      data: expect.objectContaining({ vendorId: 'vendor-1', firmwareTrainId: null, platform: 'IOS XE', version: '17.15.5', isActive: false }),
    }))
  })

  it('blocks permanent deletion when policy/history/device references exist', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ id: 'release-1' })
    mocks.deviceCount.mockResolvedValue(0)
    mocks.policyCount.mockResolvedValue(1)
    mocks.lifecycleCount.mockResolvedValue(1)
    mocks.auditCount.mockResolvedValue(0)

    await expect(deleteFirmwareRelease('release-1')).rejects.toBeInstanceOf(FirmwareReleaseInUseError)
    expect(mocks.releaseDelete).not.toHaveBeenCalled()
  })
})
