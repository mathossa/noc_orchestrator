import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  customerFindUnique: vi.fn(),
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  customerDelete: vi.fn(),
  contractFindUnique: vi.fn(),
  contractFindMany: vi.fn(),
  siteFindMany: vi.fn(),
  siteCount: vi.fn(),
  deviceFindMany: vi.fn(),
  deviceCount: vi.fn(),
  policyFindFirst: vi.fn(),
  policyCount: vi.fn(),
  auditCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: {
      findMany: mocks.customerFindMany,
      findUnique: mocks.customerFindUnique,
      create: mocks.customerCreate,
      update: mocks.customerUpdate,
      delete: mocks.customerDelete,
    },
    contractType: {
      findUnique: mocks.contractFindUnique,
      findMany: mocks.contractFindMany,
    },
    site: {
      findMany: mocks.siteFindMany,
      count: mocks.siteCount,
    },
    device: {
      findMany: mocks.deviceFindMany,
      count: mocks.deviceCount,
    },
    firmwarePolicy: { findFirst: mocks.policyFindFirst, count: mocks.policyCount },
    auditEvent: { count: mocks.auditCount },
  },
}))

import {
  createCustomer,
  CustomerContractError,
  CustomerInUseError,
  deleteCustomer,
  getCustomer,
  updateCustomer,
} from '@/lib/customer-store'

function storedCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-1',
    name: 'Example Customer',
    code: 'EXAMPLE',
    contractTypeId: null,
    contractType: null,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    isActive: true,
    createdAt: new Date('2026-08-31T18:00:00Z'),
    updatedAt: new Date('2026-08-31T18:00:00Z'),
    _count: { devices: 0, sites: 0 },
    ...overrides,
  }
}

function desiredPolicy(modelId: string, releaseId: string) {
  const timestamp = new Date('2026-09-01T00:00:00Z')
  return {
    id: `policy-${modelId}`,
    policyMode: 'EXACT',
    trackKey: 'default',
    trackName: 'Default',
    trackClass: 'PREFERRED',
    isDefaultTrack: true,
    desiredPlatform: 'IOS XE',
    minimumFirmwareReleaseId: null,
    targetFirmwareReleaseId: releaseId,
    maximumFirmwareReleaseId: null,
    firmwareTrainId: null,
    minimumInclusive: true,
    maximumInclusive: true,
    effectiveFrom: timestamp,
    policyVersion: 1,
    isActive: true,
    notes: null,
    deviceModelFamilyId: null,
    deviceModelId: modelId,
    customerId: null,
    siteId: null,
    deviceId: null,
    contractTypeId: null,
    vendorId: null,
    deviceTypeId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    minimumFirmwareRelease: null,
    targetFirmwareRelease: {
      id: releaseId,
      vendorId: 'vendor-1',
      platform: 'IOS XE',
      version: releaseId,
      logicalVersion: releaseId,
      variant: null,
      imageCode: null,
      catalogState: 'VERIFIED',
      policyEligibility: 'ALLOWED',
      variantEquivalence: 'EXACT_ONLY',
      status: 'APPROVED',
      isActive: true,
      releasedAt: null,
      firmwareTrain: null,
    },
    maximumFirmwareRelease: null,
    firmwareTrain: null,
  }
}

