import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'
import { listAuditEventsForEntity } from '@/lib/audit-event-store'
import { assertSiteBelongsToCustomer } from '@/lib/site-store'
import { getActiveModelDesiredPolicy } from '@/lib/firmware-policy-store'
import { resolveTechnicalFirmwareState } from '@/lib/firmware-state'
import {
  normalizedDeviceName,
  normalizedPlatform,
  parseDeviceInput,
  type DeviceContractReference,
  type DeviceDetailRecord,
  type DeviceRecord,
  type DeviceReferenceData,
} from '@/lib/devices'

export class DeviceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceConflictError'
  }
}

export class DeviceNotFoundError extends Error {
  constructor() {
    super('Device was not found.')
    this.name = 'DeviceNotFoundError'
  }
}

export class DeviceReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceReferenceError'
  }
}

export class DeviceInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceInUseError'
  }
}

const contractSelect = {
  id: true,
  code: true,
  name: true,
  firmwareManagementEnabled: true,
  isActive: true,
} as const

const deviceInclude = {
  customer: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      contractType: { select: contractSelect },
    },
  },
  site: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      contractType: { select: contractSelect },
    },
  },
  deviceModel: {
    select: {
      id: true,
      model: true,
      platform: true,
      supportedPlatforms: { select: { id: true, platform: true } },
      isActive: true,
      vendor: { select: { id: true, code: true, name: true, isActive: true } },
      deviceType: { select: { id: true, code: true, name: true, isActive: true } },
    },
  },
  currentFirmwareRelease: {
    select: {
      id: true,
      vendorId: true,
      platform: true,
      version: true,
      status: true,
      isActive: true,
      releasedAt: true,
      firmwareTrain: { select: { id: true, name: true } },
    },
  },
  lifecycle: {
    select: {
      id: true,
      state: true,
      reason: true,
      notes: true,
      plannedFor: true,
      reviewAt: true,
      decidedAt: true,
      completedAt: true,
      decidedBy: { select: { id: true, name: true, email: true } },
      targetFirmwareRelease: { select: { id: true, version: true, platform: true } },
    },
  },
} as const

type IncludedDevice = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  platform: string | null
  name: string
  hostname: string | null
  serialNumber: string | null
  managementAddress: string | null
  notes: string | null
  currentFirmwareReleaseId: string | null
  currentFirmwareObservedAt: Date | null
  currentFirmwareSource: string
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
  customer: {
    id: string
    code: string | null
    name: string
    isActive: boolean
    contractType: DeviceContractReference | null
  }
  site: {
    id: string
    code: string | null
    name: string
    isActive: boolean
    contractType: DeviceContractReference | null
  } | null
  deviceModel: {
    id: string
    model: string
    platform: string | null
    supportedPlatforms: Array<{ id: string; platform: string }>
    isActive: boolean
    vendor: { id: string; code: string; name: string; isActive: boolean }
    deviceType: { id: string; code: string; name: string; isActive: boolean }
  }
  currentFirmwareRelease: {
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    releasedAt: Date | null
    firmwareTrain: { id: string; name: string } | null
  } | null
  lifecycle: {
    id: string
    state: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
    reason: string | null
    notes: string | null
    plannedFor: Date | null
    reviewAt: Date | null
    decidedAt: Date
    completedAt: Date | null
    decidedBy: { id: string; name: string; email: string } | null
    targetFirmwareRelease: { id: string; version: string; platform: string }
  } | null
}

function firmwareAgeDays(observedAt: Date | null) {
  if (!observedAt) return null
  return Math.max(0, Math.floor((Date.now() - observedAt.getTime()) / 86_400_000))
}

