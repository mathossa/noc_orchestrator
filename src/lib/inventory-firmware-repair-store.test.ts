import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  deviceCount: vi.fn(),
  deviceFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
  releaseFindMany: vi.fn(),
  deviceFindUnique: vi.fn(),
  deviceFindUniqueOrThrow: vi.fn(),
  deviceUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  auditFindUnique: vi.fn(),
  auditFindFirst: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: {
      count: db.deviceCount,
      findMany: db.deviceFindMany,
      findUnique: db.deviceFindUnique,
      findUniqueOrThrow: db.deviceFindUniqueOrThrow,
      updateMany: db.deviceUpdateMany,
    },
    vendor: { findMany: db.vendorFindMany },
    firmwareRelease: { findMany: db.releaseFindMany },
    auditEvent: {
      create: db.auditCreate,
      findUnique: db.auditFindUnique,
      findFirst: db.auditFindFirst,
    },
    $transaction: db.transaction,
  },
}))

import {
  applyCanonicalFirmwareRepairs,
  previewInventoryFirmwareRepairs,
  rollbackCanonicalFirmwareRepair,
} from '@/lib/inventory-firmware-repair-store'

describe('#152 inventory correction query scope', () => {
  beforeEach(() => {
    Object.values(db).forEach((fn) => fn.mockReset())
    db.deviceCount.mockResolvedValue(0)
    db.deviceFindMany.mockResolvedValue([])
    db.vendorFindMany.mockResolvedValue([])
    db.releaseFindMany.mockResolvedValue([])
  })

  it('filters current canonical platform in the database rather than just the UI', async () => {
    await previewInventoryFirmwareRepairs({ linkedPlatform: 'FortiGate' })
    expect(db.deviceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        currentFirmwareRelease: {
          is: { platform: { equals: 'FortiGate', mode: 'insensitive' } },
        },
      },
      take: 50,
      skip: 0,
    }))
    expect(db.deviceCount).toHaveBeenCalledWith({
      where: {
        currentFirmwareRelease: {
          is: { platform: { equals: 'FortiGate', mode: 'insensitive' } },
        },
      },
    })
  })

  it('combines platform, vendor and search text as server-side filters', async () => {
    await previewInventoryFirmwareRepairs({
      page: 2, q: 'example switch', vendorId: 'vendor-123', linkedPlatform: 'AOS-S',
    })
    const filter = db.deviceFindMany.mock.calls[0][0]
    expect(filter.skip).toBe(50)
    expect(filter.where.deviceModel).toEqual({ vendorId: 'vendor-123' })
    expect(filter.where.currentFirmwareRelease.is.platform.equals).toBe('AOS-S')
    expect(filter.where.OR).toEqual(expect.arrayContaining([
      { name: { contains: 'example switch', mode: 'insensitive' } },
      { customer: { name: { contains: 'example switch', mode: 'insensitive' } } },
    ]))
  })

  it('finds unlinked device references and does not leak the previous platform', async () => {
    await previewInventoryFirmwareRepairs({ linkedPlatform: '__UNLINKED__' })
    expect(db.deviceFindMany.mock.calls[0][0].where).toEqual({ currentFirmwareReleaseId: null })
    await previewInventoryFirmwareRepairs()
    expect(db.deviceFindMany.mock.calls[1][0].where).toEqual({})
  })
})

const observedAt = new Date('2026-10-01T09:00:00.000Z')
const originalUpdatedAt = new Date('2026-10-01T10:00:00.000Z')
const changedUpdatedAt = new Date('2026-10-01T10:00:01.000Z')

function release(id: string, platform = 'Software OS', version = '7.4.11') {
  return {
    id,
    vendorId: 'synthetic-vendor',
    platform,
    version,
    logicalVersion: version,
    variant: null,
    imageCode: null,
    isActive: true,
    firmwareTrain: platform === 'Software OS'
      ? { id: 'train-74', name: '7.4', platform, isActive: true }
      : null,
    vendor: { name: 'Example Vendor', code: 'EXAMPLE' },
  }
}

