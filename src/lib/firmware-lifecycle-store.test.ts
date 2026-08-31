import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deviceFindUnique: vi.fn(),
  policyFindFirst: vi.fn(),
  lifecycleFindUnique: vi.fn(),
  lifecycleUpsert: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: { findUnique: mocks.deviceFindUnique },
    firmwarePolicy: { findFirst: mocks.policyFindFirst },
    firmwareLifecycleRecord: {
      findUnique: mocks.lifecycleFindUnique,
      upsert: mocks.lifecycleUpsert,
    },
    auditEvent: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}))

import {
  FirmwareLifecyclePolicyError,
  setFirmwareLifecycleDecision,
} from '@/lib/firmware-lifecycle-store'

const desiredRelease = {
  id: 'release-desired',
  vendorId: 'vendor-1',
  platform: 'IOS XE',
  version: '17.15.5',
  status: 'APPROVED',
  isActive: true,
  releasedAt: new Date('2026-08-20T00:00:00Z'),
  firmwareTrain: { id: 'train-1', name: '17.15.x' },
}

const desiredPolicy = {
  id: 'policy-1',
  targetFirmwareReleaseId: desiredRelease.id,
  isActive: true,
  notes: null,
  deviceModelId: 'model-1',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  targetFirmwareRelease: desiredRelease,
}

function storedLifecycle(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-01T10:00:00Z')
  return {
    id: 'lifecycle-1',
    deviceId: 'device-1',
    targetFirmwareReleaseId: desiredRelease.id,
    state: 'PLANNED' as const,
    reason: null,
    notes: null,
    plannedFor: null,
    reviewAt: null,
    decidedAt: now,
    decidedByUserId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    targetFirmwareRelease: {
      id: desiredRelease.id,
      vendorId: desiredRelease.vendorId,
      platform: desiredRelease.platform,
      version: desiredRelease.version,
      status: desiredRelease.status,
      isActive: desiredRelease.isActive,
      firmwareTrain: desiredRelease.firmwareTrain,
    },
    decidedBy: null,
    ...overrides,
  }
}

function currentLifecycle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lifecycle-1',
    targetFirmwareReleaseId: desiredRelease.id,
    state: 'PLANNED' as const,
    reason: null,
    notes: null,
    plannedFor: null,
    reviewAt: null,
    decidedAt: new Date('2026-09-01T09:00:00Z'),
    completedAt: null,
    targetFirmwareRelease: { version: desiredRelease.version },
    ...overrides,
  }
}

describe('firmware lifecycle persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deviceFindUnique.mockResolvedValue({ id: 'device-1', deviceModelId: 'model-1', customerId: 'customer-1' })
    mocks.policyFindFirst.mockResolvedValue(desiredPolicy)
    mocks.lifecycleFindUnique.mockResolvedValue(null)
    mocks.lifecycleUpsert.mockResolvedValue(storedLifecycle())
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      firmwareLifecycleRecord: {
        findUnique: mocks.lifecycleFindUnique,
        upsert: mocks.lifecycleUpsert,
      },
      auditEvent: { create: mocks.auditCreate },
    }))
  })

  it('snapshots the desired release and appends a PLANNED audit event', async () => {
    await setFirmwareLifecycleDecision('device-1', {
      state: 'PLANNED',
      plannedFor: '2026-09-15T20:00:00Z',
      notes: 'After business hours.',
    }, 'user-1')

    expect(mocks.lifecycleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { deviceId: 'device-1' },
      create: expect.objectContaining({
        targetFirmwareReleaseId: 'release-desired',
        state: 'PLANNED',
        notes: 'After business hours.',
        decidedByUserId: 'user-1',
        completedAt: null,
      }),
      update: expect.objectContaining({ targetFirmwareReleaseId: 'release-desired' }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        customerId: 'customer-1',
        action: 'FIRMWARE_LIFECYCLE_PLANNED',
        entityType: 'Device',
        entityId: 'device-1',
        after: expect.objectContaining({ state: 'PLANNED', targetVersion: '17.15.5', notes: 'After business hours.' }),
      }),
    }))
  })

  it('keeps customer decline distinct and audits its reason/review context', async () => {
    mocks.lifecycleFindUnique.mockResolvedValue(currentLifecycle())
    mocks.lifecycleUpsert.mockResolvedValue(storedLifecycle({
      state: 'CUSTOMER_DECLINED',
      reason: 'Customer did not approve outage.',
      reviewAt: new Date('2026-12-01T10:00:00Z'),
    }))

    const result = await setFirmwareLifecycleDecision('device-1', {
      state: 'CUSTOMER_DECLINED',
      reason: 'Customer did not approve outage.',
      reviewAt: '2026-12-01T10:00:00Z',
    })

    expect(result.state).toBe('CUSTOMER_DECLINED')
    expect(mocks.lifecycleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ state: 'CUSTOMER_DECLINED', reason: 'Customer did not approve outage.' }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FIRMWARE_LIFECYCLE_CUSTOMER_DECLINED',
        before: expect.objectContaining({ state: 'PLANNED' }),
        after: expect.objectContaining({ state: 'CUSTOMER_DECLINED', reason: 'Customer did not approve outage.' }),
      }),
    }))
  })

  it('sets completion time when moving to DONE and preserves it on repeated DONE saves', async () => {
    const completedAt = new Date('2026-09-01T09:00:00Z')
    mocks.lifecycleFindUnique.mockResolvedValue(currentLifecycle({ state: 'DONE', completedAt }))
    mocks.lifecycleUpsert.mockResolvedValue(storedLifecycle({ state: 'DONE', completedAt }))

    await setFirmwareLifecycleDecision('device-1', { state: 'DONE', notes: 'Upgrade completed.' })

    expect(mocks.lifecycleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ state: 'DONE', completedAt }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'FIRMWARE_LIFECYCLE_DONE',
        after: expect.objectContaining({ state: 'DONE', completedAt: completedAt.toISOString() }),
      }),
    }))
  })

  it('rejects a new lifecycle decision when no desired firmware policy exists without writing history', async () => {
    mocks.policyFindFirst.mockResolvedValue(null)
    await expect(setFirmwareLifecycleDecision('device-1', { state: 'PLANNED' })).rejects.toBeInstanceOf(FirmwareLifecyclePolicyError)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.lifecycleUpsert).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})
