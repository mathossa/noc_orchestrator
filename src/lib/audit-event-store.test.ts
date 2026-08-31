import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auditFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { auditEvent: { findMany: mocks.auditFindMany } },
}))

import { listAuditEventsForEntity } from '@/lib/audit-event-store'

describe('audit history queries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries one entity newest-first and serializes actor and flat snapshots', async () => {
    const createdAt = new Date('2026-09-01T01:00:00Z')
    mocks.auditFindMany.mockResolvedValue([{
      id: 'audit-1',
      action: 'CURRENT_FIRMWARE_CHANGED',
      entityType: 'Device',
      entityId: 'device-1',
      customerId: 'customer-1',
      actorUserId: 'user-1',
      before: { version: '17.12.5', ignoredObject: { nested: true } },
      after: { version: '17.15.5', source: 'MANUAL' },
      metadata: { context: 'DEVICE_UPDATED' },
      createdAt,
      actor: { id: 'user-1', name: 'Engineer', email: 'engineer@example.test' },
    }])

    const result = await listAuditEventsForEntity('Device', 'device-1')

    expect(mocks.auditFindMany).toHaveBeenCalledWith({
      where: { entityType: 'Device', entityId: 'device-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: { actor: { select: { id: true, name: true, email: true } } },
    })
    expect(result).toEqual([{
      id: 'audit-1',
      action: 'CURRENT_FIRMWARE_CHANGED',
      entityType: 'Device',
      entityId: 'device-1',
      customerId: 'customer-1',
      actorUserId: 'user-1',
      actor: { id: 'user-1', name: 'Engineer', email: 'engineer@example.test' },
      before: { version: '17.12.5' },
      after: { version: '17.15.5', source: 'MANUAL' },
      metadata: { context: 'DEVICE_UPDATED' },
      createdAt: createdAt.toISOString(),
    }])
  })

  it('caps requested history to 200 events', async () => {
    mocks.auditFindMany.mockResolvedValue([])
    await listAuditEventsForEntity('DeviceModel', 'model-1', 999)
    expect(mocks.auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })
})
