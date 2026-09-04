import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelFindMany: vi.fn(),
  modelFindUnique: vi.fn(),
  familyFindUnique: vi.fn(),
  customerFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  deviceFindUnique: vi.fn(),
  trainFindUnique: vi.fn(),
  releaseFindUnique: vi.fn(),
  releaseFindMany: vi.fn(),
  policyFindMany: vi.fn(),
  policyFindFirst: vi.fn(),
  policyUpdateMany: vi.fn(),
  policyCreate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: { findMany: mocks.modelFindMany, findUnique: mocks.modelFindUnique },
    deviceModelFamily: { findUnique: mocks.familyFindUnique },
    customer: { findUnique: mocks.customerFindUnique },
    site: { findUnique: mocks.siteFindUnique },
    device: { findUnique: mocks.deviceFindUnique },
    firmwareTrain: { findUnique: mocks.trainFindUnique },
    firmwareRelease: { findUnique: mocks.releaseFindUnique, findMany: mocks.releaseFindMany },
    firmwarePolicy: { findMany: mocks.policyFindMany, findFirst: mocks.policyFindFirst },
    $transaction: mocks.transaction,
  },
}))

import {
  appendFirmwarePolicyVersion,
  bulkClearModelDesiredFirmwarePolicies,
  bulkSetModelDesiredFirmwarePolicies,
  clearModelDesiredFirmwarePolicy,
  FirmwarePolicyCompatibilityError,
  getActiveModelDesiredPolicy,
  resolveEffectiveFirmwarePolicyForDevice,
  setModelDesiredFirmwarePolicy,
} from '@/lib/firmware-policy-store'

const now = new Date('2026-09-01T00:00:00Z')
const model = { id: 'model-1', vendorId: 'vendor-1', platform: 'AOS-8', model: 'AP-515' }
const allowedRelease = {
  id: 'fw-1',
  vendorId: 'vendor-1',
  platform: 'AOS-10',
  version: '10.7.0.1',
  logicalVersion: '10.7.0.1',
  variant: null,
  imageCode: null,
  catalogState: 'VERIFIED',
  policyEligibility: 'ALLOWED',
  variantEquivalence: 'EXACT_ONLY',
  status: 'APPROVED',
  isActive: true,
  releasedAt: now,
  firmwareTrain: { id: 'train-1', name: '10.7' },
}

function policyRecord(
  release = allowedRelease,
  id = 'policy-1',
  deviceModelId: string | null = 'model-1',
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    policyMode: 'EXACT',
    trackKey: 'default',
    trackName: 'Default',
    trackClass: 'PREFERRED',
    isDefaultTrack: true,
    desiredPlatform: release.platform,
    minimumFirmwareReleaseId: null,
    targetFirmwareReleaseId: release.id,
    maximumFirmwareReleaseId: null,
    firmwareTrainId: null,
    minimumInclusive: true,
    maximumInclusive: true,
    effectiveFrom: now,
    policyVersion: 1,
    isActive: true,
    notes: null,
    deviceModelFamilyId: null,
    deviceModelId,
    customerId: null,
    siteId: null,
    deviceId: null,
    contractTypeId: null,
    vendorId: null,
    deviceTypeId: null,
    createdAt: now,
    updatedAt: now,
    minimumFirmwareRelease: null,
    targetFirmwareRelease: release,
    maximumFirmwareRelease: null,
    firmwareTrain: null,
    ...overrides,
  }
}

