import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindUnique: vi.fn(),
  modelFindUnique: vi.fn(),
  firmwareFindUnique: vi.fn(),
  deviceFindMany: vi.fn(),
  deviceFindUnique: vi.fn(),
  deviceCreate: vi.fn(),
  deviceUpdate: vi.fn(),
  deviceDelete: vi.fn(),
  policyFindMany: vi.fn(),
  policyCount: vi.fn(),
  lifecycleCount: vi.fn(),
  auditFindMany: vi.fn(),
  auditCreate: vi.fn(),
  auditCount: vi.fn(),
  transaction: vi.fn(),
  assertSiteBelongsToCustomer: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: { findUnique: mocks.customerFindUnique, findMany: vi.fn() },
    site: { findMany: vi.fn() },
    deviceModel: { findUnique: mocks.modelFindUnique, findMany: vi.fn() },
    firmwareRelease: { findUnique: mocks.firmwareFindUnique, findMany: vi.fn() },
    device: {
      findMany: mocks.deviceFindMany,
      findUnique: mocks.deviceFindUnique,
      create: mocks.deviceCreate,
      update: mocks.deviceUpdate,
      delete: mocks.deviceDelete,
    },
    firmwarePolicy: { findMany: mocks.policyFindMany, count: mocks.policyCount },
    firmwareLifecycleRecord: { count: mocks.lifecycleCount },
    auditEvent: { findMany: mocks.auditFindMany, create: mocks.auditCreate, count: mocks.auditCount },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/site-store', () => ({
  SiteCustomerError: class SiteCustomerError extends Error {},
  assertSiteBelongsToCustomer: mocks.assertSiteBelongsToCustomer,
}))

import {
  createDevice,
  deleteDevice,
  DeviceConflictError,
  DeviceInUseError,
  DeviceReferenceError,
  getDevice,
} from '@/lib/device-store'

const now = new Date('2026-09-01T00:00:00Z')
const contract = {
  id: 'contract-1', code: 'FULL', name: 'Fully Managed', firmwareManagementEnabled: true, isActive: true,
}
const customer = {
  id: 'customer-1', code: 'ACME', name: 'Acme', isActive: true, contractType: contract,
}
const ciscoModel = {
  id: 'model-cisco',
  model: 'C9300-24P',
  platform: 'IOS XE',
  supportedPlatforms: [{ id: 'platform-iosxe', platform: 'IOS XE' }],
  isActive: true,
  vendor: { id: 'vendor-cisco', code: 'CISCO', name: 'Cisco', isActive: true },
  deviceType: { id: 'type-switch', code: 'SWITCH', name: 'Switch', isActive: true },
}
const ciscoRawModel = {
  id: 'model-cisco', vendorId: 'vendor-cisco', platform: 'IOS XE', supportedPlatforms: [{ platform: 'IOS XE' }],
}
const ap315RawModel = {
  id: 'ap315', vendorId: 'vendor-aruba', platform: null,
  supportedPlatforms: [{ platform: 'AOS-8' }, { platform: 'AOS-10' }],
}
const ap315Model = {
  id: 'ap315', model: 'AP315', platform: null,
  supportedPlatforms: [
    { id: 'platform-aos8', platform: 'AOS-8' },
    { id: 'platform-aos10', platform: 'AOS-10' },
  ],
  isActive: true,
  vendor: { id: 'vendor-aruba', code: 'ARUBA', name: 'Aruba', isActive: true },
  deviceType: { id: 'type-ap', code: 'AP', name: 'Access Point', isActive: true },
}
const aos8Release = {
  id: 'fw-aos8', vendorId: 'vendor-aruba', platform: 'AOS-8', version: '8.10.0.20', status: 'APPROVED', isActive: true,
  releasedAt: now, firmwareTrain: null,
}
const aos10Release = {
  id: 'fw-aos10', vendorId: 'vendor-aruba', platform: 'AOS-10', version: '10.7.0.1', status: 'APPROVED', isActive: true,
  releasedAt: now, firmwareTrain: null,
}

function storedDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    customerId: 'customer-1',
    siteId: null,
    deviceModelId: 'model-cisco',
    platform: 'IOS XE',
    name: 'HQ-SW-01',
    hostname: null,
    serialNumber: null,
    managementAddress: null,
    notes: null,
    currentFirmwareReleaseId: null,
    currentFirmwareObservedAt: null,
    currentFirmwareSource: 'MANUAL',
    isActive: true,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    customer,
    site: null,
    deviceModel: ciscoModel,
    currentFirmwareRelease: null,
    lifecycle: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function policy(id: string, platform: string, release: typeof aos8Release | typeof aos10Release) {
  return {
    id,
    targetFirmwareReleaseId: release.id,
    platform,
    isActive: true,
    notes: null,
    deviceModelId: 'ap315',
    createdAt: now,
    updatedAt: now,
    targetFirmwareRelease: release,
  }
}

