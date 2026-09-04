import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelFindMany: vi.fn(),
  releaseFindUnique: vi.fn(),
  policyFindMany: vi.fn(),
  policyFindFirst: vi.fn(),
  policyUpdateMany: vi.fn(),
  policyCreate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: { findMany: mocks.modelFindMany },
    firmwareRelease: { findUnique: mocks.releaseFindUnique },
    firmwarePolicy: { findMany: mocks.policyFindMany, findFirst: mocks.policyFindFirst },
    $transaction: mocks.transaction,
  },
}))

import {
  bulkClearModelDesiredFirmwarePolicies,
  bulkSetModelDesiredFirmwarePolicies,
  clearModelDesiredFirmwarePolicy,
  FirmwarePolicyCompatibilityError,
  getActiveModelDesiredPolicy,
  setModelDesiredFirmwarePolicy,
} from '@/lib/firmware-policy-store'

const now = new Date('2026-09-01T00:00:00Z')
const model = { id: 'model-1', vendorId: 'vendor-1', platform: 'Catalyst 9300', model: 'C9300-24P' }
const allowedRelease = {
  id: 'fw-1',
  vendorId: 'vendor-1',
  platform: 'Catalyst 9300',
  version: '17.15.5',
  logicalVersion: '17.15.5',
  variant: null,
  imageCode: null,
  catalogState: 'VERIFIED',
  policyEligibility: 'ALLOWED',
  variantEquivalence: 'EXACT_ONLY',
  status: 'APPROVED',
  isActive: true,
  releasedAt: now,
  firmwareTrain: { id: 'train-1', name: '17.15.x' },
}

function policyRecord(release = allowedRelease, id = 'policy-1', deviceModelId = 'model-1') {
  return {
    id,
    targetFirmwareReleaseId: release.id,
    isActive: true,
    notes: null,
    deviceModelId,
    createdAt: now,
    updatedAt: now,
    targetFirmwareRelease: release,
  }
}

