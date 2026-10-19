import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'
import { resolveCanonicalFortiosRepair, type CanonicalRepairDecision } from '@/lib/firmware-canonical-repair'
import type { Prisma } from '../generated/prisma/client'

const MAX_APPLY = 50
const MAX_PREVIEW = 5000
const ACTION_APPLY = AUDIT_ACTIONS.canonicalFirmwareRelink
const ACTION_ROLLBACK = AUDIT_ACTIONS.canonicalFirmwareRelinkRollback

export class CanonicalFirmwareRepairError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message)
    this.name = 'CanonicalFirmwareRepairError'
  }
}

const sourceSelect = {
  id: true, vendorId: true, platform: true, version: true, logicalVersion: true,
  variant: true, imageCode: true, isActive: true,
  firmwareTrain: { select: { id: true, name: true, platform: true, isActive: true } },
  vendor: { select: { name: true, code: true } },
} as const

const deviceSelect = {
  id: true, name: true, customerId: true, updatedAt: true,
  currentFirmwareReleaseId: true, currentFirmwareRawVersion: true,
  currentFirmwareNormalizedVersion: true, currentFirmwareObservedAt: true,
  currentFirmwareSource: true,
  customer: { select: { name: true } },
  site: { select: { name: true } },
  deviceModel: { select: { model: true, vendorId: true, platform: true, preferredPlatform: true } },
  currentFirmwareRelease: { select: sourceSelect },
} as const

type RepairDevice = Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>
type RepairRelease = Prisma.FirmwareReleaseGetPayload<{ select: typeof sourceSelect }>

function isFortinet(release: RepairRelease) {
  return ['fortinet'].includes(release.vendor.name.toLocaleLowerCase('en-US').trim()) ||
    release.vendor.code.toLocaleLowerCase('en-US').trim() === 'fortinet'
}

function resolveForRow(device: RepairDevice, candidates: readonly RepairRelease[]): CanonicalRepairDecision {
  const source = device.currentFirmwareRelease
  if (!source) return { status: 'NOT_APPLICABLE', targetId: null, candidateIds: [] }
  return resolveCanonicalFortiosRepair({
    source,
    model: device.deviceModel,
    candidates,
    vendorIsFortinet: isFortinet(source),
    observedNormalizedVersion: device.currentFirmwareNormalizedVersion,
  })
}