function serializeDevice(record: IncludedDevice): DeviceRecord {
  const effectiveContractType = record.site?.contractType ?? record.customer.contractType
  return {
    id: record.id,
    customerId: record.customerId,
    siteId: record.siteId,
    deviceModelId: record.deviceModelId,
    platform: record.platform,
    name: record.name,
    hostname: record.hostname,
    serialNumber: record.serialNumber,
    managementAddress: record.managementAddress,
    notes: record.notes,
    currentFirmwareReleaseId: record.currentFirmwareReleaseId,
    currentFirmwareObservedAt: record.currentFirmwareObservedAt?.toISOString() ?? null,
    currentFirmwareAgeDays: firmwareAgeDays(record.currentFirmwareObservedAt),
    currentFirmwareSource: record.currentFirmwareSource,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
    customer: record.customer,
    site: record.site,
    effectiveContractType,
    contractSource: record.site?.contractType ? 'SITE' : record.customer.contractType ? 'CUSTOMER' : 'NONE',
    deviceModel: record.deviceModel,
    currentFirmwareRelease: record.currentFirmwareRelease
      ? {
          ...record.currentFirmwareRelease,
          releasedAt: record.currentFirmwareRelease.releasedAt?.toISOString() ?? null,
        }
      : null,
    lifecycle: record.lifecycle
      ? {
          ...record.lifecycle,
          plannedFor: record.lifecycle.plannedFor?.toISOString() ?? null,
          reviewAt: record.lifecycle.reviewAt?.toISOString() ?? null,
          decidedAt: record.lifecycle.decidedAt.toISOString(),
          completedAt: record.lifecycle.completedAt?.toISOString() ?? null,
        }
      : null,
  }
}

async function assertUniqueWithinCustomer(customerId: string, name: string, excludeId?: string) {
  const records = await prisma.device.findMany({
    where: { customerId },
    select: { id: true, name: true },
  })
  const normalized = normalizedDeviceName(name)
  const conflict = records.find(
    (record) => record.id !== excludeId && normalizedDeviceName(record.name) === normalized,
  )
  if (conflict) throw new DeviceConflictError(`Device “${name}” already exists for this customer.`)
}

function modelPlatformSet(model: {
  platform: string | null
  supportedPlatforms: Array<{ platform: string }>
}) {
  const platforms = new Map<string, string>()
  if (model.platform) platforms.set(normalizedPlatform(model.platform), model.platform)
  for (const entry of model.supportedPlatforms) platforms.set(normalizedPlatform(entry.platform), entry.platform)
  platforms.delete('')
  return platforms
}

async function validateAndInferReferences(input: ReturnType<typeof parseDeviceInput>) {
  const [customer, model, release] = await Promise.all([
    prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }),
    prisma.deviceModel.findUnique({
      where: { id: input.deviceModelId },
      select: {
        id: true,
        vendorId: true,
        platform: true,
        supportedPlatforms: { select: { platform: true } },
      },
    }),
    input.currentFirmwareReleaseId
      ? prisma.firmwareRelease.findUnique({
          where: { id: input.currentFirmwareReleaseId },
          select: { id: true, vendorId: true, platform: true },
        })
      : Promise.resolve(null),
  ])

  if (!customer) throw new DeviceReferenceError('The selected customer does not exist.')
  if (!model) throw new DeviceReferenceError('The selected device model does not exist.')
  await assertSiteBelongsToCustomer(input.siteId, input.customerId)

  if (input.currentFirmwareReleaseId && !release) {
    throw new DeviceReferenceError('The selected current firmware release does not exist.')
  }
  if (release && release.vendorId !== model.vendorId) {
    throw new DeviceReferenceError('Current firmware must belong to the same vendor as the selected device model.')
  }

  const supported = modelPlatformSet(model)
  const inferredPlatform = input.platform ?? release?.platform ?? (supported.size === 1 ? [...supported.values()][0] : null)
  if (!inferredPlatform && supported.size > 1) {
    throw new DeviceReferenceError(
      `Choose a device platform because this model supports multiple platforms (${[...supported.values()].join(', ')}).`,
    )
  }
  if (inferredPlatform && supported.size > 0 && !supported.has(normalizedPlatform(inferredPlatform))) {
    throw new DeviceReferenceError(`Platform “${inferredPlatform}” is not supported by the selected device model.`)
  }
  if (release && inferredPlatform && normalizedPlatform(release.platform) !== normalizedPlatform(inferredPlatform)) {
    throw new DeviceReferenceError('Current firmware must match the selected device platform.')
  }

  return { ...input, platform: inferredPlatform }
}

