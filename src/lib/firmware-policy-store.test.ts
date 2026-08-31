import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelFindUnique: vi.fn(),
  releaseFindUnique: vi.fn(),
  policyFindFirst: vi.fn(),
  policyUpdateMany: vi.fn(),
  policyCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: { findUnique: mocks.modelFindUnique },
    firmwareRelease: { findUnique: mocks.releaseFindUnique },
    firmwarePolicy: {
      findFirst: mocks.policyFindFirst,
      updateMany: mocks.policyUpdateMany,
      create: mocks.policyCreate,
    },
    $transaction: mocks.transaction,
  },
}))

import {
  clearModelDesiredFirmwarePolicy,
  FirmwarePolicyCompatibilityError,
  getActiveModelDesiredPolicy,
  setModelDesiredFirmwarePolicy,
} from '@/lib/firmware-policy-store'

const now = new Date('2026-09-01T00:00:00Z')
const model = { id: 'model-1', vendorId: 'vendor-1', platform: 'Catalyst 9300' }
const approvedRelease = {
  id: 'fw-1',
  vendorId: 'vendor-1',
  platform: 'Catalyst 9300',
  version: '17.15.5',
  status: 'APPROVED',
  isActive: true,
  releasedAt: now,
  firmwareTrain: { id: 'train-1', name: '17.15.x' },
}

function policyRecord(release = approvedRelease, id = 'policy-1') {
  return {
    id,
    targetFirmwareReleaseId: release.id,
    isActive: true,
    notes: null,
    deviceModelId: 'model-1',
    createdAt: now,
    updatedAt: now,
    targetFirmwareRelease: release,
  }
}

describe('model desired firmware policy persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modelFindUnique.mockResolvedValue(model)
    mocks.releaseFindUnique.mockResolvedValue(approvedRelease)
    mocks.policyFindFirst.mockResolvedValue(null)
    mocks.policyUpdateMany.mockResolvedValue({ count: 0 })
    mocks.policyCreate.mockResolvedValue(policyRecord())
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwarePolicy: {
        updateMany: mocks.policyUpdateMany,
        create: mocks.policyCreate,
      },
    }))
  })

  it('creates an exact active model-baseline policy', async () => {
    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1')

    expect(mocks.policyUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deviceModelId: 'model-1', isActive: true, customerId: null, contractTypeId: null, deviceId: null, vendorId: null, deviceTypeId: null }),
      data: { isActive: false },
    }))
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { deviceModelId: 'model-1', targetFirmwareReleaseId: 'fw-1', isActive: true },
    }))
    expect(result.release.version).toBe('17.15.5')
  })

  it('changes policy by preserving the old row as inactive and creating a new exact target', async () => {
    const oldRelease = { ...approvedRelease, id: 'fw-old', version: '17.15.3' }
    mocks.policyFindFirst.mockResolvedValue(policyRecord(oldRelease, 'policy-old'))
    mocks.policyCreate.mockResolvedValue(policyRecord(approvedRelease, 'policy-new'))

    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1')

    expect(mocks.policyUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ targetFirmwareReleaseId: 'fw-1' }) }))
    expect(result.id).toBe('policy-new')
  })

  it('does not create a new row when the exact desired release is already active', async () => {
    mocks.policyFindFirst.mockResolvedValue(policyRecord())

    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1')

    expect(result.id).toBe('policy-1')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('accepts RECOMMENDED as a normal desired target', async () => {
    const recommended = { ...approvedRelease, id: 'fw-rec', status: 'RECOMMENDED' }
    mocks.releaseFindUnique.mockResolvedValue(recommended)
    mocks.policyCreate.mockResolvedValue(policyRecord(recommended, 'policy-rec'))

    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-rec')).resolves.toMatchObject({ id: 'policy-rec' })
  })

  it('rejects desired firmware from another vendor', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...approvedRelease, vendorId: 'vendor-2' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects a platform/family mismatch after normalization', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...approvedRelease, platform: 'IOS XR' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
  })

  it('allows vendor-compatible releases when the model has no platform/family', async () => {
    mocks.modelFindUnique.mockResolvedValue({ ...model, platform: null })
    mocks.releaseFindUnique.mockResolvedValue({ ...approvedRelease, platform: 'Any vendor platform' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).resolves.toMatchObject({ release: expect.objectContaining({ version: '17.15.5' }) })
  })

  it('rejects archived releases as new desired targets', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...approvedRelease, isActive: false })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
  })

  it('rejects AVAILABLE firmware as a normal desired target', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...approvedRelease, status: 'AVAILABLE' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
  })

  it('clears the active model policy without deleting historical rows', async () => {
    mocks.policyUpdateMany.mockResolvedValue({ count: 1 })
    const result = await clearModelDesiredFirmwarePolicy('model-1')

    expect(result).toEqual({ cleared: true })
    expect(mocks.policyUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }))
  })

  it('continues resolving an existing archived target for historical integrity', async () => {
    const archived = { ...approvedRelease, isActive: false, status: 'DEPRECATED' }
    mocks.policyFindFirst.mockResolvedValue(policyRecord(archived))

    const result = await getActiveModelDesiredPolicy('model-1')

    expect(result?.release).toMatchObject({ id: 'fw-1', isActive: false, status: 'DEPRECATED' })
  })
})
