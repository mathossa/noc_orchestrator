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
  policyFindFirst: vi.fn(),
  policyCount: vi.fn(),
  lifecycleCount: vi.fn(),
  auditCount: vi.fn(),
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
    firmwarePolicy: { findFirst: mocks.policyFindFirst, count: mocks.policyCount },
    firmwareLifecycleRecord: { count: mocks.lifecycleCount },
    auditEvent: { count: mocks.auditCount },
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
  updateDevice,
} from '@/lib/device-store'

const customerContract = {
  id: 'contract-1',
  code: 'FULL',
  name: 'Fully Managed',
  firmwareManagementEnabled: true,
  isActive: true,
}
const siteContract = {
  id: 'contract-2',
  code: 'FW',
  name: 'Firmware Management',
  firmwareManagementEnabled: true,
  isActive: true,
}
const customer = {
  id: 'customer-1',
  code: 'ACME',
  name: 'Acme',
  isActive: true,
  contractType: customerContract,
}
const model = {
  id: 'model-1',
  model: 'C9300-24P',
  platform: 'IOS XE',
  isActive: true,
  vendor: { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true },
  deviceType: { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true },
}
const rawModel = { id: 'model-1', vendorId: 'vendor-1', platform: 'IOS XE' }
const release = {
  id: 'release-1',
  vendorId: 'vendor-1',
  platform: 'IOS XE',
  version: '17.12.5',
  status: 'APPROVED',
  isActive: true,
  releasedAt: new Date('2026-08-01T00:00:00Z'),
  firmwareTrain: { id: 'train-old', name: '17.12.x' },
}
const storedDevice = {
  id: 'device-1',
  customerId: 'customer-1',
  siteId: null,
  deviceModelId: 'model-1',
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
  deviceModel: model,
  currentFirmwareRelease: null,
  lifecycle: null,
  createdAt: new Date('2026-08-31T20:00:00Z'),
  updatedAt: new Date('2026-08-31T20:00:00Z'),
}

describe('device inventory persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1' })
    mocks.modelFindUnique.mockResolvedValue(rawModel)
    mocks.deviceFindMany.mockResolvedValue([])
    mocks.policyFindFirst.mockResolvedValue(null)
    mocks.assertSiteBelongsToCustomer.mockResolvedValue(null)
  })

  it('creates a minimal manual device without site or external identity', async () => {
    mocks.deviceCreate.mockResolvedValue(storedDevice)
    const result = await createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01' })
    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 'customer-1', siteId: null, deviceModelId: 'model-1', name: 'HQ-SW-01', source: 'MANUAL', externalProvider: null, externalId: null }) }))
    expect(result).toMatchObject({ id: 'device-1', source: 'MANUAL', currentFirmwareRelease: null, effectiveContractType: customerContract, contractSource: 'CUSTOMER' })
  })

  it('validates optional site assignment against the selected customer', async () => {
    mocks.deviceCreate.mockResolvedValue({ ...storedDevice, siteId: 'site-1', site: { id: 'site-1', code: 'BRANCH', name: 'Branch', isActive: true, contractType: null } })
    await createDevice({ customerId: 'customer-1', siteId: 'site-1', deviceModelId: 'model-1', name: 'HQ-SW-01' })
    expect(mocks.assertSiteBelongsToCustomer).toHaveBeenCalledWith('site-1', 'customer-1')
  })

  it('uses a site contract override before the customer default', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, siteId: 'site-1', site: { id: 'site-1', code: 'BRANCH', name: 'Branch', isActive: true, contractType: siteContract } })
    const result = await getDevice('device-1')
    expect(result.effectiveContractType).toEqual(siteContract)
    expect(result.contractSource).toBe('SITE')
    expect(result.customer.contractType).toEqual(customerContract)
  })

  it('rejects current firmware from a different vendor', async () => {
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'release-other', vendorId: 'vendor-2', platform: 'IOS XE' })
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01', currentFirmwareReleaseId: 'release-other' })).rejects.toBeInstanceOf(DeviceReferenceError)
    expect(mocks.deviceCreate).not.toHaveBeenCalled()
  })

  it('rejects current firmware from a different platform when the model declares one', async () => {
    mocks.firmwareFindUnique.mockResolvedValue({ id: 'release-other', vendorId: 'vendor-1', platform: 'IOS XR' })
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01', currentFirmwareReleaseId: 'release-other' })).rejects.toBeInstanceOf(DeviceReferenceError)
  })

  it('rejects normalized duplicate device names within one customer', async () => {
    mocks.deviceFindMany.mockResolvedValue([{ id: 'existing', name: '  hq-sw-01 ' }])
    await expect(createDevice({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01' })).rejects.toBeInstanceOf(DeviceConflictError)
    expect(mocks.deviceCreate).not.toHaveBeenCalled()
  })

  it('supports archive-only updates without wiping device identity', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, customer: undefined, site: undefined, deviceModel: undefined, currentFirmwareRelease: undefined, lifecycle: undefined })
    mocks.deviceUpdate.mockResolvedValue({ ...storedDevice, isActive: false })
    await updateDevice('device-1', { isActive: false })
    expect(mocks.deviceUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'device-1' }, data: expect.objectContaining({ customerId: 'customer-1', deviceModelId: 'model-1', name: 'HQ-SW-01', isActive: false }) }))
  })

  it('resolves desired firmware through the device model while leaving technical state unavailable', async () => {
    const desiredRelease = {
      id: 'desired-1', vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', status: 'APPROVED', isActive: true, releasedAt: new Date('2026-08-20T00:00:00Z'), firmwareTrain: { id: 'train-new', name: '17.15.x' },
    }
    mocks.deviceFindUnique.mockResolvedValue({ ...storedDevice, currentFirmwareReleaseId: 'release-1', currentFirmwareRelease: release, currentFirmwareObservedAt: new Date('2026-08-30T20:00:00Z') })
    mocks.policyFindFirst.mockResolvedValue({ id: 'policy-1', targetFirmwareReleaseId: 'desired-1', isActive: true, notes: null, deviceModelId: 'model-1', createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'), targetFirmwareRelease: desiredRelease })

    const result = await getDevice('device-1')

    expect(result.currentFirmwareRelease?.version).toBe('17.12.5')
    expect(result.desiredFirmware).toEqual({
      available: true,
      release: { id: 'desired-1', vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', status: 'APPROVED', isActive: true, firmwareTrain: { id: 'train-new', name: '17.15.x' } },
    })
    expect(result.technicalState).toEqual({ available: false, state: null })
  })

  it('returns no desired release when the model has no active policy', async () => {
    mocks.deviceFindUnique.mockResolvedValue(storedDevice)
    const result = await getDevice('device-1')
    expect(result.desiredFirmware).toEqual({ available: true, release: null })
    expect(result.technicalState).toEqual({ available: false, state: null })
  })

  it('blocks destructive deletion when lifecycle or history references exist', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ id: 'device-1', name: 'HQ-SW-01' })
    mocks.policyCount.mockResolvedValue(0)
    mocks.lifecycleCount.mockResolvedValue(1)
    mocks.auditCount.mockResolvedValue(0)
    await expect(deleteDevice('device-1')).rejects.toBeInstanceOf(DeviceInUseError)
    expect(mocks.deviceDelete).not.toHaveBeenCalled()
  })
})