describe('device inventory platform rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1' })
    mocks.modelFindUnique.mockResolvedValue(ciscoRawModel)
    mocks.firmwareFindUnique.mockResolvedValue(null)
    mocks.deviceFindMany.mockResolvedValue([])
    mocks.policyFindMany.mockResolvedValue([])
    mocks.auditFindMany.mockResolvedValue([])
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.assertSiteBelongsToCustomer.mockResolvedValue(null)
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      device: { create: mocks.deviceCreate, update: mocks.deviceUpdate },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('creates a single-platform device without requiring an extra platform choice', async () => {
    mocks.deviceCreate.mockResolvedValue(storedDevice())
    const result = await createDevice({ customerId: 'customer-1', deviceModelId: 'model-cisco', name: 'HQ-SW-01' })

    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platform: 'IOS XE' }),
    }))
    expect(result.platform).toBe('IOS XE')
  })

  it('infers AP315 AOS-10 from the concrete current firmware release', async () => {
    mocks.modelFindUnique.mockResolvedValue(ap315RawModel)
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'fw-aos10', vendorId: 'vendor-aruba', platform: 'AOS-10' })
    mocks.deviceCreate.mockResolvedValue(storedDevice({
      id: 'ap-10',
      deviceModelId: 'ap315',
      platform: 'AOS-10',
      name: 'HQ-AP-10',
      deviceModel: ap315Model,
      currentFirmwareReleaseId: 'fw-aos10',
      currentFirmwareRelease: aos10Release,
      currentFirmwareSource: 'IMPORT',
    }))

    const result = await createDevice({
      customerId: 'customer-1',
      deviceModelId: 'ap315',
      name: 'HQ-AP-10',
      currentFirmwareReleaseId: 'fw-aos10',
      currentFirmwareSource: 'IMPORT',
    })

    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platform: 'AOS-10', currentFirmwareReleaseId: 'fw-aos10' }),
    }))
    expect(result.platform).toBe('AOS-10')
  })

  it('requires review when a multi-platform AP315 has neither platform nor firmware evidence', async () => {
    mocks.modelFindUnique.mockResolvedValue(ap315RawModel)
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'ap315', name: 'HQ-AP-01' }))
      .rejects.toBeInstanceOf(DeviceReferenceError)
    expect(mocks.deviceCreate).not.toHaveBeenCalled()
  })

  it('rejects firmware that conflicts with an explicitly selected device platform', async () => {
    mocks.modelFindUnique.mockResolvedValue(ap315RawModel)
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'fw-aos10', vendorId: 'vendor-aruba', platform: 'AOS-10' })

    await expect(createDevice({
      customerId: 'customer-1',
      deviceModelId: 'ap315',
      platform: 'AOS-8',
      name: 'HQ-AP-01',
      currentFirmwareReleaseId: 'fw-aos10',
    })).rejects.toBeInstanceOf(DeviceReferenceError)
  })

  it('selects different desired firmware for two AP315 devices on AOS-8 and AOS-10', async () => {
    const policies = [policy('policy-10', 'AOS-10', aos10Release), policy('policy-8', 'AOS-8', aos8Release)]
    mocks.policyFindMany.mockResolvedValue(policies)
    mocks.deviceFindUnique
      .mockResolvedValueOnce(storedDevice({
        id: 'ap-8', deviceModelId: 'ap315', platform: 'AOS-8', name: 'HQ-AP-08', deviceModel: ap315Model,
        currentFirmwareReleaseId: 'fw-aos8', currentFirmwareRelease: aos8Release,
      }))
      .mockResolvedValueOnce(storedDevice({
        id: 'ap-10', deviceModelId: 'ap315', platform: 'AOS-10', name: 'HQ-AP-10', deviceModel: ap315Model,
        currentFirmwareReleaseId: 'fw-aos10', currentFirmwareRelease: aos10Release,
      }))

    const aos8Device = await getDevice('ap-8')
    const aos10Device = await getDevice('ap-10')

    expect(aos8Device.desiredFirmware.release).toMatchObject({ id: 'fw-aos8', platform: 'AOS-8' })
    expect(aos10Device.desiredFirmware.release).toMatchObject({ id: 'fw-aos10', platform: 'AOS-10' })
    expect(aos8Device.technicalState.state).toBe('CURRENT')
    expect(aos10Device.technicalState.state).toBe('CURRENT')
  })

  it('rejects normalized duplicate names within the same customer', async () => {
    mocks.deviceFindMany.mockResolvedValue([{ id: 'existing', name: '  hq-sw-01 ' }])
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-cisco', name: 'HQ-SW-01' }))
      .rejects.toBeInstanceOf(DeviceConflictError)
  })

  it('blocks destructive deletion while lifecycle/history references exist', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ id: 'device-1', name: 'HQ-SW-01' })
    mocks.policyCount.mockResolvedValue(0)
    mocks.lifecycleCount.mockResolvedValue(1)
    mocks.auditCount.mockResolvedValue(0)

    await expect(deleteDevice('device-1')).rejects.toBeInstanceOf(DeviceInUseError)
    expect(mocks.deviceDelete).not.toHaveBeenCalled()
  })
})
