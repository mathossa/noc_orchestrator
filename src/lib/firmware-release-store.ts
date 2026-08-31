import { prisma } from '@/lib/prisma'
import {
  normalizedFirmwarePlatform,
  parseFirmwareReleaseInput,
  type FirmwareReleaseRecord,
} from '@/lib/firmware-releases'

export class FirmwareReleaseConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareReleaseConflictError'
  }
}

export class FirmwareReleaseNotFoundError extends Error {
  constructor() {
    super('Firmware release was not found.')
    this.name = 'FirmwareReleaseNotFoundError'
  }
}

export class FirmwareReleaseReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareReleaseReferenceError'
  }
}

export class FirmwareReleaseInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareReleaseInUseError'
  }
}

const releaseInclude = {
  vendor: { select: { id: true, code: true, name: true, isActive: true } },
  firmwareTrain: { select: { id: true, vendorId: true, platform: true, name: true, isActive: true } },
} as const

function serializeRelease(record: {
  id: string
  vendorId: string
  firmwareTrainId: string | null
  firmwareTrain: { id: string; vendorId: string; platform: string; name: string; isActive: boolean } | null
  vendor: { id: string; code: string; name: string; isActive: boolean }
  platform: string
  version: string
  filename: string | null
  sha256: string | null
  fileSizeBytes: bigint | null
  releaseNotesUrl: string | null
  status: string
  notes: string | null
  releasedAt: Date | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
}): FirmwareReleaseRecord {
  return {
    id: record.id,
    vendorId: record.vendorId,
    firmwareTrainId: record.firmwareTrainId,
    firmwareTrain: record.firmwareTrain,
    vendor: record.vendor,
    platform: record.platform,
    version: record.version,
    filename: record.filename,
    sha256: record.sha256,
    fileSizeBytes: record.fileSizeBytes?.toString() ?? null,
    releaseNotesUrl: record.releaseNotesUrl,
    status: record.status as FirmwareReleaseRecord['status'],
    notes: record.notes,
    releasedAt: record.releasedAt?.toISOString() ?? null,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
  }
}

async function assertVendor(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })
  if (!vendor) throw new FirmwareReleaseReferenceError('The selected vendor does not exist.')
}

async function assertTrainAssignment(firmwareTrainId: string | null, vendorId: string, platform: string) {
  if (!firmwareTrainId) return
  const train = await prisma.firmwareTrain.findUnique({
    where: { id: firmwareTrainId },
    select: { id: true, vendorId: true, platform: true },
  })
  if (!train) throw new FirmwareReleaseReferenceError('The selected firmware train does not exist.')
  if (train.vendorId !== vendorId) {
    throw new FirmwareReleaseReferenceError('The selected firmware train belongs to a different vendor.')
  }
  if (normalizedFirmwarePlatform(train.platform) !== normalizedFirmwarePlatform(platform)) {
    throw new FirmwareReleaseReferenceError('The selected firmware train belongs to a different platform/family.')
  }
}

async function assertUnique(vendorId: string, platform: string, version: string, excludeId?: string) {
  const candidates = await prisma.firmwareRelease.findMany({
    where: { vendorId, version },
    select: { id: true, platform: true },
  })
  const normalizedPlatform = normalizedFirmwarePlatform(platform)
  const conflict = candidates.find(
    (candidate) => candidate.id !== excludeId && normalizedFirmwarePlatform(candidate.platform) === normalizedPlatform,
  )
  if (conflict) {
    throw new FirmwareReleaseConflictError('This vendor, platform/family, and version already exist in the catalog.')
  }
}

export async function listFirmwareReleases() {
  const records = await prisma.firmwareRelease.findMany({
    orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { platform: 'asc' }, { version: 'asc' }],
    include: releaseInclude,
  })
  return records.map(serializeRelease)
}

export async function listFirmwareVendors() {
  return prisma.vendor.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, isActive: true },
  })
}

