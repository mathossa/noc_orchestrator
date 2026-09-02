import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  modelFindMany: vi.fn(),
  releaseFindUnique: vi.fn(),
  policyFindMany: vi.fn(),
  txPolicyFindMany: vi.fn(),
  policyUpdateMany: vi.fn(),
  policyCreate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceModel: { findMany: mocks.modelFindMany },
    firmwareRelease: { findUnique: mocks.releaseFindUnique },
    firmwarePolicy: { findMany: mocks.policyFindMany },
    $transaction: mocks.transaction,
  },
}))

import {
  bulkClearModelDesiredFirmwarePolicies,
  bulkSetModelDesiredFirmwarePolicies,
  FirmwarePolicyCompatibilityError,
  getActiveModelDesiredPolicy,
  getActiveModelDesiredPolicies,
} from '@/lib/firmware-policy-store'

const now = new Date('2026-09-01T00:00:00Z')
const catalystModel = {
  id: 'model-1',
  vendorId: 'vendor-cisco',
  platform: 'IOS XE',
  model: 'C9300-24P',
  supportedPlatforms: [{ platform: 'IOS XE' }],
}
const catalystRelease = {
  id: 'fw-cisco',
  vendorId: 'vendor-cisco',
  platform: 'IOS XE',
  version: '17.15.5',
  status: 'APPROVED',
  isActive: true,
  releasedAt: now,
  firmwareTrain: { id: 'train-cisco', name: '17.15.x' },
}
const ap315 = {
  id: 'ap315',
  vendorId: 'vendor-aruba',
  platform: null,
  model: 'AP315',
  supportedPlatforms: [{ platform: 'AOS-8' }, { platform: 'AOS-10' }],
}
const aos8Release = {
  id: 'fw-aos8',
  vendorId: 'vendor-aruba',
  platform: 'AOS-8',
  version: '8.10.0.20',
  status: 'APPROVED',
  isActive: true,
  releasedAt: now,
  firmwareTrain: null,
}
const aos10Release = {
  id: 'fw-aos10',
  vendorId: 'vendor-aruba',
  platform: 'AOS-10',
  version: '10.7.0.1',
  status: 'RECOMMENDED',
  isActive: true,
  releasedAt: now,
  firmwareTrain: null,
}

function policyRecord(
  id: string,
  modelId: string,
  release: typeof catalystRelease | typeof aos8Release | typeof aos10Release,
) {
  return {
    id,
    targetFirmwareReleaseId: release.id,
    platform: release.platform,
    isActive: true,
    notes: null,
    deviceModelId: modelId,
    createdAt: now,
    updatedAt: now,
    targetFirmwareRelease: release,
  }
}