export async function listDevices() {
  const records = await prisma.device.findMany({
    orderBy: [{ isActive: 'desc' }, { customer: { name: 'asc' } }, { name: 'asc' }],
    include: deviceInclude,
  })
  return records.map((record) => serializeDevice(record as IncludedDevice))
}

export async function listDeviceReferences(): Promise<DeviceReferenceData> {
  const [customers, sites, models, firmwareReleases] = await Promise.all([
    prisma.customer.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        contractType: { select: contractSelect },
      },
    }),
    prisma.site.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        customerId: true,
        code: true,
        name: true,
        isActive: true,
        contractType: { select: contractSelect },
      },
    }),
    prisma.deviceModel.findMany({
      orderBy: [{ isActive: 'desc' }, { model: 'asc' }],
      select: {
        id: true,
        model: true,
        platform: true,
        supportedPlatforms: { select: { id: true, platform: true } },
        isActive: true,
        vendor: { select: { id: true, code: true, name: true, isActive: true } },
        deviceType: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    prisma.firmwareRelease.findMany({
      orderBy: [{ isActive: 'desc' }, { platform: 'asc' }, { version: 'asc' }],
      select: {
        id: true,
        vendorId: true,
        platform: true,
        version: true,
        status: true,
        isActive: true,
        firmwareTrain: { select: { id: true, name: true } },
      },
    }),
  ])
  return { customers, sites, models, firmwareReleases }
}

export async function getDevice(id: string): Promise<DeviceDetailRecord> {
  const record = await prisma.device.findUnique({ where: { id }, include: deviceInclude })
  if (!record) throw new DeviceNotFoundError()

  const effectivePlatform = record.platform ?? record.currentFirmwareRelease?.platform ?? record.deviceModel.platform
  const [desiredPolicy, auditHistory] = await Promise.all([
    getActiveModelDesiredPolicy(record.deviceModelId, effectivePlatform),
    listAuditEventsForEntity('Device', id),
  ])
  const desiredRelease = desiredPolicy
    ? {
        id: desiredPolicy.release.id,
        vendorId: desiredPolicy.release.vendorId,
        platform: desiredPolicy.release.platform,
        version: desiredPolicy.release.version,
        status: desiredPolicy.release.status,
        isActive: desiredPolicy.release.isActive,
        firmwareTrain: desiredPolicy.release.firmwareTrain,
      }
    : null
  const technicalState = resolveTechnicalFirmwareState({
    currentFirmwareReleaseId: record.currentFirmwareReleaseId,
    desiredFirmwareReleaseId: desiredRelease?.id,
  })

  return {
    ...serializeDevice(record as IncludedDevice),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    desiredFirmware: { available: true, release: desiredRelease },
    technicalState: { available: true, state: technicalState },
    auditHistory,
  }
}

export async function createDevice(rawInput: unknown, actorUserId: string | null = null) {
  const input = await validateAndInferReferences(parseDeviceInput(rawInput))
  await assertUniqueWithinCustomer(input.customerId, input.name)

  if (!input.currentFirmwareReleaseId) {
    const record = await prisma.device.create({ data: input, include: deviceInclude })
    return serializeDevice(record as IncludedDevice)
  }

  const record = await prisma.$transaction(async (tx) => {
    const next = await tx.device.create({ data: input, include: deviceInclude })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        customerId: input.customerId,
        action: AUDIT_ACTIONS.currentFirmwareChanged,
        entityType: 'Device',
        entityId: next.id,
        before: {
          firmwareReleaseId: null,
          version: null,
          observedAt: null,
          source: null,
          platform: null,
        },
        after: {
          firmwareReleaseId: next.currentFirmwareReleaseId,
          version: next.currentFirmwareRelease?.version ?? null,
          observedAt: next.currentFirmwareObservedAt?.toISOString() ?? null,
          source: next.currentFirmwareSource,
          platform: next.platform,
        },
        metadata: { context: 'DEVICE_CREATED' },
      },
    })
    return next
  })
  return serializeDevice(record as IncludedDevice)
}