function mockFirmwareTransaction(input: {
  current: ReturnType<typeof release>
  available: ReturnType<typeof release>[]
  observedVersion?: string
}) {
  let storedReleaseId: string | null = input.current.id
  let storedUpdatedAt = originalUpdatedAt
  const audits: Array<Record<string, unknown>> = []
  const observedVersion = input.observedVersion ?? '7.4.11'

  db.releaseFindMany.mockResolvedValue(input.available)
  db.deviceFindUnique.mockImplementation(async () => ({
    id: 'synthetic-device',
    name: 'example-sw-01',
    customerId: 'synthetic-customer',
    updatedAt: storedUpdatedAt,
    currentFirmwareReleaseId: storedReleaseId,
    currentFirmwareRawVersion: observedVersion,
    currentFirmwareNormalizedVersion: observedVersion,
    currentFirmwareObservedAt: observedAt,
    currentFirmwareSource: 'SYNTHETIC',
    customer: { name: 'Example Customer' },
    site: { name: 'Example Site' },
    deviceModel: {
      model: 'Example Appliance',
      vendorId: 'synthetic-vendor',
      platform: 'Software OS',
      preferredPlatform: 'Software OS',
    },
    currentFirmwareRelease: storedReleaseId === input.current.id
      ? input.current
      : (input.available.find((item) => item.id === storedReleaseId) ?? null),
  }))
  db.deviceUpdateMany.mockImplementation(async (query: {
    where: { currentFirmwareReleaseId: string | null; updatedAt: Date }
    data: { currentFirmwareReleaseId: string | null }
  }) => {
    if (query.where.currentFirmwareReleaseId !== storedReleaseId ||
        query.where.updatedAt.getTime() !== storedUpdatedAt.getTime()) {
      return { count: 0 }
    }
    storedReleaseId = query.data.currentFirmwareReleaseId
    storedUpdatedAt = changedUpdatedAt
    return { count: 1 }
  })
  db.deviceFindUniqueOrThrow.mockImplementation(async () => ({ updatedAt: storedUpdatedAt }))
  db.auditCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    audits.push(data)
    return { id: 'audit-' + audits.length }
  })
  db.auditFindFirst.mockResolvedValue(null)
  const tx = {
    device: {
      findUnique: db.deviceFindUnique,
      updateMany: db.deviceUpdateMany,
      findUniqueOrThrow: db.deviceFindUniqueOrThrow,
    },
    firmwareRelease: { findMany: db.releaseFindMany },
    auditEvent: {
      create: db.auditCreate,
      findUnique: db.auditFindUnique,
      findFirst: db.auditFindFirst,
    },
  }
  db.transaction.mockImplementation(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx))

  return {
    audits,
    getStoredRelease: () => storedReleaseId,
    selection: (targetReleaseId: string, manual: boolean) => ({
      confirmed: true,
      manual,
      items: [{
        deviceId: 'synthetic-device',
        oldReleaseId: input.current.id,
        targetReleaseId,
        updatedAt: originalUpdatedAt.toISOString(),
      }],
    }),
  }
}