function viewRow(row: RepairDevice, result: CanonicalRepairDecision, target: RepairRelease | null) {
  return {
    deviceId: row.id,
    deviceName: row.name,
    customerId: row.customerId,
    customerName: row.customer.name,
    siteName: row.site?.name ?? null,
    model: row.deviceModel.model,
    runningVersion: row.currentFirmwareRawVersion ?? row.currentFirmwareNormalizedVersion ?? row.currentFirmwareRelease?.version ?? null,
    observedAt: row.currentFirmwareObservedAt?.toISOString() ?? null,
    currentPlatform: row.currentFirmwareRelease?.platform ?? null,
    oldReleaseId: row.currentFirmwareReleaseId,
    oldTrain: row.currentFirmwareRelease?.firmwareTrain?.name ?? null,
    targetReleaseId: result.targetId,
    targetVersion: target?.version ?? null,
    targetTrain: target?.firmwareTrain?.name ?? null,
    status: result.status,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function previewCanonicalFirmwareRepairs() {
  // The only candidate pool is current devices linked to the incorrect
  // software platform; no device or observation is modified on preview.
  const all = await prisma.device.findMany({
    where: { currentFirmwareRelease: { is: { platform: { equals: 'FortiGate', mode: 'insensitive' } } } },
    orderBy: [{ customer: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    take: MAX_PREVIEW + 1,
    select: deviceSelect,
  })
  const truncated = all.length > MAX_PREVIEW
  const devices = all.slice(0, MAX_PREVIEW)
  const sources = devices.flatMap((d) => d.currentFirmwareRelease ? [d.currentFirmwareRelease] : [])
  const candidates = sources.length
    ? await prisma.firmwareRelease.findMany({
        where: {
          vendorId: { in: [...new Set(sources.map((release) => release.vendorId))] },
          platform: { equals: 'FortiOS', mode: 'insensitive' },
          version: { in: [...new Set(sources.map((release) => release.version))] },
        },
        select: sourceSelect,
      })
    : []
  const releaseById = new Map(candidates.map((release) => [release.id, release]))
  const rows = devices.map((device) => {
    const decision = resolveForRow(device, candidates)
    return viewRow(device, decision, releaseById.get(decision.targetId ?? '') ?? null)
  })
  return {
    rows,
    truncated,
    totalInspected: rows.length,
    affectedCustomers: new Set(rows.map((r) => r.customerId)).size,
    matched: rows.filter((r) => r.status === 'MATCHED').length,
    needsReview: rows.filter((r) => r.status !== 'MATCHED').length,
    counts: Object.fromEntries([...new Set(rows.map((r) => r.status))].map((status) =>
      [status, rows.filter((row) => row.status === status).length])),
  }
}

export type CanonicalRepairSelection = {
  deviceId: string
  oldReleaseId: string
  targetReleaseId: string
  updatedAt: string
}

function validSelection(value: unknown): value is CanonicalRepairSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return ['deviceId', 'oldReleaseId', 'targetReleaseId', 'updatedAt'].every((key) =>
    typeof row[key] === 'string' && Boolean((row[key] as string).trim())) &&
    !Number.isNaN(Date.parse(row.updatedAt as string))
}

/**
 * Apply only the reviewed rows. Re-resolve exact identity inside a serializable
 * transaction, check optimistic concurrency against BOTH link and updatedAt,
 * and audit the change without touching source evidence or observedAt.
 */
export async function applyCanonicalFirmwareRepairs(input: unknown, actorUserId: string) {
  const request = input as { confirmed?: unknown; items?: unknown } | null
  const items = request?.items
  if (request?.confirmed !== true || !Array.isArray(items) ||
      items.length < 1 || items.length > MAX_APPLY || !items.every(validSelection)) {
    throw new CanonicalFirmwareRepairError('Confirm 1–50 previewed devices with valid original and target release IDs.')
  }
  const seen = new Set(items.map((row: CanonicalRepairSelection) => row.deviceId))
  if (seen.size !== items.length) {
    throw new CanonicalFirmwareRepairError('Duplicate device selections are not allowed.')
  }
  const batchId = randomUUID()
  const auditIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = []
    for (const item of items as CanonicalRepairSelection[]) {
      const device = await tx.device.findUnique({
        where: { id: item.deviceId },
        select: deviceSelect,
      })
      if (!device || !device.currentFirmwareRelease ||
          device.currentFirmwareReleaseId !== item.oldReleaseId ||
          device.updatedAt.toISOString() !== item.updatedAt) {
        throw new CanonicalFirmwareRepairError('Inventory changed since preview. Refresh and review the selection again.', 409)
      }
      const source = device.currentFirmwareRelease
      const candidates = await tx.firmwareRelease.findMany({
        where: { vendorId: source.vendorId, platform: { equals: 'FortiOS', mode: 'insensitive' },
          version: source.version },
        select: sourceSelect,
      })
      const decision = resolveForRow(device, candidates)
      if (decision.status !== 'MATCHED' || decision.targetId !== item.targetReleaseId) {
        throw new CanonicalFirmwareRepairError('Firmware matching changed or is ambiguous. Refresh the preview.', 409)
      }
      const updated = await tx.device.updateMany({
        where: {
          id: device.id,
          currentFirmwareReleaseId: item.oldReleaseId,
          updatedAt: device.updatedAt,
        },
        data: { currentFirmwareReleaseId: decision.targetId },
      })
      if (updated.count !== 1) {
        throw new CanonicalFirmwareRepairError('Concurrent inventory change detected; no repairs committed.', 409)
      }
      const after = await tx.device.findUniqueOrThrow({
        where: { id: device.id }, select: { updatedAt: true },
      })
      const audit = await tx.auditEvent.create({
        data: {
          action: ACTION_APPLY,
          entityType: 'Device',
          entityId: device.id,
          customerId: device.customerId,
          actorUserId,
          before: {
            firmwareReleaseId: item.oldReleaseId, platform: source.platform,
            version: source.version, updatedAt: device.updatedAt.toISOString(),
          },
          after: {
            firmwareReleaseId: decision.targetId, platform: 'FortiOS',
            version: source.version, updatedAt: after.updatedAt.toISOString(),
          },
          metadata: {
            batchId, method: 'EXACT_CANONICAL_RELINK', sourceVersion: source.version,
            sourceTrain: source.firmwareTrain?.name ?? null,
            targetTrain: candidates.find((r) => r.id === decision.targetId)?.firmwareTrain?.name ?? null,
            evidenceKept: true, observedAtKept: true, sourceKept: true,
          },
        },
        select: { id: true },
      })
      ids.push(audit.id)
    }
    return ids
  }, { isolationLevel: 'Serializable' })
  return { updated: auditIds.length, auditIds, batchId }
}

/** Undo only while the exact post-repair device row is still unchanged. */
export async function rollbackCanonicalFirmwareRepair(auditEventId: string, actorUserId: string) {
  if (!auditEventId || auditEventId.length > 128) {
    throw new CanonicalFirmwareRepairError('A valid audit event ID is required.')
  }
  return prisma.$transaction(async (tx) => {
    const audit = await tx.auditEvent.findUnique({ where: { id: auditEventId } })
    if (!audit || audit.action !== ACTION_APPLY ||
        !audit.before || !audit.after ||
        typeof audit.before !== 'object' || Array.isArray(audit.before) ||
        typeof audit.after !== 'object' || Array.isArray(audit.after)) {
      throw new CanonicalFirmwareRepairError('The selected canonical relink audit event was not found.')
    }
    const before = audit.before as Record<string, unknown>
    const after = audit.after as Record<string, unknown>
    if (typeof before.firmwareReleaseId !== 'string' ||
        typeof after.firmwareReleaseId !== 'string' ||
        typeof after.updatedAt !== 'string' ||
        Number.isNaN(Date.parse(after.updatedAt))) {
      throw new CanonicalFirmwareRepairError('Audit evidence is incomplete; rollback must be reviewed manually.')
    }
    const current = await tx.device.findUnique({
      where: { id: audit.entityId },
      select: { id: true, customerId: true, currentFirmwareReleaseId: true, updatedAt: true },
    })
    if (!current || current.currentFirmwareReleaseId !== after.firmwareReleaseId ||
        current.updatedAt.toISOString() !== after.updatedAt) {
      throw new CanonicalFirmwareRepairError('Device changed after the repair. Rollback is unsafe.', 409)
    }
    const done = await tx.auditEvent.findFirst({
      where: { action: ACTION_ROLLBACK, entityType: 'Device', entityId: current.id,
        metadata: { path: ['revertedAuditId'], equals: auditEventId } },
      select: { id: true },
    })
    if (done) throw new CanonicalFirmwareRepairError('This repair was already rolled back.', 409)
    const updated = await tx.device.updateMany({
      where: { id: current.id, updatedAt: current.updatedAt,
        currentFirmwareReleaseId: after.firmwareReleaseId },
      data: { currentFirmwareReleaseId: before.firmwareReleaseId },
    })
    if (updated.count !== 1) throw new CanonicalFirmwareRepairError('Concurrent device change; rollback cancelled.', 409)
    await tx.auditEvent.create({
      data: {
        action: ACTION_ROLLBACK, entityType: 'Device', entityId: current.id,
        customerId: current.customerId, actorUserId,
        before: { firmwareReleaseId: after.firmwareReleaseId },
        after: { firmwareReleaseId: before.firmwareReleaseId },
        metadata: { revertedAuditId: auditEventId },
      },
    })
    return { rolledBack: true, deviceId: current.id }
  }, { isolationLevel: 'Serializable' })
}
