import { prisma } from '@/lib/prisma'
import { listAuditEventsForEntity } from '@/lib/audit-event-store'
import { normalizedDeviceModelName, parseDeviceModelInput, type DeviceModelFirmwareReference } from '@/lib/device-models'
import { getActiveModelDesiredPolicy } from '@/lib/firmware-policy-store'
import { isFirmwarePolicyEligible } from '@/lib/firmware-releases'
import {
  emptyTechnicalFirmwareStateCounts,
  incrementTechnicalFirmwareStateCount,
  resolveTechnicalFirmwareState,
} from '@/lib/firmware-state'

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

const referenceSelect = { id: true, code: true, name: true, isActive: true } as const
const familySelect = { id: true, vendorId: true, name: true, isActive: true } as const
const firmwareSelect = {
  id: true,
  vendorId: true,
  version: true,
  logicalVersion: true,
  variant: true,
  imageCode: true,
  platform: true,
  catalogState: true,
  policyEligibility: true,
  variantEquivalence: true,
  status: true,
  isActive: true,
  releasedAt: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

const deviceModelInclude = {
  vendor: { select: referenceSelect },
  deviceType: { select: referenceSelect },
  family: { select: familySelect },
  _count: { select: { devices: true } },
} as const

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

type IncludedDeviceModel = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId: string | null
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
  family: { id: string; vendorId: string; name: string; isActive: boolean } | null
  _count: { devices: number }
}

function serializeFirmware(release: {
  id: string
  vendorId: string
  version: string
  logicalVersion: string
  variant: string | null
  imageCode: string | null
  platform: string
  catalogState: string
  policyEligibility: string
  variantEquivalence: string
  status: string
  isActive: boolean
  releasedAt: Date | null
  firmwareTrain: { id: string; name: string } | null
}): DeviceModelFirmwareReference {
  return {
    ...release,
    catalogState: release.catalogState as DeviceModelFirmwareReference['catalogState'],
    policyEligibility: release.policyEligibility as DeviceModelFirmwareReference['policyEligibility'],
    variantEquivalence: release.variantEquivalence as DeviceModelFirmwareReference['variantEquivalence'],
    releasedAt: release.releasedAt?.toISOString() ?? null,
  }
}

function serializeDeviceModel(
  record: IncludedDeviceModel,
  desiredFirmwareRelease: DeviceModelFirmwareReference | null = null,
) {
  return {
    id: record.id,
    vendorId: record.vendorId,
    deviceTypeId: record.deviceTypeId,
    familyId: record.familyId,
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
    family: record.family,
    deviceCount: record._count.devices,
    desiredFirmwareRelease,
  }
}

async function assertReferences(vendorId: string, deviceTypeId: string, familyId: string | null) {
  const [vendor, deviceType, family] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }),
    prisma.deviceType.findUnique({ where: { id: deviceTypeId }, select: { id: true } }),
    familyId
      ? prisma.deviceModelFamily.findUnique({ where: { id: familyId }, select: { id: true, vendorId: true } })
      : Promise.resolve(null),
  ])

  if (!vendor) throw new DeviceModelReferenceError('The selected vendor does not exist.')
  if (!deviceType) throw new DeviceModelReferenceError('The selected device type does not exist.')
  if (familyId && !family) throw new DeviceModelReferenceError('The selected model family / series does not exist.')
  if (family && family.vendorId !== vendorId) {
    throw new DeviceModelReferenceError('The selected family / series must belong to the same vendor as the model.')
  }
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
  if (conflict) throw new DeviceModelConflictError(`Model “${model}” already exists for this vendor.`)
}

