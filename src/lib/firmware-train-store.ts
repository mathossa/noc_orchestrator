import { prisma } from '@/lib/prisma'
import {
  releaseDecisionFromCatalogSemantics,
  type FirmwareReleaseDecision,
} from '@/lib/firmware-catalog-defaults'
import {
  FirmwareTrainValidationError,
  normalizedFirmwareTrainName,
  normalizedFirmwareTrainPlatform,
  parseFirmwareTrainInput,
  type FirmwareTrainRecord,
  type FirmwareTrainReleaseReference,
} from '@/lib/firmware-trains'
import { compareFirmwareVersions } from '@/lib/firmware-versioning'

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

const compactReleaseSelect = {
  id: true,
  version: true,
  logicalVersion: true,
  catalogState: true,
  policyEligibility: true,
  isActive: true,
} as const

const trainInclude = {
  vendor: { select: { id: true, code: true, name: true, isActive: true } },
  preferredRelease: { select: compactReleaseSelect },
  minimumAcceptableRelease: { select: compactReleaseSelect },
  releases: {
    select: {
      id: true,
      _count: { select: { currentOnDevices: true } },
    },
  },
  _count: { select: { releases: true } },
} as const

type CompactReleaseRow = {
  id: string
  version: string
  logicalVersion: string
  catalogState: string
  policyEligibility: string
  isActive: boolean
}

function serializeReleaseReference(record: CompactReleaseRow | null): FirmwareTrainReleaseReference | null {
  if (!record) return null
  return {
    id: record.id,
    version: record.version,
    logicalVersion: record.logicalVersion,
    decision: releaseDecisionFromCatalogSemantics(record),
    isActive: record.isActive,
  }
}

function serializeTrain(record: {
  id: string
  vendorId: string
  vendor: { id: string; code: string; name: string; isActive: boolean }
  platform: string
  name: string
  state?: string
  preferredFirmwareReleaseId?: string | null
  minimumAcceptableFirmwareReleaseId?: string | null
  preferredRelease?: CompactReleaseRow | null
  minimumAcceptableRelease?: CompactReleaseRow | null
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
  releases?: Array<{ id: string; _count: { currentOnDevices: number } }>
  _count: { releases: number }
}): FirmwareTrainRecord {
  return {
    id: record.id,
    vendorId: record.vendorId,
    vendor: record.vendor,
    platform: record.platform,
    name: record.name,
    state: (record.state ?? 'ACCEPTED') as FirmwareTrainRecord['state'],
    preferredFirmwareReleaseId: record.preferredFirmwareReleaseId ?? null,
    minimumAcceptableFirmwareReleaseId: record.minimumAcceptableFirmwareReleaseId ?? null,
    preferredRelease: serializeReleaseReference(record.preferredRelease ?? null),
    minimumAcceptableRelease: serializeReleaseReference(record.minimumAcceptableRelease ?? null),
    notes: record.notes,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
    releaseCount: record._count.releases,
    deviceCount: (record.releases ?? []).reduce((total, release) => total + release._count.currentOnDevices, 0),
  }
}

async function assertVendor(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, code: true } })
  if (!vendor) throw new FirmwareTrainReferenceError('The selected vendor does not exist.')
  return vendor
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

async function demotePreferredPeers(input: {
  vendorId: string
  platform: string
  excludeId?: string
}) {
  const candidates = await prisma.firmwareTrain.findMany({
    where: { vendorId: input.vendorId, state: 'PREFERRED', isActive: true },
    select: { id: true, platform: true },
  })
  const platform = normalizedFirmwareTrainPlatform(input.platform)
  const ids = candidates
    .filter((candidate) => candidate.id !== input.excludeId)
    .filter((candidate) => normalizedFirmwareTrainPlatform(candidate.platform) === platform)
    .map((candidate) => candidate.id)
  if (ids.length === 0) return
  await prisma.firmwareTrain.updateMany({
    where: { id: { in: ids } },
    data: { state: 'ACCEPTED' },
  })
}