export async function listFirmwareTrainReferences() {
  return prisma.firmwareTrain.findMany({
    orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { platform: 'asc' }, { name: 'asc' }],
    select: { id: true, vendorId: true, platform: true, name: true, isActive: true },
  })
}

export async function getFirmwareRelease(id: string) {
  const record = await prisma.firmwareRelease.findUnique({
    where: { id },
    include: releaseInclude,
  })
  if (!record) throw new FirmwareReleaseNotFoundError()

  const [matchingModels, currentDevices, targetPolicies, lifecycleTargets] = await Promise.all([
    prisma.deviceModel.findMany({
      where: {
        vendorId: record.vendorId,
        platform: { equals: record.platform, mode: 'insensitive' },
      },
      orderBy: { model: 'asc' },
      select: {
        id: true,
        model: true,
        platform: true,
        deviceType: { select: { id: true, name: true } },
        _count: { select: { devices: true } },
      },
    }),
    prisma.device.count({ where: { currentFirmwareReleaseId: id } }),
    prisma.firmwarePolicy.count({ where: { targetFirmwareReleaseId: id } }),
    prisma.firmwareLifecycleRecord.count({ where: { targetFirmwareReleaseId: id } }),
  ])

  return {
    ...serializeRelease(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    matchingModels: matchingModels.map((model) => ({
      id: model.id,
      model: model.model,
      platform: model.platform,
      deviceType: model.deviceType,
      deviceCount: model._count.devices,
    })),
    usage: { currentDevices, targetPolicies, lifecycleTargets },
  }
}

export async function createFirmwareRelease(rawInput: unknown) {
  const input = parseFirmwareReleaseInput(rawInput)
  await assertVendor(input.vendorId)
  await assertTrainAssignment(input.firmwareTrainId, input.vendorId, input.platform)
  await assertUnique(input.vendorId, input.platform, input.version)
  const created = await prisma.firmwareRelease.create({ data: input, include: releaseInclude })
  return serializeRelease(created)
}

export async function updateFirmwareRelease(id: string, rawInput: unknown) {
  const current = await prisma.firmwareRelease.findUnique({ where: { id } })
  if (!current) throw new FirmwareReleaseNotFoundError()
  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseFirmwareReleaseInput({
    vendorId: current.vendorId,
    firmwareTrainId: current.firmwareTrainId,
    platform: current.platform,
    version: current.version,
    filename: current.filename,
    sha256: current.sha256,
    fileSizeBytes: current.fileSizeBytes?.toString() ?? null,
    releaseNotesUrl: current.releaseNotesUrl,
    status: current.status,
    notes: current.notes,
    releasedAt: current.releasedAt?.toISOString() ?? null,
    isActive: current.isActive,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    ...patch,
  })
  await assertVendor(input.vendorId)
  await assertTrainAssignment(input.firmwareTrainId, input.vendorId, input.platform)
  await assertUnique(input.vendorId, input.platform, input.version, id)
  const updated = await prisma.firmwareRelease.update({ where: { id }, data: input, include: releaseInclude })
  return serializeRelease(updated)
}

export async function deleteFirmwareRelease(id: string) {
  const current = await prisma.firmwareRelease.findUnique({ where: { id }, select: { id: true } })
  if (!current) throw new FirmwareReleaseNotFoundError()

  const [devices, policies, lifecycle, audit] = await Promise.all([
    prisma.device.count({ where: { currentFirmwareReleaseId: id } }),
    prisma.firmwarePolicy.count({ where: { targetFirmwareReleaseId: id } }),
    prisma.firmwareLifecycleRecord.count({ where: { targetFirmwareReleaseId: id } }),
    prisma.auditEvent.count({ where: { entityType: 'FirmwareRelease', entityId: id } }),
  ])
  const references = devices + policies + lifecycle + audit
  if (references > 0) {
    throw new FirmwareReleaseInUseError(
      `This firmware release is referenced by ${references} device, policy, lifecycle, or audit record${references === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }

  return prisma.firmwareRelease.delete({ where: { id } })
}
