import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'
import { isFirmwarePolicyEligible } from '@/lib/firmware-releases'
import { compareFirmwareVersions } from '@/lib/firmware-versioning'
import {
  FIRMWARE_POLICY_MODES,
  FIRMWARE_POLICY_TRACK_CLASSES,
  resolveFirmwarePolicyTimeline,
  validateFirmwarePolicyCandidate,
  type FirmwarePolicyCandidate,
  type FirmwarePolicyDeviceContext,
  type FirmwarePolicyMode,
  type FirmwarePolicyTrackClass,
} from '@/lib/firmware-policies'

// Retained temporarily for callers/tests that still refer to the Issue #9
// legacy status vocabulary. New selection logic uses policyEligibility.
export const NORMAL_DESIRED_FIRMWARE_STATUSES = ['APPROVED', 'RECOMMENDED'] as const
export const NORMAL_FIRMWARE_POLICY_ELIGIBILITIES = ['ALLOWED', 'PREFERRED'] as const

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
  logicalVersion: true,
  variant: true,
  imageCode: true,
  catalogState: true,
  policyEligibility: true,
  variantEquivalence: true,
  status: true,
  isActive: true,
  releasedAt: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

const policyCandidateSelect = {
  id: true,
  isActive: true,
  policyMode: true,
  trackKey: true,
  trackName: true,
  trackClass: true,
  isDefaultTrack: true,
  desiredPlatform: true,
  minimumFirmwareReleaseId: true,
  targetFirmwareReleaseId: true,
  maximumFirmwareReleaseId: true,
  firmwareTrainId: true,
  minimumInclusive: true,
  maximumInclusive: true,
  effectiveFrom: true,
  policyVersion: true,
  deviceModelFamilyId: true,
  deviceModelId: true,
  customerId: true,
  siteId: true,
  deviceId: true,
  contractTypeId: true,
  vendorId: true,
  deviceTypeId: true,
} as const

type PolicyCandidateRow = {
  id: string
  isActive: boolean
  policyMode: string
  trackKey: string
  trackName: string
  trackClass: string
  isDefaultTrack: boolean
  desiredPlatform: string | null
  minimumFirmwareReleaseId: string | null
  targetFirmwareReleaseId: string | null
  maximumFirmwareReleaseId: string | null
  firmwareTrainId: string | null
  minimumInclusive: boolean
  maximumInclusive: boolean
  effectiveFrom: Date
  policyVersion: number
  deviceModelFamilyId: string | null
  deviceModelId: string | null
  customerId: string | null
  siteId: string | null
  deviceId: string | null
  contractTypeId: string | null
  vendorId: string | null
  deviceTypeId: string | null
}

type PolicyRelease = {
  id: string
  vendorId: string
  platform: string
  version: string
  logicalVersion: string
  variant: string | null
  imageCode: string | null
  catalogState: string
  policyEligibility: string
  variantEquivalence: string
  status: string
  isActive: boolean
  releasedAt: Date | null
  firmwareTrain: { id: string; name: string } | null
}

type IncludedPolicy = PolicyCandidateRow & {
  notes: string | null
  createdAt: Date
  updatedAt: Date
  minimumFirmwareRelease: PolicyRelease | null
  targetFirmwareRelease: PolicyRelease | null
  maximumFirmwareRelease: PolicyRelease | null
  firmwareTrain: { id: string; vendorId: string; platform: string; name: string; isActive: boolean } | null
}

const policyInclude = {
  minimumFirmwareRelease: { select: targetFirmwareSelect },
  targetFirmwareRelease: { select: targetFirmwareSelect },
  maximumFirmwareRelease: { select: targetFirmwareSelect },
  firmwareTrain: { select: { id: true, vendorId: true, platform: true, name: true, isActive: true } },
} as const