async function assertReleaseDefaults(input: {
  trainId: string
  vendorKey: string
  platform: string
  preferredFirmwareReleaseId: string | null
  minimumAcceptableFirmwareReleaseId: string | null
}) {
  const ids = [...new Set([
    input.preferredFirmwareReleaseId,
    input.minimumAcceptableFirmwareReleaseId,
  ].filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return

  const releases = await prisma.firmwareRelease.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      firmwareTrainId: true,
      vendorId: true,
      platform: true,
      version: true,
      catalogState: true,
      policyEligibility: true,
      isActive: true,
    },
  })
  if (releases.length !== ids.length) throw new FirmwareTrainReferenceError('One or more selected firmware releases no longer exist.')

  const byId = new Map(releases.map((release) => [release.id, release]))
  for (const release of releases) {
    if (
      release.firmwareTrainId !== input.trainId ||
      normalizedFirmwareTrainPlatform(release.platform) !== normalizedFirmwareTrainPlatform(input.platform)
    ) {
      throw new FirmwareTrainReferenceError('Preferred and minimum releases must belong to this train and platform.')
    }
    const decision: FirmwareReleaseDecision = releaseDecisionFromCatalogSemantics(release)
    if (!release.isActive || decision !== 'ALLOWED') {
      throw new FirmwareTrainReferenceError('Preferred and minimum releases must be active Allowed releases.')
    }
  }

  const minimum = input.minimumAcceptableFirmwareReleaseId ? byId.get(input.minimumAcceptableFirmwareReleaseId) : null
  const preferred = input.preferredFirmwareReleaseId ? byId.get(input.preferredFirmwareReleaseId) : null
  if (minimum && preferred) {
    const comparison = compareFirmwareVersions({
      vendorKey: input.vendorKey,
      platform: input.platform,
      leftVersion: minimum.version,
      rightVersion: preferred.version,
    })
    if (comparison.result === 'NOT_COMPARABLE') {
      throw new FirmwareTrainReferenceError(`Minimum and preferred releases cannot be ordered safely: ${comparison.reason}`)
    }
    if (comparison.result === 'GREATER') {
      throw new FirmwareTrainReferenceError('Minimum acceptable release cannot be newer than the preferred release.')
    }
  }
}

export async function listFirmwareTrains() {
  const records = await prisma.firmwareTrain.findMany({
    orderBy: [
      { isActive: 'desc' },
      { vendor: { name: 'asc' } },
      { platform: 'asc' },
      { state: 'asc' },
      { name: 'asc' },
    ],
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
        orderBy: [{ isActive: 'desc' }, { releasedAt: 'desc' }, { logicalVersion: 'asc' }, { version: 'asc' }],
        select: {
          id: true,
          version: true,
          logicalVersion: true,
          variant: true,
          imageCode: true,
          catalogState: true,
          policyEligibility: true,
          isActive: true,
          releasedAt: true,
          _count: { select: { currentOnDevices: true } },
        },
      },
    },
  })
  if (!record) throw new FirmwareTrainNotFoundError()
  const base = serializeTrain({
    ...record,
    releases: record.releases.map((release) => ({ id: release.id, _count: release._count })),
  })
  return {
    ...base,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    releases: record.releases.map((release) => ({
      id: release.id,
      version: release.version,
      logicalVersion: release.logicalVersion,
      variant: release.variant,
      imageCode: release.imageCode,
      catalogState: release.catalogState,
      policyEligibility: release.policyEligibility,
      decision: releaseDecisionFromCatalogSemantics(release),
      isActive: release.isActive,
      releasedAt: release.releasedAt?.toISOString() ?? null,
      deviceCount: release._count.currentOnDevices,
    })),
  }
}

export async function createFirmwareTrain(rawInput: unknown) {
  const input = parseFirmwareTrainInput(rawInput)
  if (/[,;]/.test(input.platform)) {
    throw new FirmwareTrainValidationError(
      'Please correct the highlighted fields.',
      { platform: 'A firmware train must belong to one platform. Models may support multiple platforms.' },
    )
  }
  const vendor = await assertVendor(input.vendorId)
  await assertUnique(input.vendorId, input.platform, input.name)
  if (input.preferredFirmwareReleaseId || input.minimumAcceptableFirmwareReleaseId) {
    throw new FirmwareTrainReferenceError('Create the train first, then assign its preferred and minimum releases.')
  }
  if (input.state === 'PREFERRED') {
    await demotePreferredPeers({ vendorId: input.vendorId, platform: input.platform })
  }
  const created = await prisma.firmwareTrain.create({ data: input, include: trainInclude })
  void vendor
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
    state: current.state,
    preferredFirmwareReleaseId: current.preferredFirmwareReleaseId,
    minimumAcceptableFirmwareReleaseId: current.minimumAcceptableFirmwareReleaseId,
    notes: current.notes,
    isActive: current.isActive,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    ...patch,
  })
  const vendor = await assertVendor(input.vendorId)
  await assertUnique(input.vendorId, input.platform, input.name, id)
  await assertReleaseDefaults({
    trainId: id,
    vendorKey: vendor.code,
    platform: input.platform,
    preferredFirmwareReleaseId: input.preferredFirmwareReleaseId,
    minimumAcceptableFirmwareReleaseId: input.minimumAcceptableFirmwareReleaseId,
  })

  if (input.state === 'PREFERRED' && input.isActive) {
    await demotePreferredPeers({
      vendorId: input.vendorId,
      platform: input.platform,
      excludeId: id,
    })
  }
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
