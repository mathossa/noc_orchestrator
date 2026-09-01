import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deviceModelFindMany: vi.fn(),
  deviceModelFindUnique: vi.fn(),
  deviceModelCreate: vi.fn(),
  deviceModelUpdate: vi.fn(),
  deviceModelDelete: vi.fn(),
  familyFindUnique: vi.fn(),
  familyFindMany: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorFindMany: vi.fn(),
  deviceTypeFindUnique: vi.fn(),
  deviceTypeFindMany: vi.fn(),
  firmwareReleaseFindMany: vi.fn(),
  policyFindFirst: vi.fn(),
  policyFindMany: vi.fn(),
  deviceCount: vi.fn(),
  policyCount: vi.fn(),
  auditFindMany: vi.fn(),
  auditCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: {
      findMany: mocks.deviceModelFindMany,
      findUnique: mocks.deviceModelFindUnique,
      create: mocks.deviceModelCreate,
      update: mocks.deviceModelUpdate,
      delete: mocks.deviceModelDelete,
    },
    deviceModelFamily: {
      findUnique: mocks.familyFindUnique,
      findMany: mocks.familyFindMany,
    },
    vendor: {
      findUnique: mocks.vendorFindUnique,
      findMany: mocks.vendorFindMany,
    },
    deviceType: {
      findUnique: mocks.deviceTypeFindUnique,
      findMany: mocks.deviceTypeFindMany,
    },
    firmwareRelease: { findMany: mocks.firmwareReleaseFindMany },
    device: { count: mocks.deviceCount },
    firmwarePolicy: {
      findFirst: mocks.policyFindFirst,
      findMany: mocks.policyFindMany,
      count: mocks.policyCount,
    },
    auditEvent: { findMany: mocks.auditFindMany, count: mocks.auditCount },
  },
}))

import {
  createDeviceModel,
  deleteDeviceModel,
  DeviceModelConflictError,
  DeviceModelInUseError,
  DeviceModelReferenceError,
  getDeviceModel,
  listDeviceModels,
  updateDeviceModel,
} from '@/lib/device-model-store'

const baseRecord = {
  id: 'model-1',
  vendorId: 'vendor-1',
  deviceTypeId: 'type-1',
  familyId: null,
  model: 'C9300-24P',
  platform: 'Catalyst 9300',
  notes: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  vendor: { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true },
  deviceType: { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true },
  family: null,
  _count: { devices: 0 },
}