function normalizePlatform(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function cleanId(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function optionalId(value: unknown) {
  const id = cleanId(value)
  return id || null
}

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : fallback
}

function cleanModelIds(value: unknown) {
  if (!Array.isArray(value)) throw new FirmwarePolicyValidationError('Choose one or more device models.')
  const ids = [...new Set(value.map(cleanId).filter(Boolean))]
  if (ids.length === 0) throw new FirmwarePolicyValidationError('Choose one or more device models.')
  if (ids.length > 250) throw new FirmwarePolicyValidationError('Bulk desired-firmware actions are limited to 250 models at once.')
  return ids
}

function candidateFromRow(row: PolicyCandidateRow): FirmwarePolicyCandidate {
  return {
    ...row,
    policyMode: row.policyMode as FirmwarePolicyMode,
    trackClass: row.trackClass as FirmwarePolicyTrackClass,
  }
}

function serializedRelease(release: PolicyRelease | null) {
  return release
    ? {
        ...release,
        releasedAt: release.releasedAt?.toISOString() ?? null,
      }
    : null
}

function serializePolicy(record: IncludedPolicy) {
  return {
    id: record.id,
    policyMode: record.policyMode as FirmwarePolicyMode,
    trackKey: record.trackKey,
    trackName: record.trackName,
    trackClass: record.trackClass as FirmwarePolicyTrackClass,
    isDefaultTrack: record.isDefaultTrack,
    desiredPlatform: record.desiredPlatform,
    minimumFirmwareReleaseId: record.minimumFirmwareReleaseId,
    targetFirmwareReleaseId: record.targetFirmwareReleaseId,
    maximumFirmwareReleaseId: record.maximumFirmwareReleaseId,
    firmwareTrainId: record.firmwareTrainId,
    minimumInclusive: record.minimumInclusive,
    maximumInclusive: record.maximumInclusive,
    effectiveFrom: record.effectiveFrom.toISOString(),
    policyVersion: record.policyVersion,
    isActive: record.isActive,
    notes: record.notes,
    deviceModelFamilyId: record.deviceModelFamilyId,
    deviceModelId: record.deviceModelId,
    customerId: record.customerId,
    siteId: record.siteId,
    deviceId: record.deviceId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    minimumRelease: serializedRelease(record.minimumFirmwareRelease),
    release: serializedRelease(record.targetFirmwareRelease),
    maximumRelease: serializedRelease(record.maximumFirmwareRelease),
    firmwareTrain: record.firmwareTrain,
  }
}

function modelBaselineWhere(deviceModelId: string) {
  return {
    deviceModelId,
    deviceModelFamilyId: null,
    isActive: true,
    customerId: null,
    siteId: null,
    contractTypeId: null,
    deviceId: null,
    vendorId: null,
    deviceTypeId: null,
  } as const
}

const modelBaselineScope = {
  isActive: true,
  deviceModelFamilyId: null,
  customerId: null,
  siteId: null,
  contractTypeId: null,
  deviceId: null,
  vendorId: null,
  deviceTypeId: null,
} as const

async function loadModels(modelIds: string[]) {
  const models = await prisma.deviceModel.findMany({
    where: { id: { in: modelIds } },
    select: { id: true, vendorId: true, platform: true, model: true },
  })
  if (models.length !== modelIds.length) {
    const found = new Set(models.map((model) => model.id))
    const missing = modelIds.filter((id) => !found.has(id))
    throw new FirmwarePolicyNotFoundError(
      missing.length === 1 ? 'Device model was not found.' : `${missing.length} selected device models were not found.`,
    )
  }
  const byId = new Map(models.map((model) => [model.id, model]))
  return modelIds.map((id) => byId.get(id)!)
}

async function loadCurrentPolicies(modelIds: string[]) {
  const now = new Date()
  const policies = await prisma.firmwarePolicy.findMany({
    where: { ...modelBaselineScope, deviceModelId: { in: modelIds }, effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { policyVersion: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: policyInclude,
  })
  const byModel = new Map<string, (typeof policies)[number]>()
  for (const policy of policies) {
    if (policy.deviceModelId && !byModel.has(policy.deviceModelId) && policy.isDefaultTrack) byModel.set(policy.deviceModelId, policy)
  }
  return byModel
}

function assertReleaseEligible(release: {
  isActive: boolean
  catalogState: string
  policyEligibility: string
}) {
  if (isFirmwarePolicyEligible(release)) return
  if (!release.isActive) throw new FirmwarePolicyCompatibilityError('Archived firmware cannot be selected by a new firmware policy.')
  if (release.catalogState === 'BLOCKED' || release.catalogState === 'WITHDRAWN') {
    throw new FirmwarePolicyCompatibilityError('Blocked or withdrawn firmware cannot be selected by a firmware policy.')
  }
  throw new FirmwarePolicyCompatibilityError('Choose firmware whose policy eligibility is ALLOWED or PREFERRED.')
}

function assertReleaseCompatibleWithModels(
  models: Array<{ id: string; vendorId: string; platform: string | null; model: string }>,
  release: {
    id: string
    vendorId: string
    platform: string
    version: string
    catalogState: string
    policyEligibility: string
    isActive: boolean
  },
) {
  assertReleaseEligible(release)
  const wrongVendor = models.find((model) => model.vendorId !== release.vendorId)
  if (wrongVendor) {
    throw new FirmwarePolicyCompatibilityError(
      models.length === 1
        ? 'Desired firmware must belong to the same vendor as the device model.'
        : 'All selected models must use the same vendor as the desired firmware release.',
    )
  }
  // Do not compare against DeviceModel.platform here. #43 explicitly allows a
  // desired track to move hardware from e.g. AOS-8 to AOS-10. Exact model/image
  // compatibility is owned by #57.
}

export async function getActiveModelDesiredPolicy(deviceModelId: string) {
  const record = await prisma.firmwarePolicy.findFirst({
    where: { ...modelBaselineWhere(deviceModelId), effectiveFrom: { lte: new Date() }, isDefaultTrack: true },
    orderBy: [{ effectiveFrom: 'desc' }, { policyVersion: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: policyInclude,
  })

  return record ? serializePolicy(record as IncludedPolicy) : null
}

export async function bulkSetModelDesiredFirmwarePolicies(
  modelIdsValue: unknown,
  firmwareReleaseIdValue: unknown,
  actorUserId: string | null = null,
) {
  const modelIds = cleanModelIds(modelIdsValue)
  const firmwareReleaseId = cleanId(firmwareReleaseIdValue)
  if (!firmwareReleaseId) throw new FirmwarePolicyValidationError('Desired firmware release is required.')

  const [models, release] = await Promise.all([
    loadModels(modelIds),
    prisma.firmwareRelease.findUnique({ where: { id: firmwareReleaseId }, select: targetFirmwareSelect }),
  ])
  if (!release) throw new FirmwarePolicyReferenceError('The selected firmware release does not exist.')
  assertReleaseCompatibleWithModels(models, release)

  const currentByModel = await loadCurrentPolicies(modelIds)
  const changedModels = models.filter((model) => {
    const current = currentByModel.get(model.id)
    return !current || current.policyMode !== 'EXACT' || current.targetFirmwareReleaseId !== firmwareReleaseId
  })

  if (changedModels.length === 0) {
    return { changed: 0, unchanged: modelIds.length, modelIds }
  }

  await prisma.$transaction(async (tx) => {
    for (const model of changedModels) {
      const current = currentByModel.get(model.id)
      const next = await tx.firmwarePolicy.create({
        data: {
          deviceModelId: model.id,
          policyMode: 'EXACT',
          trackKey: 'default',
          trackName: 'Default',
          trackClass: 'PREFERRED',
          isDefaultTrack: true,
          desiredPlatform: release.platform,
          targetFirmwareReleaseId: firmwareReleaseId,
          effectiveFrom: new Date(),
          policyVersion: (current?.policyVersion ?? 0) + 1,
          isActive: true,
        },
        select: { id: true, targetFirmwareReleaseId: true, policyVersion: true },
      })
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: AUDIT_ACTIONS.desiredFirmwareChanged,
          entityType: 'DeviceModel',
          entityId: model.id,
          before: {
            policyId: current?.id ?? null,
            firmwareReleaseId: current?.targetFirmwareReleaseId ?? null,
            version: current?.targetFirmwareRelease?.version ?? null,
            status: current?.targetFirmwareRelease?.status ?? null,
            catalogState: current?.targetFirmwareRelease?.catalogState ?? null,
            policyEligibility: current?.targetFirmwareRelease?.policyEligibility ?? null,
          },
          after: {
            policyId: next.id,
            firmwareReleaseId: next.targetFirmwareReleaseId,
            version: release.version,
            status: release.status,
            catalogState: release.catalogState,
            policyEligibility: release.policyEligibility,
          },
          metadata: {
            platform: release.platform,
            policyMode: 'EXACT',
            policyVersion: next.policyVersion,
            bulk: modelIds.length > 1,
          },
        },
      })
    }
  })

  return {
    changed: changedModels.length,
    unchanged: modelIds.length - changedModels.length,
    modelIds,
  }
}

export async function bulkClearModelDesiredFirmwarePolicies(
  modelIdsValue: unknown,
  actorUserId: string | null = null,
) {
  const modelIds = cleanModelIds(modelIdsValue)
  await loadModels(modelIds)
  const currentByModel = await loadCurrentPolicies(modelIds)
  const changedIds = modelIds.filter((id) => currentByModel.has(id))

  if (changedIds.length === 0) {
    return { changed: 0, unchanged: modelIds.length, modelIds }
  }

  await prisma.$transaction(async (tx) => {
    for (const modelId of changedIds) {
      const current = currentByModel.get(modelId)!
      await tx.firmwarePolicy.updateMany({
        where: modelBaselineWhere(modelId),
        data: { isActive: false },
      })
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: AUDIT_ACTIONS.desiredFirmwareCleared,
          entityType: 'DeviceModel',
          entityId: modelId,
          before: {
            policyId: current.id,
            firmwareReleaseId: current.targetFirmwareReleaseId,
            version: current.targetFirmwareRelease?.version ?? null,
            status: current.targetFirmwareRelease?.status ?? null,
            catalogState: current.targetFirmwareRelease?.catalogState ?? null,
            policyEligibility: current.targetFirmwareRelease?.policyEligibility ?? null,
          },
          after: {
            policyId: null,
            firmwareReleaseId: null,
            version: null,
            status: null,
            catalogState: null,
            policyEligibility: null,
          },
          metadata: { bulk: modelIds.length > 1 },
        },
      })
    }
  })

  return {
    changed: changedIds.length,
    unchanged: modelIds.length - changedIds.length,
    modelIds,
  }
}

