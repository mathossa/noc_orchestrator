import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  vendorFindMany: vi.fn(),
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
  updateFirmwareRelease,
} from '@/lib/firmware-release-store'

const vendor = { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true }
const storedRelease = {
  id: 'release-1',
  vendorId: 'vendor-1',
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
        platform: 'IOS XE',
        version: '17.15.5',
        status: 'AVAILABLE',
        isActive: true,
      }),
    }))
    expect(result.version).toBe('17.15.5')
    expect(mocks.policyCount).not.toHaveBeenCalled()
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

  it('supports archive-only PATCH without overwriting catalog identity', async () => {
    mocks.releaseFindUnique.mockResolvedValue({
      ...storedRelease,
      vendor: undefined,
      createdAt: new Date('2026-08-31T00:00:00Z'),
      updatedAt: new Date('2026-08-31T00:00:00Z'),
    })
    mocks.releaseUpdate.mockResolvedValue({ ...storedRelease, isActive: false })

    await updateFirmwareRelease('release-1', { isActive: false })

    expect(mocks.releaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'release-1' },
      data: expect.objectContaining({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', isActive: false }),
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
