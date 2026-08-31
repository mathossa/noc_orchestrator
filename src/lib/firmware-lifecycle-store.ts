import { prisma } from '@/lib/prisma'
import { getActiveModelDesiredPolicy } from '@/lib/firmware-policy-store'
import { parseFirmwareLifecycleInput } from '@/lib/firmware-lifecycle'

export class FirmwareLifecycleNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareLifecycleNotFoundError'
  }
}

export class FirmwareLifecyclePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareLifecyclePolicyError'
  }
}

const lifecycleInclude = {
  targetFirmwareRelease: {
    select: {
      id: true,
      vendorId: true,
      platform: true,
      version: true,
      status: true,
      isActive: true,
      firmwareTrain: { select: { id: true, name: true } },
    },
  },
  decidedBy: { select: { id: true, name: true, email: true } },
} as const

function serializeLifecycle(record: {
  id: string
  deviceId: string
  targetFirmwareReleaseId: string
  state: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
  reason: string | null
  notes: string | null
  plannedFor: Date | null
  reviewAt: Date | null
  decidedAt: Date
  decidedByUserId: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
  targetFirmwareRelease: {
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    firmwareTrain: { id: string; name: string } | null
  }
  decidedBy: { id: string; name: string; email: string } | null
}) {
  return {
    id: record.id,
    deviceId: record.deviceId,
    targetFirmwareReleaseId: record.targetFirmwareReleaseId,
    state: record.state,
    reason: record.reason,
    notes: record.notes,
    plannedFor: record.plannedFor?.toISOString() ?? null,
    reviewAt: record.reviewAt?.toISOString() ?? null,
    decidedAt: record.decidedAt.toISOString(),
    decidedByUserId: record.decidedByUserId,
    decidedBy: record.decidedBy,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    targetFirmwareRelease: record.targetFirmwareRelease,
  }
}

export async function setFirmwareLifecycleDecision(
  deviceId: string,
  rawInput: unknown,
  actorUserId: string | null = null,
) {
  const input = parseFirmwareLifecycleInput(rawInput)
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, deviceModelId: true },
  })
  if (!device) throw new FirmwareLifecycleNotFoundError('Device was not found.')

  const desiredPolicy = await getActiveModelDesiredPolicy(device.deviceModelId)
  if (!desiredPolicy) {
    throw new FirmwareLifecyclePolicyError(
      'A lifecycle decision requires an explicit desired firmware policy for the device model.',
    )
  }

  const current = await prisma.firmwareLifecycleRecord.findUnique({
    where: { deviceId },
    select: { completedAt: true, state: true },
  })
  const now = new Date()
  const completedAt = input.state === 'DONE'
    ? current?.state === 'DONE' && current.completedAt
      ? current.completedAt
      : now
    : null

  const record = await prisma.firmwareLifecycleRecord.upsert({
    where: { deviceId },
    create: {
      deviceId,
      targetFirmwareReleaseId: desiredPolicy.release.id,
      state: input.state,
      reason: input.reason,
      notes: input.notes,
      plannedFor: input.plannedFor,
      reviewAt: input.reviewAt,
      decidedAt: now,
      decidedByUserId: actorUserId,
      completedAt,
    },
    update: {
      targetFirmwareReleaseId: desiredPolicy.release.id,
      state: input.state,
      reason: input.reason,
      notes: input.notes,
      plannedFor: input.plannedFor,
      reviewAt: input.reviewAt,
      decidedAt: now,
      decidedByUserId: actorUserId,
      completedAt,
    },
    include: lifecycleInclude,
  })

  return serializeLifecycle(record)
}
