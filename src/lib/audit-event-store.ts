import { prisma } from '@/lib/prisma'
import type { AuditEventRecord, AuditSnapshot } from '@/lib/audit-events'

function auditSnapshot(value: unknown): AuditSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: AuditSnapshot = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      result[key] = item as string | number | boolean | null
    }
  }
  return result
}

function serializeAuditEvent(record: {
  id: string
  action: string
  entityType: string
  entityId: string
  customerId: string | null
  actorUserId: string | null
  before: unknown
  after: unknown
  metadata: unknown
  createdAt: Date
  actor: { id: string; name: string; email: string } | null
}): AuditEventRecord {
  return {
    id: record.id,
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    customerId: record.customerId,
    actorUserId: record.actorUserId,
    actor: record.actor,
    before: auditSnapshot(record.before),
    after: auditSnapshot(record.after),
    metadata: auditSnapshot(record.metadata),
    createdAt: record.createdAt.toISOString(),
  }
}

export async function listAuditEventsForEntity(entityType: string, entityId: string, limit = 50) {
  const records = await prisma.auditEvent.findMany({
    where: { entityType, entityId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(limit, 1), 200),
    include: { actor: { select: { id: true, name: true, email: true } } },
  })
  return records.map(serializeAuditEvent)
}