export async function setModelDesiredFirmwarePolicy(
  deviceModelIdValue: unknown,
  firmwareReleaseIdValue: unknown,
  actorUserId: string | null = null,
) {
  const deviceModelId = cleanId(deviceModelIdValue)
  if (!deviceModelId) throw new FirmwarePolicyValidationError('Device model is required.')
  await bulkSetModelDesiredFirmwarePolicies([deviceModelId], firmwareReleaseIdValue, actorUserId)
  const policy = await getActiveModelDesiredPolicy(deviceModelId)
  if (!policy) throw new FirmwarePolicyNotFoundError('Desired-firmware policy was not found after saving.')
  return policy
}

export async function clearModelDesiredFirmwarePolicy(
  deviceModelIdValue: unknown,
  actorUserId: string | null = null,
) {
  const deviceModelId = cleanId(deviceModelIdValue)
  if (!deviceModelId) throw new FirmwarePolicyValidationError('Device model is required.')
  const result = await bulkClearModelDesiredFirmwarePolicies([deviceModelId], actorUserId)
  return { cleared: result.changed > 0 }
}

export type FirmwarePolicyWriteInput = {
  policyMode?: unknown
  trackKey?: unknown
  trackName?: unknown
  trackClass?: unknown
  isDefaultTrack?: unknown
  desiredPlatform?: unknown
  minimumFirmwareReleaseId?: unknown
  targetFirmwareReleaseId?: unknown
  maximumFirmwareReleaseId?: unknown
  firmwareTrainId?: unknown
  minimumInclusive?: unknown
  maximumInclusive?: unknown
  effectiveFrom?: unknown
  notes?: unknown
  deviceModelFamilyId?: unknown
  deviceModelId?: unknown
  customerId?: unknown
  siteId?: unknown
  deviceId?: unknown
}

