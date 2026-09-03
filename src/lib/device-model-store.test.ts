import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deviceModelFindMany: vi.fn(),
  deviceModelFindUnique: vi.fn(),
  deviceModelFindUniqueOrThrow: vi.fn(),
  deviceModelCreate: vi.fn(),
  deviceModelUpdate: vi.fn(),
  deviceModelDelete: vi.fn(),
  platformCreateMany: vi.fn(),
  platformDeleteMany: vi.fn(),
  familyFindUnique: vi.fn(),
  familyFindMany: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorFindMany: vi.fn(),
  deviceTypeFindUnique: vi.fn(),
  deviceTypeFindMany: vi.fn(),
  firmwareReleaseFindMany: vi.fn(),
  policyFindMany: vi.fn(),
  deviceCount: vi.fn(),
  policyCount: vi.fn(),
  auditFindMany: vi.fn(),
  auditCount: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: {
      findMany: mocks.deviceModelFindMany,
      findUnique: mocks.deviceModelFindUnique,
      findUniqueOrThrow: mocks.deviceModelFindUniqueOrThrow,
      create: mocks.deviceModelCreate,
      update: mocks.deviceModelUpdate,
      delete: mocks.deviceModelDelete,
    },
    deviceModelPlatform: {
      createMany: mocks.platformCreateMany,
      deleteMany: mocks.platformDeleteMany,
    },
    deviceModelFamily: { findUnique: mocks.familyFindUnique, findMany: mocks.familyFindMany },
    vendor: { findUnique: mocks.vendorFindUnique, findMany: mocks.vendorFindMany },
    deviceType: { findUnique: mocks.deviceTypeFindUnique, findMany: mocks.deviceTypeFindMany },
    firmwareRelease: { findMany: mocks.firmwareReleaseFindMany },
    device: { count: mocks.deviceCount },
    firmwarePolicy: { findMany: mocks.policyFindMany, count: mocks.policyCount },
    auditEvent: { findMany: mocks.auditFindMany, count: mocks.auditCount },
    $transaction: mocks.transaction,
  },
}))

import {
  createDeviceModel,
  deleteDeviceModel,
  DeviceModelInUseError,
  getDeviceModel,
  listDeviceModels,
} from '@/lib/device-model-store'

const now = new Date('2026-09-01T00:00:00Z')
const vendor = { id: 'vendor-aruba', code: 'ARUBA', name: 'Aruba', isActive: true }
const type = { id: 'type-ap', code: 'AP', name: 'Access Point', isActive: true }
const ap315Record = {
  id: 'ap315',
  vendorId: vendor.id,
  deviceTypeId: type.id,
  familyId: null,
  model: 'AP315',
  platform: null,
  supportedPlatforms: [
    { id: 'model-platform-8', platform: 'AOS-8' },
    { id: 'model-platform-10', platform: 'AOS-10' },
  ],
  notes: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  vendor,
  deviceType: type,
  family: null,
  _count: { devices: 0 },
}
const aos8Release = {
  id: 'fw-aos8', vendorId: vendor.id, platform: 'AOS-8', version: '8.10.0.20', status: 'APPROVED', isActive: true,
  releasedAt: now, firmwareTrain: null,
}
const aos10Release = {
  id: 'fw-aos10', vendorId: vendor.id, platform: 'AOS-10', version: '10.7.0.1', status: 'RECOMMENDED', isActive: true,
  releasedAt: now, firmwareTrain: null,
}

function policy(id: string, release: typeof aos8Release | typeof aos10Release) {
  return {
    id,
    targetFirmwareReleaseId: release.id,
    platform: release.platform,
    isActive: true,
    notes: null,
    deviceModelId: 'ap315',
    createdAt: now,
    updatedAt: now,
    targetFirmwareRelease: release,
  }
}

