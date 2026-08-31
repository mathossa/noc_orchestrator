import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deviceModelFindMany: vi.fn(),
  deviceModelFindUnique: vi.fn(),
  deviceModelCreate: vi.fn(),
  deviceModelUpdate: vi.fn(),
  deviceModelDelete: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorFindMany: vi.fn(),
  deviceTypeFindUnique: vi.fn(),
  deviceTypeFindMany: vi.fn(),
  deviceCount: vi.fn(),
  policyCount: vi.fn(),
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
    vendor: {
      findUnique: mocks.vendorFindUnique,
      findMany: mocks.vendorFindMany,
    },
    deviceType: {
      findUnique: mocks.deviceTypeFindUnique,
      findMany: mocks.deviceTypeFindMany,
    },
    device: { count: mocks.deviceCount },
    firmwarePolicy: { count: mocks.policyCount },
    auditEvent: { count: mocks.auditCount },
  },
}))

import {
  createDeviceModel,
  deleteDeviceModel,
  DeviceModelConflictError,
  DeviceModelInUseError,
  DeviceModelReferenceError,
  getDeviceModel,
  updateDeviceModel,
} from '@/lib/device-model-store'

const baseRecord = {
  id: 'model-1',
  vendorId: 'vendor-1',
  deviceTypeId: 'type-1',
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
  _count: { devices: 0 },
}

describe('device model persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1' })
    mocks.deviceTypeFindUnique.mockResolvedValue({ id: 'type-1' })
    mocks.deviceModelFindMany.mockResolvedValue([])
  })

  it('creates a manual model with valid vendor and device type references', async () => {
    mocks.deviceModelCreate.mockResolvedValue(baseRecord)

    const result = await createDeviceModel({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: 'C9300-24P',
      platform: 'Catalyst 9300',
    })

    expect(mocks.deviceModelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'vendor-1',
          deviceTypeId: 'type-1',
          model: 'C9300-24P',
          source: 'MANUAL',
        }),
      }),
    )
    expect(result.model).toBe('C9300-24P')
  })

  it('rejects missing vendor or device type references', async () => {
    mocks.vendorFindUnique.mockResolvedValue(null)

    await expect(
      createDeviceModel({ vendorId: 'missing', deviceTypeId: 'type-1', model: 'Model' }),
    ).rejects.toBeInstanceOf(DeviceModelReferenceError)
    expect(mocks.deviceModelCreate).not.toHaveBeenCalled()
  })

  it('rejects case and whitespace variants within the same vendor', async () => {
    mocks.deviceModelFindMany.mockResolvedValue([{ id: 'model-existing', model: '  C9300-24P  ' }])

    await expect(
      createDeviceModel({ vendorId: 'vendor-1', deviceTypeId: 'type-1', model: 'c9300-24p' }),
    ).rejects.toBeInstanceOf(DeviceModelConflictError)
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

    expect(mocks.deviceModelFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vendorId: 'vendor-2' } }),
    )
    expect(mocks.deviceModelCreate).toHaveBeenCalled()
  })

  it('supports partial archive updates without overwriting model identity', async () => {
    mocks.deviceModelFindUnique.mockResolvedValue({
      id: 'model-1',
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: 'C9300-24P',
      platform: 'Catalyst 9300',
      notes: null,
      isActive: true,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
    })
    mocks.deviceModelFindMany.mockResolvedValue([{ id: 'model-1', model: 'C9300-24P' }])
    mocks.deviceModelUpdate.mockResolvedValue({ ...baseRecord, isActive: false })

    await updateDeviceModel('model-1', { isActive: false })

    expect(mocks.deviceModelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'model-1' },
        data: expect.objectContaining({
          vendorId: 'vendor-1',
          deviceTypeId: 'type-1',
          model: 'C9300-24P',
          isActive: false,
        }),
      }),
    )
  })

  it('aggregates customer, current firmware, and workflow usage from devices', async () => {
    const now = new Date('2026-08-31T19:00:00Z')
    mocks.deviceModelFindUnique.mockResolvedValue({
      ...baseRecord,
      createdAt: now,
      updatedAt: now,
      _count: { devices: 4 },
      devices: [
        {
          id: 'd1',
          customer: { id: 'c1', name: 'Customer A' },
          currentFirmwareReleaseId: 'fw-1',
          currentFirmwareRelease: { id: 'fw-1', version: '17.15.5', platform: 'cat9k' },
          lifecycle: { state: 'PLANNED' },
        },
        {
          id: 'd2',
          customer: { id: 'c1', name: 'Customer A' },
          currentFirmwareReleaseId: 'fw-1',
          currentFirmwareRelease: { id: 'fw-1', version: '17.15.5', platform: 'cat9k' },
          lifecycle: { state: 'DONE' },
        },
        {
          id: 'd3',
          customer: { id: 'c2', name: 'Customer B' },
          currentFirmwareReleaseId: 'fw-2',
          currentFirmwareRelease: { id: 'fw-2', version: '17.12.5', platform: 'cat9k' },
          lifecycle: { state: 'CUSTOMER_DECLINED' },
        },
        {
          id: 'd4',
          customer: { id: 'c2', name: 'Customer B' },
          currentFirmwareReleaseId: null,
          currentFirmwareRelease: null,
          lifecycle: null,
        },
      ],
    })

    const result = await getDeviceModel('model-1')

    expect(result.customers).toEqual([
      { id: 'c1', name: 'Customer A', deviceCount: 2 },
      { id: 'c2', name: 'Customer B', deviceCount: 2 },
    ])
    expect(result.firmwareDistribution).toEqual(
      expect.arrayContaining([
        { firmwareReleaseId: 'fw-1', version: '17.15.5', platform: 'cat9k', deviceCount: 2 },
        { firmwareReleaseId: null, version: 'Unrecorded', platform: null, deviceCount: 1 },
      ]),
    )
    expect(result.workflowCounts).toEqual({
      planned: 1,
      ignored: 0,
      customerDeclined: 1,
      done: 1,
      undecided: 1,
    })
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
