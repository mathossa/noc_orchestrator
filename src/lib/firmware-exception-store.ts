import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { resolveFirmwareComplianceBatch } from '@/lib/firmware-compliance-store'
import {
  exceptionScopeMatches,
  FirmwareExceptionError,
  parseExceptionInput,
  policyFingerprint,
  resolveFirmwareExceptions,
  type ExceptionInput,
} from '@/lib/firmware-exceptions'

type Db = Prisma.TransactionClient
const deviceSelect = {
  id: true,
  name: true,
  customerId: true,
  siteId: true,
  deviceModelId: true,
  deviceModel: { select: { familyId: true } },
} as const
function scopeWhere(
  input: Pick<ExceptionInput, 'scope' | 'scopeId'>,
): Prisma.DeviceWhereInput {
  switch (input.scope) {
    case 'DEVICE':
      return { id: input.scopeId }
    case 'SITE':
      return { siteId: input.scopeId }
    case 'CUSTOMER':
      return { customerId: input.scopeId }
    case 'MODEL':
      return { deviceModelId: input.scopeId }
    case 'FAMILY':
      return { deviceModel: { familyId: input.scopeId } }
  }
}
async function validateReferences(db: Db, input: ExceptionInput) {
  const reason = await db.firmwareExceptionReason.findUnique({
    where: { code: input.reasonCode },
  })
  if (!reason?.isActive)
    throw new FirmwareExceptionError('Choose an active exception reason.')
  let entity: { name?: string; model?: string } | null = null
  switch (input.scope) {
    case 'DEVICE':
      entity = await db.device.findUnique({
        where: { id: input.scopeId },
        select: { name: true },
      })
      break
    case 'SITE':
      entity = await db.site.findUnique({
        where: { id: input.scopeId },
        select: { name: true },
      })
      break
    case 'CUSTOMER':
      entity = await db.customer.findUnique({
        where: { id: input.scopeId },
        select: { name: true },
      })
      break
    case 'MODEL':
      entity = await db.deviceModel.findUnique({
        where: { id: input.scopeId },
        select: { model: true },
      })
      break
    case 'FAMILY':
      entity = await db.deviceModelFamily.findUnique({
        where: { id: input.scopeId },
        select: { name: true },
      })
      break
  }
  if (!entity) throw new FirmwareExceptionError('Scope was not found.', 404)
  if (
    input.releaseId &&
    !(await db.firmwareRelease.findUnique({
      where: { id: input.releaseId },
      select: { id: true },
    }))
  )
    throw new FirmwareExceptionError('Release was not found.')
  if (
    input.trainId &&
    !(await db.firmwareTrain.findUnique({
      where: { id: input.trainId },
      select: { id: true },
    }))
  )
    throw new FirmwareExceptionError('Train was not found.')
  if (
    input.vendorId &&
    !(await db.vendor.findUnique({
      where: { id: input.vendorId },
      select: { id: true },
    }))
  )
    throw new FirmwareExceptionError('Vendor was not found.')
  return entity.name ?? entity.model ?? input.scopeId
}
async function buildPreview(db: Db, raw: unknown, at: Date) {
  const input = parseExceptionInput(raw, at)
  const scopeLabel = await validateReferences(db, input)
  const devices = await db.device.findMany({
    where: scopeWhere(input),
    select: deviceSelect,
    orderBy: { id: 'asc' },
  })
  const technical = await resolveFirmwareComplianceBatch(
    devices.map((d) => d.id),
    at,
    db,
  )
  const policySnapshots = Object.fromEntries(
    [...technical].map(([id, result]) => [id, policyFingerprint(result)]),
  )
  const candidate = {
    ...input,
    id: 'preview',
    scopeLabel,
    policySnapshots,
    actorUserId: null,
    decidedAt: at,
    supersededAt: null,
  }
  const affected = devices.filter(
    (device) =>
      resolveFirmwareExceptions(
        [candidate],
        device,
        technical.get(device.id)!,
        at,
      ).selected,
  )
  // Default review date is relative to save time, so exclude its milliseconds from
  // the confirmation fingerprint. Inventory, policy, subject and input stay bound.
  const token = createHash('sha256')
    .update(
      JSON.stringify({
        input: {
          ...input,
          expiresAt: input.duration === 'NEXT_REVIEW' ? null : input.expiresAt,
        },
        devices: devices.map((d) => d.id),
        policySnapshots,
        affected: affected.map((d) => d.id),
      }),
    )
    .digest('hex')
  return {
    input,
    scopeLabel,
    policySnapshots,
    token,
    totalDevices: devices.length,
    affectedCount: affected.length,
    affectedDevices: affected.map((d) => ({ id: d.id, name: d.name })),
    futureScopeApplies: input.duration !== 'POLICY_CHANGE',
  }
}
export async function previewFirmwareException(raw: unknown) {
  return prisma.$transaction((tx) => buildPreview(tx, raw, new Date()), {
    isolationLevel: 'RepeatableRead',
    timeout: 30000,
  })
}
export async function createFirmwareException(
  raw: unknown,
  actorUserId: string,
  token: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const at = new Date()
      const preview = await buildPreview(tx, raw, at)
      if (!token || token !== preview.token)
        throw new FirmwareExceptionError(
          'Scope or policy changed. Preview the affected devices again before saving.',
          409,
        )
      const row = await tx.firmwareException.create({
        data: {
          ...preview.input,
          scopeLabel: preview.scopeLabel,
          policySnapshots: preview.policySnapshots,
          actorUserId,
          decidedAt: at,
        },
      })
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'FIRMWARE_EXCEPTION_CREATED',
          entityType: 'FirmwareException',
          entityId: row.id,
          after: JSON.parse(JSON.stringify(row)),
          metadata: {
            affectedCount: preview.affectedCount,
            totalDevices: preview.totalDevices,
          },
        },
      })
      return row
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  )
}
export async function supersedeFirmwareException(
  id: string,
  actorUserId: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const row = await tx.firmwareException.findUnique({ where: { id } })
      if (!row)
        throw new FirmwareExceptionError('Exception was not found.', 404)
      if (row.supersededAt) return row
      const next = await tx.firmwareException.update({
        where: { id },
        data: { supersededAt: new Date(), supersededByUserId: actorUserId },
      })
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'FIRMWARE_EXCEPTION_SUPERSEDED',
          entityType: 'FirmwareException',
          entityId: id,
          before: JSON.parse(JSON.stringify(row)),
          after: JSON.parse(JSON.stringify(next)),
        },
      })
      return next
    },
    { isolationLevel: 'Serializable' },
  )
}
export async function listFirmwareExceptions(deviceId?: string) {
  const [rows, reasons] = await Promise.all([
    prisma.firmwareException.findMany({ orderBy: { decidedAt: 'desc' } }),
    prisma.firmwareExceptionReason.findMany({ orderBy: { label: 'asc' } }),
  ])
  const devices = await prisma.device.findMany({
    where: deviceId ? { id: deviceId } : {},
    select: deviceSelect,
  })
  if (deviceId && !devices.length)
    throw new FirmwareExceptionError('Device was not found.', 404)
  const at = new Date()
  const technical = await resolveFirmwareComplianceBatch(
    devices.map((d) => d.id),
    at,
  )
  const resolutions = devices.map((d) => ({
    deviceId: d.id,
    name: d.name,
    ...resolveFirmwareExceptions(rows, d, technical.get(d.id)!, at),
  }))
  const visible = deviceId
    ? rows.filter((r) => exceptionScopeMatches(r, devices[0]))
    : rows
  const records = visible.map((row) => {
    const entries = resolutions.flatMap((r) =>
      r.records.filter((e) => e.id === row.id),
    )
    return {
      ...row,
      activeDevices: entries.filter(
        (e) => e.status === 'ACTIVE' && e.subjectMatches,
      ).length,
      policyChangedDevices: entries.filter((e) => e.status === 'POLICY_CHANGED')
        .length,
      status: row.supersededAt
        ? 'SUPERSEDED'
        : row.expiresAt && row.expiresAt <= at
          ? 'EXPIRED'
          : entries.length &&
              entries.every((e) => e.status === 'POLICY_CHANGED')
            ? 'POLICY_CHANGED'
            : 'ACTIVE',
      replacementRelated:
        reasons.find((r) => r.code === row.reasonCode)?.replacementRelated ??
        false,
    }
  })
  return {
    records,
    reasons,
    resolutions: resolutions.map((r) => ({
      deviceId: r.deviceId,
      name: r.name,
      compliance: r.technical.compliance,
      recommendation: r.technical.recommendation,
      operationalRecommendation: r.operationalRecommendation,
      selectedId: r.selected?.id ?? null,
      applicableIds: r.applicable.map((e) => e.id),
      scopedExceptionIds: r.records.map((e) => e.id),
    })),
  }
}
export async function exceptionReferenceData() {
  const [
    devices,
    sites,
    customers,
    models,
    families,
    releases,
    trains,
    vendors,
  ] = await Promise.all([
    prisma.device.findMany({
      select: { id: true, name: true, customer: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.site.findMany({
      select: { id: true, name: true, customer: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.customer.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.deviceModel.findMany({
      select: { id: true, model: true },
      orderBy: { model: 'asc' },
    }),
    prisma.deviceModelFamily.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.firmwareRelease.findMany({
      select: { id: true, platform: true, version: true },
      orderBy: { version: 'asc' },
    }),
    prisma.firmwareTrain.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.vendor.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return {
    scopes: {
      DEVICE: devices.map((d) => ({
        id: d.id,
        name: `${d.customer.name} / ${d.name}`,
      })),
      SITE: sites.map((s) => ({
        id: s.id,
        name: `${s.customer.name} / ${s.name}`,
      })),
      CUSTOMER: customers,
      MODEL: models.map((m) => ({ id: m.id, name: m.model })),
      FAMILY: families,
    },
    releases: releases.map((r) => ({
      id: r.id,
      name: `${r.platform} ${r.version}`,
    })),
    trains,
    vendors,
  }
}
export async function addExceptionReason(raw: unknown, actorUserId: string) {
  const b = raw as {
    code?: string
    label?: string
    replacementRelated?: boolean
  }
  if (
    typeof b?.code !== 'string' ||
    !/^[A-Z][A-Z0-9_]{1,49}$/.test(b.code) ||
    typeof b.label !== 'string' ||
    !b.label.trim() ||
    b.label.length > 100
  )
    throw new FirmwareExceptionError(
      'Enter an uppercase reason code and a label of at most 100 characters.',
    )
  return prisma.$transaction(async (tx) => {
    const row = await tx.firmwareExceptionReason.create({
      data: {
        code: b.code!,
        label: b.label!.trim(),
        replacementRelated: b.replacementRelated === true,
      },
    })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        action: 'FIRMWARE_EXCEPTION_REASON_CREATED',
        entityType: 'FirmwareExceptionReason',
        entityId: row.code,
        after: row,
      },
    })
    return row
  })
}