function parsePolicyWriteInput(raw: FirmwarePolicyWriteInput): Omit<FirmwarePolicyCandidate, 'id'> & { notes: string | null } {
  const policyModeRaw = cleanString(raw.policyMode, 'EXACT')
  const trackClassRaw = cleanString(raw.trackClass, 'PREFERRED')
  if (!FIRMWARE_POLICY_MODES.includes(policyModeRaw as FirmwarePolicyMode)) {
    throw new FirmwarePolicyValidationError('Unsupported firmware policy mode.')
  }
  if (!FIRMWARE_POLICY_TRACK_CLASSES.includes(trackClassRaw as FirmwarePolicyTrackClass)) {
    throw new FirmwarePolicyValidationError('Unsupported firmware policy track classification.')
  }

  const effectiveFrom = raw.effectiveFrom instanceof Date
    ? raw.effectiveFrom
    : typeof raw.effectiveFrom === 'string' && raw.effectiveFrom.trim()
      ? new Date(raw.effectiveFrom)
      : new Date()
  if (Number.isNaN(effectiveFrom.getTime())) throw new FirmwarePolicyValidationError('Effective-from date is invalid.')

  const candidate: Omit<FirmwarePolicyCandidate, 'id'> & { notes: string | null } = {
    isActive: true,
    policyMode: policyModeRaw as FirmwarePolicyMode,
    trackKey: cleanString(raw.trackKey, 'default'),
    trackName: cleanString(raw.trackName, 'Default'),
    trackClass: trackClassRaw as FirmwarePolicyTrackClass,
    isDefaultTrack: raw.isDefaultTrack === undefined ? true : raw.isDefaultTrack === true,
    desiredPlatform: cleanString(raw.desiredPlatform) || null,
    minimumFirmwareReleaseId: optionalId(raw.minimumFirmwareReleaseId),
    targetFirmwareReleaseId: optionalId(raw.targetFirmwareReleaseId),
    maximumFirmwareReleaseId: optionalId(raw.maximumFirmwareReleaseId),
    firmwareTrainId: optionalId(raw.firmwareTrainId),
    minimumInclusive: raw.minimumInclusive === undefined ? true : raw.minimumInclusive === true,
    maximumInclusive: raw.maximumInclusive === undefined ? true : raw.maximumInclusive === true,
    effectiveFrom,
    policyVersion: 1,
    deviceModelFamilyId: optionalId(raw.deviceModelFamilyId),
    deviceModelId: optionalId(raw.deviceModelId),
    customerId: optionalId(raw.customerId),
    siteId: optionalId(raw.siteId),
    deviceId: optionalId(raw.deviceId),
    contractTypeId: null,
    vendorId: null,
    deviceTypeId: null,
    notes: cleanString(raw.notes) || null,
  }
  const errors = validateFirmwarePolicyCandidate({ id: '__new__', ...candidate })
  if (errors.length > 0) throw new FirmwarePolicyValidationError(errors[0])
  return candidate
}