describe('device model persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1' })
    mocks.deviceTypeFindUnique.mockResolvedValue({ id: 'type-1' })
    mocks.familyFindUnique.mockResolvedValue(null)
    mocks.familyFindMany.mockResolvedValue([])
    mocks.deviceModelFindMany.mockResolvedValue([])
    mocks.firmwareReleaseFindMany.mockResolvedValue([])
    mocks.policyFindFirst.mockResolvedValue(null)
    mocks.policyFindMany.mockResolvedValue([])
    mocks.auditFindMany.mockResolvedValue([])
  })

  it('creates a manual model with valid vendor and device type references', async () => {
    mocks.deviceModelCreate.mockResolvedValue(baseRecord)
    const result = await createDeviceModel({
      vendorId: 'vendor-1', deviceTypeId: 'type-1', model: 'C9300-24P', platform: 'Catalyst 9300',
    })
    expect(mocks.deviceModelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vendorId: 'vendor-1', deviceTypeId: 'type-1', familyId: null, model: 'C9300-24P', source: 'MANUAL',
      }),
    }))
    expect(result.model).toBe('C9300-24P')
  })

  it('assigns a concrete model to an explicit family from the same vendor', async () => {
    const family = { id: 'family-9300', vendorId: 'vendor-1', name: 'Catalyst 9300', isActive: true }
    mocks.familyFindUnique.mockResolvedValue(family)
    mocks.deviceModelCreate.mockResolvedValue({ ...baseRecord, familyId: family.id, family })

    const result = await createDeviceModel({
      vendorId: 'vendor-1', deviceTypeId: 'type-1', familyId: family.id, model: 'C9300-24P',
    })

    expect(result.family).toEqual(family)
    expect(mocks.deviceModelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ familyId: 'family-9300' }),
    }))
  })

  it('rejects a family belonging to another vendor', async () => {
    mocks.familyFindUnique.mockResolvedValue({ id: 'family-other', vendorId: 'vendor-2' })

    await expect(createDeviceModel({
      vendorId: 'vendor-1', deviceTypeId: 'type-1', familyId: 'family-other', model: 'C9300-24P',
    })).rejects.toBeInstanceOf(DeviceModelReferenceError)
    expect(mocks.deviceModelCreate).not.toHaveBeenCalled()
  })

  it('rejects missing vendor or device type references', async () => {
    mocks.vendorFindUnique.mockResolvedValue(null)
    await expect(createDeviceModel({ vendorId: 'missing', deviceTypeId: 'type-1', model: 'Model' }))
      .rejects.toBeInstanceOf(DeviceModelReferenceError)
    expect(mocks.deviceModelCreate).not.toHaveBeenCalled()
  })

  it('rejects case and whitespace variants within the same vendor', async () => {
    mocks.deviceModelFindMany.mockResolvedValue([{ id: 'model-existing', model: '  C9300-24P  ' }])
    await expect(createDeviceModel({ vendorId: 'vendor-1', deviceTypeId: 'type-1', model: 'c9300-24p' }))
      .rejects.toBeInstanceOf(DeviceModelConflictError)
    expect(mocks.deviceModelCreate).not.toHaveBeenCalled()
  })

  it('scopes model uniqueness to the selected vendor', async () => {
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-2' })
    mocks.deviceModelCreate.mockResolvedValue({
      ...baseRecord,
      id: 'model-2',
      vendorId: 'vendor-2',
      vendor: { id: 'vendor-2', code: 'OTHER', name: 'Other Vendor', isActive: true },
    })
    await createDeviceModel({ vendorId: 'vendor-2', deviceTypeId: 'type-1', model: 'C9300-24P' })
    expect(mocks.deviceModelFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: 'vendor-2' } }))
    expect(mocks.deviceModelCreate).toHaveBeenCalled()
  })

  it('shows the exact current desired release directly in the model overview data', async () => {
    const now = new Date('2026-08-31T19:00:00Z')
    const release = {
      id: 'fw-1', vendorId: 'vendor-1', version: '17.15.5', platform: 'Catalyst 9300', status: 'APPROVED',
      isActive: true, releasedAt: now, firmwareTrain: { id: 'train-1', name: '17.15.x' },
    }
    mocks.deviceModelFindMany.mockResolvedValue([baseRecord])
    mocks.policyFindMany.mockResolvedValue([{ deviceModelId: 'model-1', targetFirmwareRelease: release }])

    const result = await listDeviceModels()

    expect(result[0].desiredFirmwareRelease).toEqual({ ...release, releasedAt: now.toISOString() })
    expect(mocks.policyFindMany).toHaveBeenCalledTimes(1)
  })

  it('supports partial archive updates without overwriting model identity or family membership', async () => {
    mocks.deviceModelFindUnique.mockResolvedValue({
      id: 'model-1', vendorId: 'vendor-1', deviceTypeId: 'type-1', familyId: 'family-1', model: 'C9300-24P',
      platform: 'Catalyst 9300', notes: null, isActive: true, source: 'MANUAL', externalProvider: null, externalId: null,
    })
    mocks.familyFindUnique.mockResolvedValue({ id: 'family-1', vendorId: 'vendor-1' })
    mocks.deviceModelFindMany.mockResolvedValue([{ id: 'model-1', model: 'C9300-24P' }])
    const family = { id: 'family-1', vendorId: 'vendor-1', name: '9300', isActive: true }
    mocks.deviceModelUpdate.mockResolvedValue({ ...baseRecord, familyId: 'family-1', family, isActive: false })

    await updateDeviceModel('model-1', { isActive: false })

    expect(mocks.deviceModelUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'model-1' },
      data: expect.objectContaining({ vendorId: 'vendor-1', deviceTypeId: 'type-1', familyId: 'family-1', model: 'C9300-24P', isActive: false }),
    }))
  })

  it('aggregates usage, resolves desired policy, and returns audit history', async () => {
    const now = new Date('2026-08-31T19:00:00Z')
    mocks.deviceModelFindUnique.mockResolvedValue({
      ...baseRecord,
      createdAt: now,
      updatedAt: now,
      _count: { devices: 2 },
      devices: [
        { id: 'd1', customer: { id: 'c1', name: 'Customer A' }, currentFirmwareReleaseId: 'fw-1', currentFirmwareRelease: { id: 'fw-1', version: '17.15.5', platform: 'Catalyst 9300' }, lifecycle: { state: 'PLANNED' } },
        { id: 'd2', customer: { id: 'c1', name: 'Customer A' }, currentFirmwareReleaseId: null, currentFirmwareRelease: null, lifecycle: null },
      ],
    })
    const release = { id: 'fw-1', vendorId: 'vendor-1', version: '17.15.5', platform: 'Catalyst 9300', status: 'APPROVED', isActive: true, releasedAt: now, firmwareTrain: { id: 'train-1', name: '17.15.x' } }
    mocks.firmwareReleaseFindMany.mockResolvedValue([release])
    mocks.policyFindFirst.mockResolvedValue({
      id: 'policy-1', targetFirmwareReleaseId: 'fw-1', isActive: true, notes: null, deviceModelId: 'model-1', createdAt: now, updatedAt: now, targetFirmwareRelease: release,
    })
    mocks.auditFindMany.mockResolvedValue([{
      id: 'audit-1', action: 'DESIRED_FIRMWARE_CHANGED', entityType: 'DeviceModel', entityId: 'model-1', customerId: null, actorUserId: null, before: null, after: { version: '17.15.5' }, metadata: null, createdAt: now, actor: null,
    }])

    const result = await getDeviceModel('model-1')

    expect(result.availableFirmware.releases).toEqual([{ ...release, releasedAt: now.toISOString(), selectable: true }])
    expect(result.desiredFirmware).toEqual({
      available: true,
      policyId: 'policy-1',
      release: { ...release, releasedAt: now.toISOString() },
    })
    expect(result.desiredFirmwareRelease?.version).toBe('17.15.5')
    expect(result.workflowCounts.planned).toBe(1)
    expect(result.customers).toEqual([{ id: 'c1', name: 'Customer A', deviceCount: 2 }])
    expect(result.auditHistory).toEqual([expect.objectContaining({ id: 'audit-1', action: 'DESIRED_FIRMWARE_CHANGED' })])
  })

  it('normalizes platform/family matching for catalog choices', async () => {
    const now = new Date('2026-08-31T19:00:00Z')
    mocks.deviceModelFindUnique.mockResolvedValue({
      ...baseRecord,
      platform: '  Catalyst   9300 ',
      createdAt: now,
      updatedAt: now,
      devices: [],
    })
    mocks.firmwareReleaseFindMany.mockResolvedValue([
      { id: 'match', vendorId: 'vendor-1', version: '17.15.5', platform: 'catalyst 9300', status: 'APPROVED', isActive: true, releasedAt: now, firmwareTrain: null },
      { id: 'other', vendorId: 'vendor-1', version: '7.11.2', platform: 'IOS XR', status: 'APPROVED', isActive: true, releasedAt: now, firmwareTrain: null },
    ])

    const result = await getDeviceModel('model-1')

    expect(mocks.firmwareReleaseFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: 'vendor-1' } }))
    expect(result.availableFirmware.releases.map((release) => release.id)).toEqual(['match'])
  })

  it('returns vendor releases when the model does not define a platform/family', async () => {
    const now = new Date('2026-08-31T19:00:00Z')
    mocks.deviceModelFindUnique.mockResolvedValue({ ...baseRecord, platform: null, createdAt: now, updatedAt: now, devices: [] })
    await getDeviceModel('model-1')
    expect(mocks.firmwareReleaseFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: 'vendor-1' } }))
  })

  it('blocks destructive deletion while device, policy, or audit references exist', async () => {
    mocks.deviceModelFindUnique.mockResolvedValue({ id: 'model-1', model: 'C9300-24P' })
    mocks.deviceCount.mockResolvedValue(1)
    mocks.policyCount.mockResolvedValue(0)
    mocks.auditCount.mockResolvedValue(1)
    await expect(deleteDeviceModel('model-1')).rejects.toBeInstanceOf(DeviceModelInUseError)
    expect(mocks.deviceModelDelete).not.toHaveBeenCalled()
  })
})