describe('model desired firmware policy compatibility persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modelFindMany.mockResolvedValue([model])
    mocks.modelFindUnique.mockResolvedValue({ id: 'model-1', vendorId: 'vendor-1', familyId: 'family-1' })
    mocks.familyFindUnique.mockResolvedValue({ id: 'family-1', vendorId: 'vendor-1' })
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1' })
    mocks.siteFindUnique.mockResolvedValue({ id: 'site-1', customerId: 'customer-1' })
    mocks.deviceFindUnique.mockResolvedValue({
      id: 'device-1',
      customerId: 'customer-1',
      siteId: 'site-1',
      deviceModelId: 'model-1',
      deviceModel: { id: 'model-1', vendorId: 'vendor-1', familyId: 'family-1' },
    })
    mocks.trainFindUnique.mockResolvedValue({ id: 'train-1', vendorId: 'vendor-1', platform: 'AOS-10', isActive: true })
    mocks.releaseFindUnique.mockResolvedValue(allowedRelease)
    mocks.releaseFindMany.mockResolvedValue([])
    mocks.policyFindMany.mockResolvedValue([])
    mocks.policyFindFirst.mockResolvedValue(policyRecord(allowedRelease, 'policy-new'))
    mocks.policyUpdateMany.mockResolvedValue({ count: 0 })
    mocks.policyCreate.mockResolvedValue({ id: 'policy-new', targetFirmwareReleaseId: 'fw-1', policyVersion: 1 })
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwarePolicy: { updateMany: mocks.policyUpdateMany, create: mocks.policyCreate },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('creates an append-only exact model policy with catalog semantics in audit', async () => {
    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1', 'user-1')

    expect(mocks.policyUpdateMany).not.toHaveBeenCalled()
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deviceModelId: 'model-1',
        policyMode: 'EXACT',
        trackKey: 'default',
        desiredPlatform: 'AOS-10',
        targetFirmwareReleaseId: 'fw-1',
        policyVersion: 1,
      }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        action: 'DESIRED_FIRMWARE_CHANGED',
        after: expect.objectContaining({ version: '10.7.0.1', catalogState: 'VERIFIED', policyEligibility: 'ALLOWED' }),
      }),
    }))
    expect(result.release?.version).toBe('10.7.0.1')
  })

  it('changes policy by preserving the old row and appending a new version', async () => {
    const oldRelease = { ...allowedRelease, id: 'fw-old', version: '10.6.0.3', logicalVersion: '10.6.0.3' }
    mocks.policyFindMany.mockResolvedValue([policyRecord(oldRelease, 'policy-old')])
    mocks.policyFindFirst.mockResolvedValue(policyRecord(allowedRelease, 'policy-new', 'model-1', { policyVersion: 2 }))
    mocks.policyCreate.mockResolvedValue({ id: 'policy-new', targetFirmwareReleaseId: 'fw-1', policyVersion: 2 })

    const result = await setModelDesiredFirmwarePolicy('model-1', 'fw-1')

    expect(mocks.policyUpdateMany).not.toHaveBeenCalled()
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ targetFirmwareReleaseId: 'fw-1', policyVersion: 2 }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before: expect.objectContaining({ version: '10.6.0.3' }), after: expect.objectContaining({ version: '10.7.0.1' }) }),
    }))
    expect(result.id).toBe('policy-new')
  })

  it('does not append another row when the same exact target is already effective', async () => {
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
    mocks.policyCreate.mockResolvedValue({ id: 'policy-pref', targetFirmwareReleaseId: 'fw-pref', policyVersion: 1 })
    mocks.policyFindFirst.mockResolvedValue(policyRecord(preferred, 'policy-pref'))
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-pref')).resolves.toMatchObject({ id: 'policy-pref' })
  })

  it('rejects desired firmware from another vendor', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...allowedRelease, vendorId: 'vendor-2' })
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('allows cross-platform desired policy so AOS-8 hardware can intentionally target an AOS-10 track', async () => {
    await expect(setModelDesiredFirmwarePolicy('model-1', 'fw-1')).resolves.toMatchObject({
      release: expect.objectContaining({ platform: 'AOS-10' }),
    })
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

  it('clears the model override without deleting historical rows and audits the clear', async () => {
    mocks.policyFindMany.mockResolvedValue([policyRecord()])
    mocks.policyUpdateMany.mockResolvedValue({ count: 1 })
    const result = await clearModelDesiredFirmwarePolicy('model-1', 'user-1')

    expect(result).toEqual({ cleared: true })
    expect(mocks.policyUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        action: 'DESIRED_FIRMWARE_CLEARED',
        before: expect.objectContaining({ version: '10.7.0.1', policyEligibility: 'ALLOWED' }),
      }),
    }))
  })

  it('continues resolving an existing archived target for historical integrity', async () => {
    const archived = { ...allowedRelease, isActive: false, catalogState: 'WITHDRAWN', policyEligibility: 'DISALLOWED', status: 'DEPRECATED' }
    mocks.policyFindFirst.mockResolvedValue(policyRecord(archived))
    const result = await getActiveModelDesiredPolicy('model-1')
    expect(result?.release).toMatchObject({ id: 'fw-1', isActive: false, catalogState: 'WITHDRAWN', policyEligibility: 'DISALLOWED' })
  })

  it('applies one exact release to multiple compatible-vendor models in one transaction', async () => {
    const second = { id: 'model-2', vendorId: 'vendor-1', platform: 'AOS-8', model: 'AP-505' }
    mocks.modelFindMany.mockResolvedValue([model, second])
    mocks.policyCreate
      .mockResolvedValueOnce({ id: 'policy-model-1', targetFirmwareReleaseId: 'fw-1', policyVersion: 1 })
      .mockResolvedValueOnce({ id: 'policy-model-2', targetFirmwareReleaseId: 'fw-1', policyVersion: 1 })

    const result = await bulkSetModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'fw-1', 'user-1')
    expect(result).toEqual({ changed: 2, unchanged: 0, modelIds: ['model-1', 'model-2'] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.policyCreate).toHaveBeenCalledTimes(2)
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2)
  })

  it('blocks setting firmware across a mixed-vendor selection', async () => {
    mocks.modelFindMany.mockResolvedValue([model, { id: 'model-2', vendorId: 'vendor-2', platform: 'AOS-8', model: 'Other' }])
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
    const second = { id: 'model-2', vendorId: 'vendor-1', platform: 'AOS-8', model: 'AP-505' }
    mocks.modelFindMany.mockResolvedValue([model, second])
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit write failed'))
    await expect(bulkSetModelDesiredFirmwarePolicies(['model-1', 'model-2'], 'fw-1')).rejects.toThrow('audit write failed')
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})

