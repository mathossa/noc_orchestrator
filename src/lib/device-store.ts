import { prisma } from '@/lib/prisma'
import { assertSiteBelongsToCustomer } from '@/lib/site-store'
import { getActiveModelDesiredPolicy } from '@/lib/firmware-policy-store'
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
      state: true,
      targetFirmwareRelease: { select: { id: true, version: true, platform: true } },
    },
  },
} as const

type IncludedDevice = {
  id: string
  customerId: string
  siteId: string | null
  deviceModelId: string
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
    state: 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
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
    lifecycle: record.lifecycle,
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

async function assertReferences(input: ReturnType<typeof parseDeviceInput>) {
  const [customer, model] = await Promise.all([
    prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }),
    prisma.deviceModel.findUnique({
      where: { id: input.deviceModelId },
      select: { id: true, vendorId: true, platform: true },
    }),
  ])

  if (!customer) throw new DeviceReferenceError('The selected customer does not exist.')
  if (!model) throw new DeviceReferenceError('The selected device model does not exist.')

  await assertSiteBelongsToCustomer(input.siteId, input.customerId)

  if (!input.currentFirmwareReleaseId) return

  const release = await prisma.firmwareRelease.findUnique({
    where: { id: input.currentFirmwareReleaseId },
    select: { id: true, vendorId: true, platform: true },
  })
  if (!release) throw new DeviceReferenceError('The selected current firmware release does not exist.')
  if (release.vendorId !== model.vendorId) {
    throw new DeviceReferenceError('Current firmware must belong to the same vendor as the selected device model.')
  }
  if (model.platform && normalizedPlatform(release.platform) !== normalizedPlatform(model.platform)) {
    throw new DeviceReferenceError('Current firmware must match the platform/family of the selected device model.')
  }
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

  const desiredPolicy = await getActiveModelDesiredPolicy(record.deviceModelId)
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

  return {
    ...serializeDevice(record as IncludedDevice),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    desiredFirmware: { available: true, release: desiredRelease },
    // Issue #10 owns canonical CURRENT/ACTION REQUIRED/etc. resolution.
    technicalState: { available: false, state: null },
  }
}

export async function createDevice(rawInput: unknown) {
  const input = parseDeviceInput(rawInput)
  await assertReferences(input)
  await assertUniqueWithinCustomer(input.customerId, input.name)
  const record = await prisma.device.create({ data: input, include: deviceInclude })
  return serializeDevice(record as IncludedDevice)
}

export async function updateDevice(id: string, rawInput: unknown) {
  const current = await prisma.device.findUnique({ where: { id } })
  if (!current) throw new DeviceNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseDeviceInput({
    customerId: current.customerId,
    siteId: current.siteId,
    deviceModelId: current.deviceModelId,
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
  })

  await assertReferences(input)
  await assertUniqueWithinCustomer(input.customerId, input.name, id)
  const record = await prisma.device.update({ where: { id }, data: input, include: deviceInclude })
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
