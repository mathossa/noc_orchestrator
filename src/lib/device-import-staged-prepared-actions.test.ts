import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  referenceFindMany: vi.fn(),
  referenceFindFirst: vi.fn(),
  referenceUpdate: vi.fn(),
  referenceUpdateMany: vi.fn(),
  vendorFindFirst: vi.fn(),
  vendorCreate: vi.fn(),
  deviceTypeFindFirst: vi.fn(),
  deviceTypeCreate: vi.fn(),
  bulkCore: vi.fn(),
  bulkFirmware: vi.fn(),
  bulkModels: vi.fn(),
  bulkAssignFamilies: vi.fn(),
  bulkCreateFamilies: vi.fn(),
  remember: vi.fn(),
  resolveBulk: vi.fn(),
  bulkSites: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/lib/device-import-staged-core-assist', () => ({ bulkCreateDeviceImportCoreReferences: mocks.bulkCore }))
vi.mock('@/lib/device-import-staged-firmware-assist', () => ({ bulkCreateDeviceImportFirmware: mocks.bulkFirmware }))
vi.mock('@/lib/device-import-staged-model-assist', () => ({
  bulkAssignDeviceImportModelFamilies: mocks.bulkAssignFamilies,
  bulkCreateAndAssignDeviceImportModelFamilies: mocks.bulkCreateFamilies,
  bulkCreateDeviceImportModels: mocks.bulkModels,
}))
vi.mock('@/lib/device-import-staged-profile-aliases', () => ({ rememberReviewedBatchReferences: mocks.remember }))
vi.mock('@/lib/device-import-staged-reference-bulk', () => ({ resolveDeviceImportStagedReferencesBulk: mocks.resolveBulk }))
vi.mock('@/lib/device-import-staged-site-bulk-create', () => ({ bulkCreateDeviceImportSites: mocks.bulkSites }))
vi.mock('@/lib/device-import-staging-store', () => {
  class DeviceImportStagingError extends Error {}
  return { DeviceImportStagingError, refreshDeviceImportBatchReferences: mocks.refresh }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique },
    deviceImportStagedReference: {
      findMany: mocks.referenceFindMany,
      findFirst: mocks.referenceFindFirst,
      update: mocks.referenceUpdate,
      updateMany: mocks.referenceUpdateMany,
    },
    vendor: { findFirst: mocks.vendorFindFirst, create: mocks.vendorCreate },
    deviceType: { findFirst: mocks.deviceTypeFindFirst, create: mocks.deviceTypeCreate },
  },
}))

import { applyPreparedImportActions } from '@/lib/device-import-staged-prepared-actions'

describe('prepared staged import actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue({ id: 'batch-1', status: 'STAGED' })
    mocks.referenceFindMany.mockResolvedValue([{
      id: 'model-ref',
      kind: 'DEVICE_MODEL',
      sourceValue: 'Aerohive AP305',
      status: 'UNRESOLVED',
      metadata: { vendorSourceValue: 'Aerohive', deviceTypeSourceValue: 'Access Point', deviceTypeTargetId: 'type-ap' },
    }])
    mocks.referenceFindFirst.mockResolvedValue({
      id: 'model-ref',
      metadata: { vendorSourceValue: 'Aerohive', deviceTypeSourceValue: 'Access Point', deviceTypeTargetId: 'type-ap' },
    })
    mocks.referenceUpdate.mockResolvedValue({})
    mocks.referenceUpdateMany.mockResolvedValue({ count: 1 })
    mocks.vendorFindFirst.mockResolvedValue(null)
    mocks.vendorCreate.mockResolvedValue({ id: 'vendor-aerohive' })
    mocks.deviceTypeFindFirst.mockResolvedValue(null)
    mocks.deviceTypeCreate.mockResolvedValue({ id: 'type-new' })
    mocks.bulkModels.mockResolvedValue({})
    mocks.remember.mockResolvedValue(undefined)
    mocks.refresh.mockResolvedValue({ counts: { references: { unresolved: 0 } } })
  })

  it('creates a missing typed Vendor before creating its Model', async () => {
    const result = await applyPreparedImportActions({
      batchId: 'batch-1',
      items: [{
        referenceId: 'model-ref',
        action: 'CREATE',
        targetId: null,
        remember: true,
        values: {
          vendorId: null,
          vendorName: 'Aerohive',
          vendorCode: 'AEROHIVE',
          deviceTypeId: 'type-ap',
          deviceTypeName: 'Access Point',
          deviceTypeCode: 'ACCESS_POINT',
          model: 'AP305',
          platform: null,
          platforms: '',
          familyId: null,
        },
      }],
      families: [],
    })

    expect(mocks.vendorCreate).toHaveBeenCalledWith({
      data: { name: 'Aerohive', code: 'AEROHIVE', isActive: true },
      select: { id: true },
    })
    expect(mocks.referenceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'model-ref' },
      data: expect.objectContaining({
        metadata: expect.objectContaining({ vendorTargetId: 'vendor-aerohive', deviceTypeTargetId: 'type-ap' }),
      }),
    }))
    expect(mocks.bulkModels).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'batch-1',
      deferRefresh: true,
      items: [expect.objectContaining({ referenceId: 'model-ref', model: 'AP305' })],
    }))
    expect(result.applied).toBe(1)
    expect(result.failed).toBe(0)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