describe('scoped policy foundation persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.familyFindUnique.mockResolvedValue({ id: 'family-1', vendorId: 'vendor-1' })
    mocks.policyFindFirst.mockResolvedValue(null)
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwarePolicy: { create: mocks.policyCreate },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('persists a RANGE family track with a separate acceptance window and preferred target', async () => {
    const minimum = { ...allowedRelease, id: 'fw-min', version: '10.6.0.1', logicalVersion: '10.6.0.1' }
    const preferred = { ...allowedRelease, id: 'fw-pref', version: '10.7.0.1', logicalVersion: '10.7.0.1' }
    const maximum = { ...allowedRelease, id: 'fw-max', version: '10.8.0.0', logicalVersion: '10.8.0.0' }
    mocks.releaseFindMany.mockResolvedValue([minimum, preferred, maximum])
    mocks.policyCreate.mockResolvedValue(policyRecord(preferred, 'policy-range', null, {
      policyMode: 'RANGE',
      trackKey: 'preferred-aos10',
      trackName: 'Preferred AOS-10',
      desiredPlatform: 'AOS-10',
      minimumFirmwareReleaseId: 'fw-min',
      targetFirmwareReleaseId: 'fw-pref',
      maximumFirmwareReleaseId: 'fw-max',
      maximumInclusive: false,
      deviceModelFamilyId: 'family-1',
      minimumFirmwareRelease: minimum,
      targetFirmwareRelease: preferred,
      maximumFirmwareRelease: maximum,
    }))

    const result = await appendFirmwarePolicyVersion({
      deviceModelFamilyId: 'family-1',
      policyMode: 'RANGE',
      trackKey: 'preferred-aos10',
      trackName: 'Preferred AOS-10',
      trackClass: 'PREFERRED',
      desiredPlatform: 'AOS-10',
      minimumFirmwareReleaseId: 'fw-min',
      targetFirmwareReleaseId: 'fw-pref',
      maximumFirmwareReleaseId: 'fw-max',
      maximumInclusive: false,
    }, 'user-1')

    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        policyMode: 'RANGE',
        deviceModelFamilyId: 'family-1',
        minimumFirmwareReleaseId: 'fw-min',
        targetFirmwareReleaseId: 'fw-pref',
        maximumFirmwareReleaseId: 'fw-max',
        maximumInclusive: false,
        policyVersion: 1,
      }),
    }))
    expect(result).toMatchObject({ policyMode: 'RANGE', trackKey: 'preferred-aos10', maximumInclusive: false })
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'FirmwarePolicy', action: 'DESIRED_FIRMWARE_CHANGED' }),
    }))
  })

  it('loads candidates for a device and returns the central resolver result with provenance', async () => {
    mocks.deviceFindUnique.mockResolvedValue({
      id: 'device-1',
      customerId: 'customer-1',
      siteId: 'site-1',
      deviceModelId: 'model-1',
      deviceModel: { familyId: 'family-1' },
    })
    mocks.policyFindMany.mockResolvedValue([
      policyRecord(allowedRelease, 'family', null, { deviceModelFamilyId: 'family-1' }),
      policyRecord(allowedRelease, 'customer', null, { deviceModelFamilyId: 'family-1', customerId: 'customer-1' }),
      policyRecord(allowedRelease, 'site', null, { deviceModelFamilyId: 'family-1', siteId: 'site-1' }),
    ])

    const result = await resolveEffectiveFirmwarePolicyForDevice('device-1', new Date('2026-09-04T00:00:00Z'))
    expect(result).toMatchObject({ status: 'RESOLVED', policy: { id: 'site' }, source: { scope: 'SITE', policyId: 'site' } })
  })
})