export async function listDeviceModels() {
  const records = await prisma.deviceModel.findMany({
    orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { model: 'asc' }],
    include: deviceModelInclude,
  })
  const modelIds = records.map((record) => record.id)
  const policies = modelIds.length
    ? await prisma.firmwarePolicy.findMany({
        where: {
          ...modelBaselineScope,
          deviceModelId: { in: modelIds },
          effectiveFrom: { lte: new Date() },
          isDefaultTrack: true,
        },
        orderBy: [{ effectiveFrom: 'desc' }, { policyVersion: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { deviceModelId: true, targetFirmwareRelease: { select: firmwareSelect } },
      })
    : []
  const desiredByModel = new Map<string, DeviceModelFirmwareReference>()
  for (const policy of policies) {
    if (!policy.deviceModelId || desiredByModel.has(policy.deviceModelId) || !policy.targetFirmwareRelease) continue
    desiredByModel.set(policy.deviceModelId, serializeFirmware(policy.targetFirmwareRelease))
  }
  return records.map((record) => serializeDeviceModel(record as IncludedDeviceModel, desiredByModel.get(record.id) ?? null))
}

export async function listDeviceModelReferences() {
  const [vendors, deviceTypes, families, firmwareReleases] = await Promise.all([
    prisma.vendor.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: referenceSelect }),
    prisma.deviceType.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: referenceSelect }),
    prisma.deviceModelFamily.findMany({
      orderBy: [{ isActive: 'desc' }, { vendor: { name: 'asc' } }, { name: 'asc' }],
      select: familySelect,
    }),
    prisma.firmwareRelease.findMany({
      where: {
        isActive: true,
        catalogState: { notIn: ['BLOCKED', 'WITHDRAWN'] },
        policyEligibility: { in: ['ALLOWED', 'PREFERRED'] },
      },
      orderBy: [{ vendor: { name: 'asc' } }, { platform: 'asc' }, { releasedAt: 'desc' }, { version: 'asc' }],
      select: firmwareSelect,
    }),
  ])
  return { vendors, deviceTypes, families, firmwareReleases: firmwareReleases.map(serializeFirmware) }
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
          currentFirmwareRelease: { select: { id: true, version: true, platform: true } },
          lifecycle: { select: { state: true } },
        },
      },
    },
  })
  if (!record) throw new DeviceModelNotFoundError()

  const [desiredPolicy, vendorReleases, auditHistory] = await Promise.all([
    getActiveModelDesiredPolicy(record.id),
    prisma.firmwareRelease.findMany({
      where: { vendorId: record.vendorId },
      orderBy: [{ isActive: 'desc' }, { releasedAt: 'desc' }, { version: 'asc' }],
      select: firmwareSelect,
    }),
    listAuditEventsForEntity('DeviceModel', id),
  ])

  // #43 allows cross-platform desired tracks. Do not treat the legacy single
  // DeviceModel.platform field as a compatibility gate; #57 will provide the
  // concrete model/image compatibility resolver.
  const availableReleases = vendorReleases

  const customerMap = new Map<string, { id: string; name: string; deviceCount: number }>()
  const firmwareMap = new Map<string, { firmwareReleaseId: string | null; version: string; platform: string | null; deviceCount: number }>()
  const workflowCounts = { planned: 0, ignored: 0, customerDeclined: 0, done: 0, undecided: 0 }
  const technicalStateCounts = emptyTechnicalFirmwareStateCounts()

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

    incrementTechnicalFirmwareStateCount(
      technicalStateCounts,
      resolveTechnicalFirmwareState({
        currentFirmwareReleaseId: device.currentFirmwareReleaseId,
        desiredFirmwareReleaseId: desiredPolicy?.release?.id,
      }),
    )

    switch (device.lifecycle?.state) {
      case 'PLANNED': workflowCounts.planned += 1; break
      case 'IGNORED': workflowCounts.ignored += 1; break
      case 'CUSTOMER_DECLINED': workflowCounts.customerDeclined += 1; break
      case 'DONE': workflowCounts.done += 1; break
      default: workflowCounts.undecided += 1
    }
  }

  const desiredRelease = desiredPolicy?.release ?? null
  return {
    ...serializeDeviceModel(record as IncludedDeviceModel, desiredRelease),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customers: [...customerMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    firmwareDistribution: [...firmwareMap.values()].sort((a, b) => b.deviceCount - a.deviceCount),
    workflowCounts,
    technicalStateCounts,
    desiredFirmware: {
      available: true as const,
      policyId: desiredPolicy?.id ?? null,
      policyMode: desiredPolicy?.policyMode ?? null,
      trackKey: desiredPolicy?.trackKey ?? null,
      desiredPlatform: desiredPolicy?.desiredPlatform ?? null,
      release: desiredRelease,
    },
    availableFirmware: {
      available: true as const,
      releases: availableReleases.map((release) => ({
        ...serializeFirmware(release),
        selectable: isFirmwarePolicyEligible(release),
      })),
    },
    auditHistory,
  }
}

export async function createDeviceModel(rawInput: unknown) {
  const input = parseDeviceModelInput(rawInput)
  await assertReferences(input.vendorId, input.deviceTypeId, input.familyId)
  await assertUniqueWithinVendor(input.vendorId, input.model)
  const record = await prisma.deviceModel.create({ data: input, include: deviceModelInclude })
  return serializeDeviceModel(record as IncludedDeviceModel)
}

export async function updateDeviceModel(id: string, rawInput: unknown) {
  const current = await prisma.deviceModel.findUnique({ where: { id } })
  if (!current) throw new DeviceModelNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseDeviceModelInput({
    vendorId: current.vendorId,
    deviceTypeId: current.deviceTypeId,
    familyId: current.familyId,
    model: current.model,
    platform: current.platform,
    notes: current.notes,
    isActive: current.isActive,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    ...patch,
  })

  await assertReferences(input.vendorId, input.deviceTypeId, input.familyId)
  await assertUniqueWithinVendor(input.vendorId, input.model, id)
  const record = await prisma.deviceModel.update({ where: { id }, data: input, include: deviceModelInclude })
  return serializeDeviceModel(record as IncludedDeviceModel)
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
