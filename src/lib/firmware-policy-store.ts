import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'

export const NORMAL_DESIRED_FIRMWARE_STATUSES = ['APPROVED', 'RECOMMENDED'] as const

export class FirmwarePolicyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwarePolicyValidationError'
  }
}

export class FirmwarePolicyNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwarePolicyNotFoundError'
  }
}

export class FirmwarePolicyReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwarePolicyReferenceError'
  }
}

export class FirmwarePolicyCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwarePolicyCompatibilityError'
  }
}

const targetFirmwareSelect = {
  id: true,
  vendorId: true,
  platform: true,
  version: true,
  status: true,
  isActive: true,
  releasedAt: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

function normalizePlatform(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function cleanId(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function modelBaselineWhere(deviceModelId: string) {
  return {
    deviceModelId,
    isActive: true,
    customerId: null,
    contractTypeId: null,
    deviceId: null,
    vendorId: null,
    deviceTypeId: null,
  } as const
}

function serializePolicy(record: {
  id: string
  targetFirmwareReleaseId: string
  isActive: boolean
  notes: string | null
  deviceModelId: string | null
  createdAt: Date
  updatedAt: Date
  targetFirmwareRelease: {
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    releasedAt: Date | null
    firmwareTrain: { id: string; name: string } | null
  }
}) {
  return {
    id: record.id,
    targetFirmwareReleaseId: record.targetFirmwareReleaseId,
    isActive: record.isActive,
    notes: record.notes,
    deviceModelId: record.deviceModelId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    release: {
      ...record.targetFirmwareRelease,
      releasedAt: record.targetFirmwareRelease.releasedAt?.toISOString() ?? null,
    },
  }
}

export async function getActiveModelDesiredPolicy(deviceModelId: string) {
  const record = await prisma.firmwarePolicy.findFirst({
    where: modelBaselineWhere(deviceModelId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { targetFirmwareRelease: { select: targetFirmwareSelect } },
  })

  return record ? serializePolicy(record) : null
}

export async function setModelDesiredFirmwarePolicy(
  deviceModelIdValue: unknown,
  firmwareReleaseIdValue: unknown,
  actorUserId: string | null = null,
) {
  const deviceModelId = cleanId(deviceModelIdValue)
  const firmwareReleaseId = cleanId(firmwareReleaseIdValue)
  if (!deviceModelId) throw new FirmwarePolicyValidationError('Device model is required.')
  if (!firmwareReleaseId) throw new FirmwarePolicyValidationError('Desired firmware release is required.')

  const [model, release] = await Promise.all([
    prisma.deviceModel.findUnique({
      where: { id: deviceModelId },
      select: { id: true, vendorId: true, platform: true },
    }),
    prisma.firmwareRelease.findUnique({
      where: { id: firmwareReleaseId },
      select: targetFirmwareSelect,
    }),
  ])

  if (!model) throw new FirmwarePolicyNotFoundError('Device model was not found.')
  if (!release) throw new FirmwarePolicyReferenceError('The selected firmware release does not exist.')
  if (release.vendorId !== model.vendorId) {
    throw new FirmwarePolicyCompatibilityError('Desired firmware must belong to the same vendor as the device model.')
  }
  if (model.platform && normalizePlatform(release.platform) !== normalizePlatform(model.platform)) {
    throw new FirmwarePolicyCompatibilityError('Desired firmware must match the platform/family of the device model.')
  }
  if (!release.isActive) {
    throw new FirmwarePolicyCompatibilityError('Archived firmware cannot be selected as a new desired target.')
  }

  const normalizedStatus = release.status.toUpperCase()
  if (!NORMAL_DESIRED_FIRMWARE_STATUSES.includes(normalizedStatus as (typeof NORMAL_DESIRED_FIRMWARE_STATUSES)[number])) {
    throw new FirmwarePolicyCompatibilityError('Choose firmware with APPROVED or RECOMMENDED status as the desired target.')
  }

  const current = await prisma.firmwarePolicy.findFirst({
    where: modelBaselineWhere(deviceModelId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { targetFirmwareRelease: { select: targetFirmwareSelect } },
  })
  if (current?.targetFirmwareReleaseId === firmwareReleaseId) return serializePolicy(current)

  const created = await prisma.$transaction(async (tx) => {
    await tx.firmwarePolicy.updateMany({
      where: modelBaselineWhere(deviceModelId),
      data: { isActive: false },
    })
    const next = await tx.firmwarePolicy.create({
      data: {
        deviceModelId,
        targetFirmwareReleaseId: firmwareReleaseId,
        isActive: true,
      },
      include: { targetFirmwareRelease: { select: targetFirmwareSelect } },
    })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        action: AUDIT_ACTIONS.desiredFirmwareChanged,
        entityType: 'DeviceModel',
        entityId: deviceModelId,
        before: {
          policyId: current?.id ?? null,
          firmwareReleaseId: current?.targetFirmwareReleaseId ?? null,
          version: current?.targetFirmwareRelease.version ?? null,
          status: current?.targetFirmwareRelease.status ?? null,
        },
        after: {
          policyId: next.id,
          firmwareReleaseId: next.targetFirmwareReleaseId,
          version: next.targetFirmwareRelease.version,
          status: next.targetFirmwareRelease.status,
        },
        metadata: { platform: model.platform ?? release.platform },
      },
    })
    return next
  })

  return serializePolicy(created)
}

export async function clearModelDesiredFirmwarePolicy(
  deviceModelIdValue: unknown,
  actorUserId: string | null = null,
) {
  const deviceModelId = cleanId(deviceModelIdValue)
  if (!deviceModelId) throw new FirmwarePolicyValidationError('Device model is required.')

  const model = await prisma.deviceModel.findUnique({ where: { id: deviceModelId }, select: { id: true } })
  if (!model) throw new FirmwarePolicyNotFoundError('Device model was not found.')

  const current = await prisma.firmwarePolicy.findFirst({
    where: modelBaselineWhere(deviceModelId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { targetFirmwareRelease: { select: targetFirmwareSelect } },
  })
  if (!current) return { cleared: false }

  await prisma.$transaction(async (tx) => {
    await tx.firmwarePolicy.updateMany({
      where: modelBaselineWhere(deviceModelId),
      data: { isActive: false },
    })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        action: AUDIT_ACTIONS.desiredFirmwareCleared,
        entityType: 'DeviceModel',
        entityId: deviceModelId,
        before: {
          policyId: current.id,
          firmwareReleaseId: current.targetFirmwareReleaseId,
          version: current.targetFirmwareRelease.version,
          status: current.targetFirmwareRelease.status,
        },
        after: {
          policyId: null,
          firmwareReleaseId: null,
          version: null,
          status: null,
        },
      },
    })
  })
  return { cleared: true }
}