describe('model desired firmware policy persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modelFindMany.mockResolvedValue([model])
    mocks.releaseFindUnique.mockResolvedValue(allowedRelease)
    mocks.policyFindMany.mockResolvedValue([])
    mocks.policyFindFirst.mockResolvedValue(policyRecord(allowedRelease, 'policy-new'))
    mocks.policyUpdateMany.mockResolvedValue({ count: 0 })
    mocks.policyCreate.mockResolvedValue({ id: 'policy-new', targetFirmwareReleaseId: 'fw-1' })
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwarePolicy: { updateMany: mocks.policyUpdateMany, create: mocks.policyCreate },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('creates an exact active model-baseline policy and appends catalog semantics to audit', async () => {
    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1', 'user-1')

    expect(mocks.policyUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deviceModelId: 'model-1', isActive: true, customerId: null, contractTypeId: null, deviceId: null, vendorId: null, deviceTypeId: null }),
      data: { isActive: false },
    }))
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { deviceModelId: 'model-1', targetFirmwareReleaseId: 'fw-1', isActive: true },
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        action: 'DESIRED_FIRMWARE_CHANGED',
        after: expect.objectContaining({ version: '17.15.5', catalogState: 'VERIFIED', policyEligibility: 'ALLOWED' }),
      }),
    }))
    expect(result.release.version).toBe('17.15.5')
  })

  it('changes policy by preserving the old row as inactive and creating a new exact target', async () => {
    const oldRelease = { ...allowedRelease, id: 'fw-old', version: '17.15.3', logicalVersion: '17.15.3' }
    mocks.policyFindMany.mockResolvedValue([policyRecord(oldRelease, 'policy-old')])
    mocks.policyFindFirst.mockResolvedValue(policyRecord(allowedRelease, 'policy-new'))

    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1')

    expect(mocks.policyUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ targetFirmwareReleaseId: 'fw-1' }) }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before: expect.objectContaining({ version: '17.15.3' }), after: expect.objectContaining({ version: '17.15.5' }) }),
    }))
    expect(result.id).toBe('policy-new')
  })

  it('does not create a new row or audit event when the exact desired release is already active', async () => {
    mocks.policyFindMany.mockResolvedValue([policyRecord()])
    mocks.policyFindFirst.mockResolvedValue(policyRecord())
    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1')
    expect(result.id).toBe('policy-1')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('accepts PREFERRED as a normal desired target independent of legacy status naming', async () => {
    const preferred = { ...allowedRelease, id: 'fw-pref', policyEligibility: 'PREFERRED', status: 'RECOMMENDED' }
    mocks.releaseFindUnique.mockResolvedValue(preferred)
    mocks.policyCreate.mockResolvedValue({ id: 'policy-pref', targetFirmwareReleaseId: 'fw-pref' })
    mocks.policyFindFirst.mockResolvedValue(policyRecord(preferred, 'policy-pref'))
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-pref')).resolves.toMatchObject({ id: 'policy-pref' })
  })

  it('rejects desired firmware from another vendor', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...allowedRelease, vendorId: 'vendor-2' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects a platform/family mismatch after normalization', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...allowedRelease, platform: 'IOS XR' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
  })

  it('allows vendor-compatible releases when the model has no platform/family', async () => {
    mocks.modelFindMany.mockResolvedValue([{ ...model, platform: null }])
    mocks.releaseFindUnique.mockResolvedValue({ ...allowedRelease, platform: 'Any vendor platform' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).resolves.toMatchObject({ release: expect.objectContaining({ version: '17.15.5' }) })
  })

  it('rejects archived, blocked, withdrawn, or not-evaluated releases as new desired targets', async () => {
    for (const release of [
      { ...allowedRelease, isActive: false },
      { ...allowedRelease, catalogState: 'BLOCKED', policyEligibility: 'DISALLOWED', status: 'BLOCKED' },
      { ...allowedRelease, catalogState: 'WITHDRAWN', policyEligibility: 'DISALLOWED', status: 'DEPRECATED' },
      { ...allowedRelease, policyEligibility: 'NOT_EVALUATED', status: 'AVAILABLE' },
    ]) {
      mocks.releaseFindUnique.mockResolvedValue(release)
      await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
    }
  })

  it('clears the active model policy without deleting historical rows and audits the clear', async () => {
    mocks.policyFindMany.mockResolvedValue([policyRecord()])
    mocks.policyUpdateMany.mockResolvedValue({ count: 1 })
    const result = await clearModelDesiredFirmwarePolicy('model-1', 'user-1')

    expect(result).toEqual({ cleared: true })
    expect(mocks.policyUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        action: 'DESIRED_FIRMWARE_CLEARED',
        before: expect.objectContaining({ version: '17.15.5', policyEligibility: 'ALLOWED' }),
        after: expect.objectContaining({ version: null }),
      }),
    }))
  })

  it('continues resolving an existing archived target for historical integrity', async () => {
    const archived = { ...allowedRelease, isActive: false, catalogState: 'WITHDRAWN', policyEligibility: 'DISALLOWED', status: 'DEPRECATED' }
    mocks.policyFindFirst.mockResolvedValue(policyRecord(archived))
    const result = await getActiveModelDesiredPolicy('model-1')
    expect(result?.release).toMatchObject({ id: 'fw-1', isActive: false, catalogState: 'WITHDRAWN', policyEligibility: 'DISALLOWED' })
  })

  it('applies one exact release to multiple compatible models in one transaction', async () => {
    const second = { id: 'model-2', vendorId: 'vendor-1', platform: ' catalyst   9300 ', model: 'C9300-48P' }
    mocks.modelFindMany.mockResolvedValue([model, second])
    mocks.policyCreate
      .mockResolvedValueOnce({ id: 'policy-model-1', targetFirmwareReleaseId: 'fw-1' })
      .mockResolvedValueOnce({ id: 'policy-model-2', targetFirmwareReleaseId: 'fw-1' })

    const result = await bulkSetModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'fw-1', 'user-1')
    expect(result).toEqual({ changed: 2, unchanged: 0, modelIds: ['model-1', 'model-2'] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.policyCreate).toHaveBeenCalledTimes(2)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2)
  })

  it('blocks setting firmware across a mixed-vendor selection', async () => {
    mocks.modelFindMany.mockResolvedValue([model, { id: 'model-2', vendorId: 'vendor-2', platform: 'Catalyst 9300', model: 'Other' }])
    await expect(bulkSetModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('blocks a target that is not compatible with every selected concrete platform', async () => {
    mocks.modelFindMany.mockResolvedValue([model, { id: 'model-2', vendorId: 'vendor-1', platform: 'Catalyst 9200', model: 'C9200-24P' }])
    await expect(bulkSetModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('clears desired firmware for multiple selected models atomically', async () => {
    const second = { id: 'model-2', vendorId: 'vendor-2', platform: 'Other', model: 'Other' }
    mocks.modelFindMany.mockResolvedValue([model, second])
    mocks.policyFindMany.mockResolvedValue([
      policyRecord(allowedRelease, 'policy-1', 'model-1'),
      policyRecord({ ...allowedRelease, id: 'fw-2', vendorId: 'vendor-2', platform: 'Other' }, 'policy-2', 'model-2'),
    ])

    const result = await bulkClearModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'user-1')
    expect(result).toEqual({ changed: 2, unchanged: 0, modelIds: ['model-1', 'model-2'] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.policyUpdateMany).toHaveBeenCalledTimes(2)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2)
  })

  it('propagates a transactional failure instead of reporting partial bulk success', async () => {
    const second = { id: 'model-2', vendorId: 'vendor-1', platform: 'Catalyst 9300', model: 'C9300-48P' }
    mocks.modelFindMany.mockResolvedValue([model, second])
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit write failed'))
    await expect(bulkSetModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'fw-1')).rejects.toThrow('audit write failed')
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})