async function assertPolicyReferences(input: ReturnType<typeof parsePolicyWriteInput>) {
  const [family, model, customer, site, device, train] = await Promise.all([
    input.deviceModelFamilyId
      ? prisma.deviceModelFamily.findUnique({ where: { id: input.deviceModelFamilyId }, select: { id: true, vendorId: true } })
      : Promise.resolve(null),
    input.deviceModelId
      ? prisma.deviceModel.findUnique({ where: { id: input.deviceModelId }, select: { id: true, vendorId: true, familyId: true } })
      : Promise.resolve(null),
    input.customerId
      ? prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } })
      : Promise.resolve(null),
    input.siteId
      ? prisma.site.findUnique({ where: { id: input.siteId }, select: { id: true, customerId: true } })
      : Promise.resolve(null),
    input.deviceId
      ? prisma.device.findUnique({
          where: { id: input.deviceId },
          select: {
            id: true,
            customerId: true,
            siteId: true,
            deviceModel: { select: { id: true, vendorId: true, familyId: true } },
          },
        })
      : Promise.resolve(null),
    input.firmwareTrainId
      ? prisma.firmwareTrain.findUnique({
          where: { id: input.firmwareTrainId },
          select: { id: true, vendorId: true, platform: true, isActive: true },
        })
      : Promise.resolve(null),
  ])

  if (input.deviceModelFamilyId && !family) throw new FirmwarePolicyReferenceError('The selected device model family does not exist.')
  if (input.deviceModelId && !model) throw new FirmwarePolicyReferenceError('The selected device model does not exist.')
  if (input.customerId && !customer) throw new FirmwarePolicyReferenceError('The selected customer does not exist.')
  if (input.siteId && !site) throw new FirmwarePolicyReferenceError('The selected site does not exist.')
  if (input.deviceId && !device) throw new FirmwarePolicyReferenceError('The selected device does not exist.')
  if (input.firmwareTrainId && !train) throw new FirmwarePolicyReferenceError('The selected firmware train does not exist.')

  const subjectVendorId = family?.vendorId ?? model?.vendorId ?? device?.deviceModel.vendorId ?? null
  if (!subjectVendorId) throw new FirmwarePolicyReferenceError('Unable to determine the vendor for the policy subject.')
  const policyVendorId = subjectVendorId

  const releaseIds = [...new Set([
    input.minimumFirmwareReleaseId,
    input.targetFirmwareReleaseId,
    input.maximumFirmwareReleaseId,
  ].filter((id): id is string => Boolean(id)))]
  const releases = releaseIds.length
    ? await prisma.firmwareRelease.findMany({
        where: { id: { in: releaseIds } },
        select: targetFirmwareSelect,
      })
    : []
  if (releases.length !== releaseIds.length) throw new FirmwarePolicyReferenceError('One or more selected firmware releases do not exist.')

  for (const release of releases) {
    assertReleaseEligible(release)
    if (release.vendorId !== policyVendorId) {
      throw new FirmwarePolicyCompatibilityError('Firmware policy releases must belong to the same vendor as the policy subject.')
    }
    if (normalizePlatform(release.platform) !== normalizePlatform(input.desiredPlatform)) {
      throw new FirmwarePolicyCompatibilityError('Firmware policy releases must match the policy’s declared desired platform.')
    }
  }

  if (train) {
    if (!train.isActive) throw new FirmwarePolicyCompatibilityError('Archived firmware trains cannot be selected by a new policy.')
    if (train.vendorId !== policyVendorId) throw new FirmwarePolicyCompatibilityError('Firmware train must belong to the same vendor as the policy subject.')
    if (normalizePlatform(train.platform) !== normalizePlatform(input.desiredPlatform)) {
      throw new FirmwarePolicyCompatibilityError('Firmware train must match the policy’s declared desired platform.')
    }
  }

  const releaseById = new Map(releases.map((release) => [release.id, release]))
  const minimum = input.minimumFirmwareReleaseId ? releaseById.get(input.minimumFirmwareReleaseId) ?? null : null
  const preferred = input.targetFirmwareReleaseId ? releaseById.get(input.targetFirmwareReleaseId) ?? null : null
  const maximum = input.maximumFirmwareReleaseId ? releaseById.get(input.maximumFirmwareReleaseId) ?? null : null

  function assertOrdered(left: PolicyRelease | null, right: PolicyRelease | null, message: string) {
    if (!left || !right) return
    const comparison = compareFirmwareVersions({
      vendorKey: policyVendorId,
      platform: input.desiredPlatform ?? '',
      leftVersion: left.version,
      rightVersion: right.version,
    })
    if (comparison.result === 'NOT_COMPARABLE') throw new FirmwarePolicyCompatibilityError(`${message} Versions are not safely comparable.`)
    if (comparison.result === 'GREATER') throw new FirmwarePolicyCompatibilityError(message)
  }

  assertOrdered(minimum, preferred, 'Minimum firmware cannot be newer than the preferred target.')
  assertOrdered(preferred, maximum, 'Preferred firmware cannot be newer than the maximum accepted release.')
  assertOrdered(minimum, maximum, 'Minimum firmware cannot be newer than the maximum accepted release.')

  return {
    customerIdForAudit: input.customerId ?? site?.customerId ?? device?.customerId ?? null,
  }
}