describe('platform-aware model desired firmware policies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.modelFindMany.mockResolvedValue([catalystModel])
    mocks.releaseFindUnique.mockResolvedValue(catalystRelease)
    mocks.policyFindMany.mockResolvedValue([])
    mocks.txPolicyFindMany.mockResolvedValue([])
    mocks.policyUpdateMany.mockResolvedValue({ count: 0 })
    mocks.policyCreate.mockResolvedValue({ id: 'policy-new', targetFirmwareReleaseId: catalystRelease.id })
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwarePolicy: {
        findMany: mocks.txPolicyFindMany,
        updateMany: mocks.policyUpdateMany,
        create: mocks.policyCreate,
      },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('selects the active desired policy for the requested model platform', async () => {
    mocks.policyFindMany.mockResolvedValue([
      policyRecord('policy-10', 'ap315', aos10Release),
      policyRecord('policy-8', 'ap315', aos8Release),
    ])

    await expect(getActiveModelDesiredPolicy('ap315', 'AOS-8')).resolves.toMatchObject({
      id: 'policy-8',
      platform: 'AOS-8',
      release: { id: 'fw-aos8' },
    })
    await expect(getActiveModelDesiredPolicy('ap315', 'AOS-10')).resolves.toMatchObject({
      id: 'policy-10',
      platform: 'AOS-10',
      release: { id: 'fw-aos10' },
    })
  })

  it('returns one active desired policy per platform for a dual-platform model', async () => {
    mocks.policyFindMany.mockResolvedValue([
      policyRecord('policy-10-new', 'ap315', aos10Release),
      policyRecord('policy-10-old', 'ap315', { ...aos10Release, id: 'fw-aos10-old', version: '10.6.0.0' }),
      policyRecord('policy-8', 'ap315', aos8Release),
    ])

    const result = await getActiveModelDesiredPolicies('ap315')
    expect(result.map((policy) => [policy.platform, policy.release.id])).toEqual([
      ['AOS-10', 'fw-aos10'],
      ['AOS-8', 'fw-aos8'],
    ])
  })

  it('updates AP315/AOS-10 without deactivating the AP315/AOS-8 desired policy', async () => {
    const oldAos10 = { ...aos10Release, id: 'fw-aos10-old', version: '10.6.0.0' }
    mocks.modelFindMany.mockResolvedValue([ap315])
    mocks.releaseFindUnique.mockResolvedValue(aos10Release)
    mocks.policyFindMany.mockResolvedValue([
      policyRecord('policy-8', 'ap315', aos8Release),
      policyRecord('policy-10-old', 'ap315', oldAos10),
    ])
    mocks.txPolicyFindMany.mockResolvedValue([
      { id: 'policy-8', platform: 'AOS-8' },
      { id: 'policy-10-old', platform: 'AOS-10' },
    ])
    mocks.policyCreate.mockResolvedValue({ id: 'policy-10-new', targetFirmwareReleaseId: aos10Release.id })

    const result = await bulkSetModelDesiredFirmwarePolicies(['ap315'], aos10Release.id, 'user-1')

    expect(result).toEqual({ changed: 1, unchanged: 0, modelIds: ['ap315'] })
    expect(mocks.policyUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.policyUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['policy-10-old'] } },
      data: { isActive: false },
    })
    expect(mocks.policyCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deviceModelId: 'ap315',
        targetFirmwareReleaseId: 'fw-aos10',
        platform: 'AOS-10',
        isActive: true,
      }),
    }))
  })

  it('does nothing when the exact model/platform target is already active', async () => {
    mocks.modelFindMany.mockResolvedValue([ap315])
    mocks.releaseFindUnique.mockResolvedValue(aos10Release)
    mocks.policyFindMany.mockResolvedValue([policyRecord('policy-10', 'ap315', aos10Release)])

    await expect(bulkSetModelDesiredFirmwarePolicies(['ap315'], aos10Release.id)).resolves.toEqual({
      changed: 0,
      unchanged: 1,
      modelIds: ['ap315'],
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('accepts either supported AP315 platform but rejects an unsupported platform', async () => {
    mocks.modelFindMany.mockResolvedValue([ap315])
    mocks.releaseFindUnique.mockResolvedValue(aos8Release)
    await expect(bulkSetModelDesiredFirmwarePolicies(['ap315'], aos8Release.id)).resolves.toMatchObject({ changed: 1 })

    mocks.releaseFindUnique.mockResolvedValue({ ...aos10Release, platform: 'Instant 6' })
    await expect(bulkSetModelDesiredFirmwarePolicies(['ap315'], aos10Release.id))
      .rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
  })

  it('rejects desired firmware from another vendor', async () => {
    mocks.releaseFindUnique.mockResolvedValue({ ...catalystRelease, vendorId: 'other-vendor' })
    await expect(bulkSetModelDesiredFirmwarePolicies(['model-1'], catalystRelease.id))
      .rejects.toBeInstanceOf(FirmwarePolicyCompatibilityError)
  })

  it('clears all platform-scoped desired policies for a model without deleting history', async () => {
    mocks.modelFindMany.mockResolvedValue([ap315])
    mocks.policyFindMany.mockResolvedValue([
      policyRecord('policy-8', 'ap315', aos8Release),
      policyRecord('policy-10', 'ap315', aos10Release),
    ])

    await expect(bulkClearModelDesiredFirmwarePolicies(['ap315'], 'user-1')).resolves.toEqual({
      changed: 1,
      unchanged: 0,
      modelIds: ['ap315'],
    })
    expect(mocks.policyUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { isActive: false },
      where: expect.objectContaining({ deviceModelId: 'ap315', isActive: true }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'DESIRED_FIRMWARE_CLEARED',
        before: expect.objectContaining({ policies: expect.arrayContaining([
          expect.objectContaining({ platform: 'AOS-8' }),
          expect.objectContaining({ platform: 'AOS-10' }),
        ]) }),
      }),
    }))
  })
})
