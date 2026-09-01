import { prisma } from '@/lib/prisma'
import {
  normalizedDeviceModelFamilyName,
  parseDeviceModelFamilyInput,
  type DeviceModelFamilyDetailRecord,
  type DeviceModelFamilyRecord,
} from '@/lib/model-families'

export class DeviceModelFamilyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceModelFamilyConflictError'
  }
}

export class DeviceModelFamilyNotFoundError extends Error {
  constructor() {
    super('Device model family / series was not found.')
    this.name = 'DeviceModelFamilyNotFoundError'
  }
}

export class DeviceModelFamilyReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceModelFamilyReferenceError'
  }
}

export class DeviceModelFamilyInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceModelFamilyInUseError'
  }
}

const familyInclude = {
  vendor: { select: { id: true, code: true, name: true, isActive: true } },
  _count: { select: { models: true } },
} as const

type IncludedFamily = {
  id: string
  vendorId: string
  name: string
  notes: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  vendor: { id: string; code: string; name: string; isActive: boolean }
  _count: { models: number }
}

function serializeFamily(record: IncludedFamily): DeviceModelFamilyRecord {
  return {
    id: record.id,
    vendorId: record.vendorId,
    name: record.name,
    notes: record.notes,
    isActive: record.isActive,
    vendor: record.vendor,
    modelCount: record._count.models,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function assertVendor(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })
  if (!vendor) throw new DeviceModelFamilyReferenceError('The selected vendor does not exist.')
}

async function assertUniqueWithinVendor(vendorId: string, name: string, excludeId?: string) {
  const records = await prisma.deviceModelFamily.findMany({
    where: { vendorId },
    select: { id: true, name: true },
  })
  const normalized = normalizedDeviceModelFamilyName(name)
  const conflict = records.find(
    (record) => record.id !== excludeId && normalizedDeviceModelFamilyName(record.name) === normalized,
  )
  if (conflict) throw new DeviceModelFamilyConflictError(`Family / series “${name}” already exists for this vendor.`)
}

export async function listDeviceModelFamilies(): Promise<DeviceModelFamilyRecord[]> {
  const records = await prisma.deviceModelFamily.findMany({
    orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { name: 'asc' }],
    include: familyInclude,
  })
  return records.map((record) => serializeFamily(record as IncludedFamily))
}

export async function getDeviceModelFamily(id: string): Promise<DeviceModelFamilyDetailRecord> {
  const record = await prisma.deviceModelFamily.findUnique({
    where: { id },
    include: {
      ...familyInclude,
      models: {
        orderBy: [{ isActive: 'desc' }, { model: 'asc' }],
        select: {
          id: true,
          model: true,
          platform: true,
          isActive: true,
          deviceType: { select: { id: true, code: true, name: true, isActive: true } },
          _count: { select: { devices: true } },
        },
      },
    },
  })
  if (!record) throw new DeviceModelFamilyNotFoundError()

  return {
    ...serializeFamily(record as IncludedFamily),
    models: record.models.map((model) => ({
      id: model.id,
      model: model.model,
      platform: model.platform,
      isActive: model.isActive,
      deviceCount: model._count.devices,
      deviceType: model.deviceType,
    })),
  }
}

export async function createDeviceModelFamily(rawInput: unknown) {
  const input = parseDeviceModelFamilyInput(rawInput)
  await assertVendor(input.vendorId)
  await assertUniqueWithinVendor(input.vendorId, input.name)
  const record = await prisma.deviceModelFamily.create({ data: input, include: familyInclude })
  return serializeFamily(record as IncludedFamily)
}

export async function updateDeviceModelFamily(id: string, rawInput: unknown) {
  const current = await prisma.deviceModelFamily.findUnique({ where: { id } })
  if (!current) throw new DeviceModelFamilyNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseDeviceModelFamilyInput({
    vendorId: current.vendorId,
    name: current.name,
    notes: current.notes,
    isActive: current.isActive,
    ...patch,
  })

  await assertVendor(input.vendorId)
  await assertUniqueWithinVendor(input.vendorId, input.name, id)

  if (input.vendorId !== current.vendorId) {
    const modelCount = await prisma.deviceModel.count({ where: { familyId: id } })
    if (modelCount > 0) {
      throw new DeviceModelFamilyInUseError(
        'A family with concrete models cannot be moved to another vendor. Move or clear the model memberships first.',
      )
    }
  }

  const record = await prisma.deviceModelFamily.update({ where: { id }, data: input, include: familyInclude })
  return serializeFamily(record as IncludedFamily)
}

export async function deleteDeviceModelFamily(id: string) {
  const current = await prisma.deviceModelFamily.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!current) throw new DeviceModelFamilyNotFoundError()

  const modelCount = await prisma.deviceModel.count({ where: { familyId: id } })
  if (modelCount > 0) {
    throw new DeviceModelFamilyInUseError(
      `This family is referenced by ${modelCount} concrete model${modelCount === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }

  return prisma.deviceModelFamily.delete({ where: { id } })
}