function policyVersionScope(input: ReturnType<typeof parsePolicyWriteInput>) {
  return {
    deviceModelFamilyId: input.deviceModelFamilyId,
    deviceModelId: input.deviceModelId,
    customerId: input.customerId,
    siteId: input.siteId,
    deviceId: input.deviceId,
    contractTypeId: null,
    vendorId: null,
    deviceTypeId: null,
    trackKey: input.trackKey,
  } as const
}

export async function appendFirmwarePolicyVersion(
  rawInput: FirmwarePolicyWriteInput,
  actorUserId: string | null = null,
) {
  const input = parsePolicyWriteInput(rawInput)
  const references = await assertPolicyReferences(input)
  const previous = await prisma.firmwarePolicy.findFirst({
    where: policyVersionScope(input),
    orderBy: [{ policyVersion: 'desc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: policyInclude,
  })
  const policyVersion = (previous?.policyVersion ?? 0) + 1

  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.firmwarePolicy.create({
      data: {
        policyMode: input.policyMode,
        trackKey: input.trackKey,
        trackName: input.trackName,
        trackClass: input.trackClass,
        isDefaultTrack: input.isDefaultTrack,
        desiredPlatform: input.desiredPlatform,
        minimumFirmwareReleaseId: input.minimumFirmwareReleaseId,
        targetFirmwareReleaseId: input.targetFirmwareReleaseId,
        maximumFirmwareReleaseId: input.maximumFirmwareReleaseId,
        firmwareTrainId: input.firmwareTrainId,
        minimumInclusive: input.minimumInclusive,
        maximumInclusive: input.maximumInclusive,
        effectiveFrom: input.effectiveFrom,
        policyVersion,
        isActive: true,
        notes: input.notes,
        deviceModelFamilyId: input.deviceModelFamilyId,
        deviceModelId: input.deviceModelId,
        customerId: input.customerId,
        siteId: input.siteId,
        deviceId: input.deviceId,
      },
      include: policyInclude,
    })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        customerId: references.customerIdForAudit,
        action: AUDIT_ACTIONS.desiredFirmwareChanged,
        entityType: 'FirmwarePolicy',
        entityId: next.id,
        before: previous
          ? {
              policyId: previous.id,
              policyVersion: previous.policyVersion,
              policyMode: previous.policyMode,
              trackKey: previous.trackKey,
              firmwareReleaseId: previous.targetFirmwareReleaseId,
              effectiveFrom: previous.effectiveFrom.toISOString(),
            }
          : undefined,
        after: {
          policyId: next.id,
          policyVersion: next.policyVersion,
          policyMode: next.policyMode,
          trackKey: next.trackKey,
          firmwareReleaseId: next.targetFirmwareReleaseId,
          effectiveFrom: next.effectiveFrom.toISOString(),
        },
        metadata: {
          desiredPlatform: next.desiredPlatform,
          trackClass: next.trackClass,
          isDefaultTrack: next.isDefaultTrack,
        },
      },
    })
    return next
  })

  return serializePolicy(created as IncludedPolicy)
}