export async function updateDevice(id: string, rawInput: unknown, actorUserId: string | null = null) {
  const current = await prisma.device.findUnique({
    where: { id },
    include: {
      currentFirmwareRelease: { select: { id: true, version: true, platform: true } },
    },
  })
  if (!current) throw new DeviceNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = await validateAndInferReferences(parseDeviceInput({
    customerId: current.customerId,
    siteId: current.siteId,
    deviceModelId: current.deviceModelId,
    platform: current.platform,
    name: current.name,
    hostname: current.hostname,
    serialNumber: current.serialNumber,
    managementAddress: current.managementAddress,
    notes: current.notes,
    currentFirmwareReleaseId: current.currentFirmwareReleaseId,
    currentFirmwareObservedAt: current.currentFirmwareObservedAt?.toISOString() ?? null,
    currentFirmwareSource: current.currentFirmwareSource,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    isActive: current.isActive,
    ...patch,
  }))

  await assertUniqueWithinCustomer(input.customerId, input.name, id)

  const currentObservedAt = current.currentFirmwareObservedAt?.getTime() ?? null
  const nextObservedAt = input.currentFirmwareObservedAt?.getTime() ?? null
  const firmwareChanged =
    current.currentFirmwareReleaseId !== input.currentFirmwareReleaseId ||
    currentObservedAt !== nextObservedAt ||
    current.currentFirmwareSource !== input.currentFirmwareSource ||
    current.platform !== input.platform

  if (!firmwareChanged) {
    const record = await prisma.device.update({ where: { id }, data: input, include: deviceInclude })
    return serializeDevice(record as IncludedDevice)
  }

  const record = await prisma.$transaction(async (tx) => {
    const next = await tx.device.update({ where: { id }, data: input, include: deviceInclude })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        customerId: input.customerId,
        action: AUDIT_ACTIONS.currentFirmwareChanged,
        entityType: 'Device',
        entityId: id,
        before: {
          firmwareReleaseId: current.currentFirmwareReleaseId,
          version: current.currentFirmwareRelease?.version ?? null,
          observedAt: current.currentFirmwareObservedAt?.toISOString() ?? null,
          source: current.currentFirmwareSource,
          platform: current.platform,
        },
        after: {
          firmwareReleaseId: next.currentFirmwareReleaseId,
          version: next.currentFirmwareRelease?.version ?? null,
          observedAt: next.currentFirmwareObservedAt?.toISOString() ?? null,
          source: next.currentFirmwareSource,
          platform: next.platform,
        },
        metadata: { context: 'DEVICE_UPDATED' },
      },
    })
    return next
  })
  return serializeDevice(record as IncludedDevice)
}

export async function deleteDevice(id: string) {
  const current = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!current) throw new DeviceNotFoundError()

  const [policies, lifecycleRecords, auditEvents] = await Promise.all([
    prisma.firmwarePolicy.count({ where: { deviceId: id } }),
    prisma.firmwareLifecycleRecord.count({ where: { deviceId: id } }),
    prisma.auditEvent.count({ where: { entityType: 'Device', entityId: id } }),
  ])
  const references = policies + lifecycleRecords + auditEvents
  if (references > 0) {
    throw new DeviceInUseError(
      `This device is referenced by ${references} policy, lifecycle, or audit record${references === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }

  return prisma.device.delete({ where: { id } })
}
