import { prisma } from '@/lib/prisma'
import {
  normalizedFirmwareTrainName,
  normalizedFirmwareTrainPlatform,
  parseFirmwareTrainInput,
  type FirmwareTrainRecord,
} from '@/lib/firmware-trains'

export class FirmwareTrainConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareTrainConflictError'
  }
}

export class FirmwareTrainNotFoundError extends Error {
  constructor() {
    super('Firmware train was not found.')
    this.name = 'FirmwareTrainNotFoundError'
  }
}

export class FirmwareTrainReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareTrainReferenceError'
  }
}

export class FirmwareTrainInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareTrainInUseError'
  }
}

const trainInclude = {
  vendor: { select: { id: true, code: true, name: true, isActive: true } },
  _count: { select: { releases: true } },
} as const

function serializeTrain(record: {
  id: string
  vendorId: string
  vendor: { id: string; code: string; name: string; isActive: boolean }
  platform: string
  name: string
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
  _count: { releases: number }
}): FirmwareTrainRecord {
  return {
    id: record.id,
    vendorId: record.vendorId,
    vendor: record.vendor,
    platform: record.platform,
    name: record.name,
    notes: record.notes,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
    releaseCount: record._count.releases,
  }
}

async function assertVendor(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })
  if (!vendor) throw new FirmwareTrainReferenceError('The selected vendor does not exist.')
}

async function assertUnique(vendorId: string, platform: string, name: string, excludeId?: string) {
  const candidates = await prisma.firmwareTrain.findMany({
    where: { vendorId },
    select: { id: true, platform: true, name: true },
  })
  const normalizedPlatform = normalizedFirmwareTrainPlatform(platform)
  const normalizedName = normalizedFirmwareTrainName(name)
  const conflict = candidates.find(
    (candidate) =>
      candidate.id !== excludeId &&
      normalizedFirmwareTrainPlatform(candidate.platform) === normalizedPlatform &&
      normalizedFirmwareTrainName(candidate.name) === normalizedName,
  )
  if (conflict) throw new FirmwareTrainConflictError('This firmware train already exists for the selected vendor and platform.')
}

export async function listFirmwareTrains() {
  const records = await prisma.firmwareTrain.findMany({
    orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { platform: 'asc' }, { name: 'asc' }],
    include: trainInclude,
  })
  return records.map(serializeTrain)
}

export async function getFirmwareTrain(id: string) {
  const record = await prisma.firmwareTrain.findUnique({
    where: { id },
    include: {
      ...trainInclude,
      releases: {
        orderBy: [{ isActive: 'desc' }, { releasedAt: 'desc' }, { version: 'asc' }],
        select: { id: true, version: true, status: true, isActive: true, releasedAt: true },
      },
    },
  })
  if (!record) throw new FirmwareTrainNotFoundError()
  return {
    ...serializeTrain(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    releases: record.releases.map((release) => ({
      ...release,
      releasedAt: release.releasedAt?.toISOString() ?? null,
    })),
  }
}

export async function createFirmwareTrain(rawInput: unknown) {
  const input = parseFirmwareTrainInput(rawInput)
  await assertVendor(input.vendorId)
  await assertUnique(input.vendorId, input.platform, input.name)
  const created = await prisma.firmwareTrain.create({ data: input, include: trainInclude })
  return serializeTrain(created)
}

export async function updateFirmwareTrain(id: string, rawInput: unknown) {
  const current = await prisma.firmwareTrain.findUnique({ where: { id } })
  if (!current) throw new FirmwareTrainNotFoundError()
  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseFirmwareTrainInput({
    vendorId: current.vendorId,
    platform: current.platform,
    name: current.name,
    notes: current.notes,
    isActive: current.isActive,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    ...patch,
  })
  await assertVendor(input.vendorId)
  await assertUnique(input.vendorId, input.platform, input.name, id)
  const updated = await prisma.firmwareTrain.update({ where: { id }, data: input, include: trainInclude })
  return serializeTrain(updated)
}

export async function deleteFirmwareTrain(id: string) {
  const current = await prisma.firmwareTrain.findUnique({ where: { id }, select: { id: true } })
  if (!current) throw new FirmwareTrainNotFoundError()
  const [releases, audit] = await Promise.all([
    prisma.firmwareRelease.count({ where: { firmwareTrainId: id } }),
    prisma.auditEvent.count({ where: { entityType: 'FirmwareTrain', entityId: id } }),
  ])
  const references = releases + audit
  if (references > 0) {
    throw new FirmwareTrainInUseError(
      `This firmware train is referenced by ${references} release or audit record${references === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }
  return prisma.firmwareTrain.delete({ where: { id } })
}