export async function resolveEffectiveFirmwarePolicyForDevice(deviceIdValue: unknown, at: Date = new Date()) {
  const deviceId = cleanId(deviceIdValue)
  if (!deviceId) throw new FirmwarePolicyValidationError('Device is required.')

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      customerId: true,
      siteId: true,
      deviceModelId: true,
      deviceModel: { select: { familyId: true } },
    },
  })
  if (!device) throw new FirmwarePolicyNotFoundError('Device was not found.')

  const context: FirmwarePolicyDeviceContext = {
    deviceId: device.id,
    customerId: device.customerId,
    siteId: device.siteId,
    deviceModelId: device.deviceModelId,
    deviceModelFamilyId: device.deviceModel.familyId,
  }

  const scopeTerms = [
    { deviceId: device.id },
    ...(device.siteId ? [{ siteId: device.siteId }] : []),
    { customerId: device.customerId },
    { deviceModelId: device.deviceModelId },
    ...(device.deviceModel.familyId ? [{ deviceModelFamilyId: device.deviceModel.familyId }] : []),
  ]

  const rows = await prisma.firmwarePolicy.findMany({
    where: { isActive: true, OR: scopeTerms },
    select: policyCandidateSelect,
  })
  return resolveFirmwarePolicyTimeline(rows.map((row) => candidateFromRow(row as PolicyCandidateRow)), context, at)
}