describe('customer persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.siteFindMany.mockResolvedValue([])
    mocks.siteCount.mockResolvedValue(0)
    mocks.policyFindFirst.mockResolvedValue(null)
  })

  it('creates a manual customer without external identity fields', async () => {
    mocks.customerCreate.mockResolvedValue(storedCustomer())

    const result = await createCustomer({ name: 'Example Customer', code: 'example' })

    expect(mocks.customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Example Customer',
          code: 'EXAMPLE',
          contractTypeId: null,
          source: 'MANUAL',
          externalProvider: null,
          externalId: null,
          isActive: true,
        },
      }),
    )
    expect(result).toMatchObject({ id: 'customer-1', deviceCount: 0, siteCount: 0, source: 'MANUAL' })
  })

  it('rejects a contract type that does not exist', async () => {
    mocks.contractFindUnique.mockResolvedValue(null)

    await expect(createCustomer({ name: 'Customer', contractTypeId: 'missing-contract' })).rejects.toBeInstanceOf(
      CustomerContractError,
    )
    expect(mocks.customerCreate).not.toHaveBeenCalled()
  })

  it('supports partial archive updates without overwriting customer identity', async () => {
    mocks.customerFindUnique.mockResolvedValue({
      id: 'customer-1',
      name: 'Existing Customer',
      code: 'EXISTING',
      contractTypeId: null,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
      isActive: true,
    })
    mocks.customerUpdate.mockResolvedValue(
      storedCustomer({ name: 'Existing Customer', code: 'EXISTING', isActive: false }),
    )

    const result = await updateCustomer('customer-1', { isActive: false })

    expect(mocks.customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'customer-1' },
        data: expect.objectContaining({
          name: 'Existing Customer',
          code: 'EXISTING',
          source: 'MANUAL',
          isActive: false,
        }),
      }),
    )
    expect(result.isActive).toBe(false)
  })

  it('returns site, workflow, and canonical technical firmware summaries', async () => {
    mocks.customerFindUnique.mockResolvedValue(storedCustomer({ code: null, name: 'Customer', _count: { devices: 4, sites: 1 } }))
    mocks.deviceFindMany.mockResolvedValue([
      { deviceModelId: 'model-1', currentFirmwareReleaseId: 'release-a', lifecycle: { state: 'PLANNED' } },
      { deviceModelId: 'model-1', currentFirmwareReleaseId: 'release-b', lifecycle: { state: 'DONE' } },
      { deviceModelId: 'model-1', currentFirmwareReleaseId: null, lifecycle: { state: 'DONE' } },
      { deviceModelId: 'model-2', currentFirmwareReleaseId: 'release-x', lifecycle: null },
    ])
    mocks.policyFindFirst.mockImplementation(({ where }: { where: { deviceModelId: string } }) => {
      if (where.deviceModelId === 'model-1') return Promise.resolve(desiredPolicy('model-1', 'release-a'))
      return Promise.resolve(null)
    })
    mocks.siteFindMany.mockResolvedValue([
      { id: 'site-1', name: 'Head office', code: 'HQ', city: 'Zwolle', country: 'Netherlands', isActive: true, _count: { devices: 3 } },
    ])

    const result = await getCustomer('customer-1')

    expect(result.siteCount).toBe(1)
    expect(result.sites).toEqual([
      { id: 'site-1', name: 'Head office', code: 'HQ', city: 'Zwolle', country: 'Netherlands', isActive: true, deviceCount: 3 },
    ])
    expect(result.workflowCounts).toEqual({ planned: 1, ignored: 0, customerDeclined: 0, done: 2 })
    expect(result.desiredStateSummary).toEqual({
      available: true,
      current: 1,
      actionRequired: 1,
      unknown: 1,
      noPolicy: 1,
    })
  })

  it('blocks permanent deletion when customer sites or history are referenced', async () => {
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1', name: 'Customer' })
    mocks.siteCount.mockResolvedValue(1)
    mocks.deviceCount.mockResolvedValue(0)
    mocks.policyCount.mockResolvedValue(0)
    mocks.auditCount.mockResolvedValue(0)

    await expect(deleteCustomer('customer-1')).rejects.toBeInstanceOf(CustomerInUseError)
    expect(mocks.customerDelete).not.toHaveBeenCalled()
  })

  it('deletes an unreferenced customer', async () => {
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1', name: 'Unused Customer' })
    mocks.siteCount.mockResolvedValue(0)
    mocks.deviceCount.mockResolvedValue(0)
    mocks.policyCount.mockResolvedValue(0)
    mocks.auditCount.mockResolvedValue(0)
    mocks.customerDelete.mockResolvedValue({ id: 'customer-1' })

    await expect(deleteCustomer('customer-1')).resolves.toEqual({ id: 'customer-1' })
    expect(mocks.customerDelete).toHaveBeenCalledWith({ where: { id: 'customer-1' } })
  })
})
