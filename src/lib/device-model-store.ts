import { prisma } from '@/lib/prisma'
import { normalizedDeviceModelName, parseDeviceModelInput } from '@/lib/device-models'

export class DeviceModelConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceModelConflictError'
  }
}

export class DeviceModelNotFoundError extends Error {
  constructor() {
    super('Device model was not found.')
    this.name = 'DeviceModelNotFoundError'
  }
}

export class DeviceModelInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceModelInUseError'
  }
}

export class DeviceModelReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceModelReferenceError'
  }
}

const deviceModelInclude = {
  vendor: { select: { id: true, code: true, name: true, isActive: true } },
  deviceType: { select: { id: true, code: true, name: true, isActive: true } },
  _count: { select: { devices: true } },
} as const

function serializeDeviceModel(record: {
  id: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string | null
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
  vendor: { id: string; code: string; name: string; isActive: boolean }
  deviceType: { id: string; code: string; name: string; isActive: boolean }
  _count: { devices: number }
}) {
  return {
    id: record.id,
    vendorId: record.vendorId,
    deviceTypeId: record.deviceTypeId,
    model: record.model,
    platform: record.platform,
    notes: record.notes,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
    vendor: record.vendor,
    deviceType: record.deviceType,
    deviceCount: record._count.devices,
  }
}

async function assertReferences(vendorId: string, deviceTypeId: string) {
  const [vendor, deviceType] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }),
    prisma.deviceType.findUnique({ where: { id: deviceTypeId }, select: { id: true } }),
  ])

  if (!vendor) throw new DeviceModelReferenceError('The selected vendor does not exist.')
  if (!deviceType) throw new DeviceModelReferenceError('The selected device type does not exist.')
}

async function assertUniqueWithinVendor(vendorId: string, model: string, excludeId?: string) {
  const records = await prisma.deviceModel.findMany({
    where: { vendorId },
    select: { id: true, model: true },
  })
  const normalized = normalizedDeviceModelName(model)
  const conflict = records.find(
    (record) => record.id !== excludeId && normalizedDeviceModelName(record.model) === normalized,
  )
  if (conflict) {
    throw new DeviceModelConflictError(`Model “${model}” already exists for this vendor.`)
  }
}

export async function listDeviceModels() {
  const records = await prisma.deviceModel.findMany({
    orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { model: 'asc' }],
    include: deviceModelInclude,
  })
  return records.map(serializeDeviceModel)
}

export async function listDeviceModelReferences() {
  const [vendors, deviceTypes] = await Promise.all([
    prisma.vendor.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
    prisma.deviceType.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, isActive: true },
    }),
  ])
  return { vendors, deviceTypes }
}

export async function getDeviceModel(id: string) {
  const record = await prisma.deviceModel.findUnique({
    where: { id },
    include: {
      ...deviceModelInclude,
      devices: {
        select: {
          id: true,
          customer: { select: { id: true, name: true } },
          currentFirmwareReleaseId: true,
          currentFirmwareRelease: {
            select: { id: true, version: true, platform: true },
          },
          lifecycle: { select: { state: true } },
        },
      },
    },
  })
  if (!record) throw new DeviceModelNotFoundError()

  const customerMap = new Map<string, { id: string; name: string; deviceCount: number }>()
  const firmwareMap = new Map<
    string,
    { firmwareReleaseId: string | null; version: string; platform: string | null; deviceCount: number }
  >()
  const workflowCounts = {
    planned: 0,
    ignored: 0,
    customerDeclined: 0,
    done: 0,
    undecided: 0,
  }

  for (const device of record.devices) {
    const customer = customerMap.get(device.customer.id)
    if (customer) customer.deviceCount += 1
    else customerMap.set(device.customer.id, { id: device.customer.id, name: device.customer.name, deviceCount: 1 })

    const firmwareKey = device.currentFirmwareReleaseId ?? 'unrecorded'
    const firmware = firmwareMap.get(firmwareKey)
    if (firmware) firmware.deviceCount += 1
    else {
      firmwareMap.set(firmwareKey, {
        firmwareReleaseId: device.currentFirmwareRelease?.id ?? null,
        version: device.currentFirmwareRelease?.version ?? 'Unrecorded',
        platform: device.currentFirmwareRelease?.platform ?? null,
        deviceCount: 1,
      })
    }

    switch (device.lifecycle?.state) {
      case 'PLANNED':
        workflowCounts.planned += 1
        break
      case 'IGNORED':
        workflowCounts.ignored += 1
        break
      case 'CUSTOMER_DECLINED':
        workflowCounts.customerDeclined += 1
        break
      case 'DONE':
        workflowCounts.done += 1
        break
      default:
        workflowCounts.undecided += 1
    }
  }

  return {
    ...serializeDeviceModel(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customers: [...customerMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    firmwareDistribution: [...firmwareMap.values()].sort((a, b) => b.deviceCount - a.deviceCount),
    workflowCounts,
    // Issue #9 owns desired-firmware policy resolution for models.
    desiredFirmware: { available: false as const, release: null },
    // Issue #7 owns the firmware catalog and model/platform release presentation.
    availableFirmware: { available: false as const, releases: [] },
  }
}

export async function createDeviceModel(rawInput: unknown) {
  const input = parseDeviceModelInput(rawInput)
  await assertReferences(input.vendorId, input.deviceTypeId)
  await assertUniqueWithinVendor(input.vendorId, input.model)
  const record = await prisma.deviceModel.create({ data: input, include: deviceModelInclude })
  return serializeDeviceModel(record)
}

export async function updateDeviceModel(id: string, rawInput: unknown) {
  const current = await prisma.deviceModel.findUnique({ where: { id } })
  if (!current) throw new DeviceModelNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseDeviceModelInput({
    vendorId: current.vendorId,
    deviceTypeId: current.deviceTypeId,
    model: current.model,
    platform: current.platform,
    notes: current.notes,
    isActive: current.isActive,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    ...patch,
  })

  await assertReferences(input.vendorId, input.deviceTypeId)
  await assertUniqueWithinVendor(input.vendorId, input.model, id)
  const record = await prisma.deviceModel.update({ where: { id }, data: input, include: deviceModelInclude })
  return serializeDeviceModel(record)
}

export async function deleteDeviceModel(id: string) {
  const current = await prisma.deviceModel.findUnique({ where: { id }, select: { id: true, model: true } })
  if (!current) throw new DeviceModelNotFoundError()

  const [devices, policies, auditEvents] = await Promise.all([
    prisma.device.count({ where: { deviceModelId: id } }),
    prisma.firmwarePolicy.count({ where: { deviceModelId: id } }),
    prisma.auditEvent.count({ where: { entityType: 'DeviceModel', entityId: id } }),
  ])
  const references = devices + policies + auditEvents

  if (references > 0) {
    throw new DeviceModelInUseError(
      `This model is referenced by ${references} device, policy, or audit record${references === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }

  return prisma.deviceModel.delete({ where: { id } })
}