describe('device model multi-platform persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: vendor.id })
    mocks.deviceTypeFindUnique.mockResolvedValue({ id: type.id })
    mocks.familyFindUnique.mockResolvedValue(null)
    mocks.familyFindMany.mockResolvedValue([])
    mocks.deviceModelFindMany.mockResolvedValue([])
    mocks.firmwareReleaseFindMany.mockResolvedValue([])
    mocks.policyFindMany.mockResolvedValue([])
    mocks.auditFindMany.mockResolvedValue([])
    mocks.platformCreateMany.mockResolvedValue({ count: 0 })
    mocks.platformDeleteMany.mockResolvedValue({ count: 0 })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      deviceModel: {
        create: mocks.deviceModelCreate,
        update: mocks.deviceModelUpdate,
        findUniqueOrThrow: mocks.deviceModelFindUniqueOrThrow,
      },
      deviceModelPlatform: {
        createMany: mocks.platformCreateMany,
        deleteMany: mocks.platformDeleteMany,
      },
    }))
  })

  it('creates one AP315 hardware model with AOS-8 and AOS-10 as supported platforms', async () => {
    mocks.deviceModelCreate.mockResolvedValue({ id: 'ap315' })
    mocks.deviceModelFindUniqueOrThrow.mockResolvedValue(ap315Record)

    const result = await createDeviceModel({
      vendorId: vendor.id,
      deviceTypeId: type.id,
      model: 'AP315',
      supportedPlatforms: ['AOS-8', 'AOS-10'],
    })

    expect(mocks.deviceModelCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: vendor.id,
      deviceTypeId: type.id,
      model: 'AP315',
      platform: null,
    }) })
    expect(mocks.platformCreateMany).toHaveBeenCalledWith({
      data: [
        { deviceModelId: 'ap315', platform: 'AOS-8' },
        { deviceModelId: 'ap315', platform: 'AOS-10' },
      ],
      skipDuplicates: true,
    })
    expect(result.supportedPlatforms.map((entry) => entry.platform)).toEqual(['AOS-8', 'AOS-10'])
  })

  it('exposes one desired firmware target per supported AP315 platform', async () => {
    mocks.deviceModelFindUnique.mockResolvedValue({
      ...ap315Record,
      createdAt: now,
      updatedAt: now,
      _count: { devices: 2 },
      devices: [
        {
          id: 'ap-8', platform: 'AOS-8', customer: { id: 'customer-1', name: 'Acme' },
          currentFirmwareReleaseId: 'fw-aos8', currentFirmwareRelease: { id: 'fw-aos8', version: aos8Release.version, platform: 'AOS-8' }, lifecycle: null,
        },
        {
          id: 'ap-10', platform: 'AOS-10', customer: { id: 'customer-1', name: 'Acme' },
          currentFirmwareReleaseId: 'fw-aos10', currentFirmwareRelease: { id: 'fw-aos10', version: aos10Release.version, platform: 'AOS-10' }, lifecycle: null,
        },
      ],
    })
    mocks.policyFindMany.mockResolvedValue([
      policy('policy-8', aos8Release),
      policy('policy-10', aos10Release),
    ])
    mocks.firmwareReleaseFindMany.mockResolvedValue([aos8Release, aos10Release])

    const result = await getDeviceModel('ap315')

    expect(result.desiredFirmwareByPlatform).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'AOS-8', release: expect.objectContaining({ id: 'fw-aos8' }) }),
      expect.objectContaining({ platform: 'AOS-10', release: expect.objectContaining({ id: 'fw-aos10' }) }),
    ]))
    expect(result.availableFirmware.releases.map((release) => release.id)).toEqual(['fw-aos8', 'fw-aos10'])
    expect(result.technicalStateCounts.current).toBe(2)
  })

  it('keeps the normal model list compatible by showing the preferred/first platform target', async () => {
    mocks.deviceModelFindMany.mockResolvedValue([ap315Record])
    mocks.policyFindMany.mockResolvedValue([
      { deviceModelId: 'ap315', platform: 'AOS-8', targetFirmwareRelease: aos8Release },
      { deviceModelId: 'ap315', platform: 'AOS-10', targetFirmwareRelease: aos10Release },
    ])

    const result = await listDeviceModels()
    expect(result[0].model).toBe('AP315')
    expect(result[0].supportedPlatforms).toHaveLength(2)
    expect(result[0].desiredFirmwareRelease?.id).toBe('fw-aos8')
  })

  it('blocks destructive deletion while the model is referenced', async () => {
    mocks.deviceModelFindUnique.mockResolvedValue({ id: 'ap315', model: 'AP315' })
    mocks.deviceCount.mockResolvedValue(2)
    mocks.policyCount.mockResolvedValue(2)
    mocks.auditCount.mockResolvedValue(0)

    await expect(deleteDeviceModel('ap315')).rejects.toBeInstanceOf(DeviceModelInUseError)
    expect(mocks.deviceModelDelete).not.toHaveBeenCalled()
  })
})