describe('#172 audited manual firmware relink persistence', () => {
  beforeEach(() => Object.values(db).forEach((fn) => fn.mockReset()))

  it('writes the manually selected alternate even when the existing link is CORRECT', async () => {
    const current = release('already-correct')
    const alternate = release('operator-selected')
    const tx = mockFirmwareTransaction({ current, available: [current, alternate] })

    const outcome = await applyCanonicalFirmwareRepairs(tx.selection(alternate.id, true), 'synthetic-admin')

    expect(outcome).toEqual(expect.objectContaining({ updated: 1, auditIds: ['audit-1'] }))
    expect(tx.getStoredRelease()).toBe('operator-selected')
    expect(db.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { currentFirmwareReleaseId: 'operator-selected' },
    }))
    expect(tx.audits[0]).toEqual(expect.objectContaining({
      action: 'CURRENT_FIRMWARE_CANONICAL_RELINK',
      actorUserId: 'synthetic-admin',
      before: expect.objectContaining({ firmwareReleaseId: 'already-correct' }),
      after: expect.objectContaining({
        firmwareReleaseId: 'operator-selected',
        platform: 'Software OS',
        version: '7.4.11',
      }),
      metadata: expect.objectContaining({
        method: 'ENGINEER_REVIEWED_EXACT_FIRMWARE_RELINK',
        targetTrain: '7.4',
        evidenceKept: true,
        observedAtKept: true,
        sourceKept: true,
      }),
    }))
    // Only the canonical link may change, never the actual firmware evidence.
    expect(db.deviceUpdateMany.mock.calls[0][0].data).toEqual({
      currentFirmwareReleaseId: 'operator-selected',
    })
  })

  it('does not clear the link when automatic matching is AMBIGUOUS but the manual choice is safe', async () => {
    const current = release('hardware-alias', 'Device hardware family')
    const tx = mockFirmwareTransaction({
      current,
      available: [release('equivalent-a'), release('equivalent-b')],
    })

    await applyCanonicalFirmwareRepairs(tx.selection('equivalent-b', true), 'synthetic-admin')

    expect(tx.getStoredRelease()).toBe('equivalent-b')
    expect(tx.audits[0].after).toEqual(expect.objectContaining({
      firmwareReleaseId: 'equivalent-b',
      platform: 'Software OS',
    }))
  })

  it('retains exact automatic matching semantics when manual is false', async () => {
    const current = release('legacy-platform', 'Device hardware family')
    const tx = mockFirmwareTransaction({ current, available: [release('single-match')] })

    await applyCanonicalFirmwareRepairs(tx.selection('single-match', false), 'synthetic-admin')

    expect(tx.getStoredRelease()).toBe('single-match')
    expect(tx.audits[0].metadata).toEqual(expect.objectContaining({
      method: 'EXACT_MODEL_COMPATIBLE_RELEASE_RELINK',
    }))
  })

  it('rejects an alternative with a different observed firmware version without writing or auditing', async () => {
    const current = release('observed-current')
    const wrongVersion = release('incorrect-7-4-8', 'Software OS', '7.4.8')
    const tx = mockFirmwareTransaction({ current, available: [current, wrongVersion] })

    await expect(applyCanonicalFirmwareRepairs(
      tx.selection(wrongVersion.id, true), 'synthetic-admin',
    )).rejects.toThrow('incompatible')

    expect(tx.getStoredRelease()).toBe(current.id)
    expect(db.deviceUpdateMany).not.toHaveBeenCalled()
    expect(db.auditCreate).not.toHaveBeenCalled()
  })

  it('rolls back the exact manually written release using the recorded audit evidence', async () => {
    const current = release('before-correction')
    const alternate = release('after-correction')
    const tx = mockFirmwareTransaction({ current, available: [current, alternate] })

    await applyCanonicalFirmwareRepairs(tx.selection(alternate.id, true), 'synthetic-admin')
    db.auditFindUnique.mockResolvedValue({
      ...tx.audits[0],
      id: 'audit-1',
      entityId: 'synthetic-device',
    })

    const rolledBack = await rollbackCanonicalFirmwareRepair('audit-1', 'synthetic-admin')

    expect(rolledBack).toEqual({ rolledBack: true, deviceId: 'synthetic-device' })
    expect(tx.getStoredRelease()).toBe(current.id)
    expect(db.deviceUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { currentFirmwareReleaseId: current.id },
    }))
    expect(tx.audits[1]).toEqual(expect.objectContaining({
      action: 'CURRENT_FIRMWARE_CANONICAL_RELINK_ROLLBACK',
      before: { firmwareReleaseId: alternate.id },
      after: { firmwareReleaseId: current.id },
    }))
  })
})
