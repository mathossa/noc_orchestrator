import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'
import { getActiveModelDesiredPolicy } from '@/lib/firmware-policy-store'
import { parseFirmwareLifecycleInput, type FirmwareWorkflowState } from '@/lib/firmware-lifecycle'

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

function auditActionForState(state: FirmwareWorkflowState) {
  switch (state) {
    case 'PLANNED':
      return AUDIT_ACTIONS.lifecyclePlanned
    case 'IGNORED':
      return AUDIT_ACTIONS.lifecycleIgnored
    case 'CUSTOMER_DECLINED':
      return AUDIT_ACTIONS.lifecycleCustomerDeclined
    case 'DONE':
      return AUDIT_ACTIONS.lifecycleDone
  }
}

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
    select: { id: true, deviceModelId: true, customerId: true },
  })
  if (!device) throw new FirmwareLifecycleNotFoundError('Device was not found.')

  const desiredPolicy = await getActiveModelDesiredPolicy(device.deviceModelId)
  if (!desiredPolicy) {
    throw new FirmwareLifecyclePolicyError(
      'A lifecycle decision requires an explicit desired firmware policy for the device model.',
    )
  }

  const now = new Date()
  const record = await prisma.$transaction(async (tx) => {
    const current = await tx.firmwareLifecycleRecord.findUnique({
      where: { deviceId },
      select: {
        id: true,
        targetFirmwareReleaseId: true,
        state: true,
        reason: true,
        notes: true,
        plannedFor: true,
        reviewAt: true,
        decidedAt: true,
        completedAt: true,
        targetFirmwareRelease: { select: { version: true } },
      },
    })

    const completedAt = input.state === 'DONE'
      ? current?.state === 'DONE' && current.completedAt
        ? current.completedAt
        : now
      : null

    const next = await tx.firmwareLifecycleRecord.upsert({
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

    await tx.auditEvent.create({
      data: {
        actorUserId,
        customerId: device.customerId,
        action: auditActionForState(input.state),
        entityType: 'Device',
        entityId: device.id,
        before: {
          lifecycleRecordId: current?.id ?? null,
          state: current?.state ?? null,
          targetFirmwareReleaseId: current?.targetFirmwareReleaseId ?? null,
          targetVersion: current?.targetFirmwareRelease.version ?? null,
          reason: current?.reason ?? null,
          notes: current?.notes ?? null,
          plannedFor: current?.plannedFor?.toISOString() ?? null,
          reviewAt: current?.reviewAt?.toISOString() ?? null,
          completedAt: current?.completedAt?.toISOString() ?? null,
        },
        after: {
          lifecycleRecordId: next.id,
          state: next.state,
          targetFirmwareReleaseId: next.targetFirmwareReleaseId,
          targetVersion: next.targetFirmwareRelease.version,
          reason: next.reason,
          notes: next.notes,
          plannedFor: next.plannedFor?.toISOString() ?? null,
          reviewAt: next.reviewAt?.toISOString() ?? null,
          completedAt: next.completedAt?.toISOString() ?? null,
        },
        metadata: {
          deviceModelId: device.deviceModelId,
          desiredPolicyId: desiredPolicy.id,
        },
      },
    })
    return next
  })

  return serializeLifecycle(record)
}
