import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'

export const NORMAL_DESIRED_FIRMWARE_STATUSES = ['APPROVED', 'RECOMMENDED'] as const

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
  status: true,
  isActive: true,
  releasedAt: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

function normalizePlatform(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function cleanId(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : ''
}

function cleanModelIds(value: unknown) {
  if (!Array.isArray(value)) throw new FirmwarePolicyValidationError('Choose one or more device models.')
  const ids = [...new Set(value.map(cleanId).filter(Boolean))]
  if (ids.length === 0) throw new FirmwarePolicyValidationError('Choose one or more device models.')
  if (ids.length > 250) throw new FirmwarePolicyValidationError('Bulk desired-firmware actions are limited to 250 models at once.')
  return ids
}

function modelBaselineWhere(deviceModelId: string) {
  return {
    deviceModelId,
    isActive: true,
    customerId: null,
    contractTypeId: null,
    deviceId: null,
    vendorId: null,
    deviceTypeId: null,
  } as const
}

const modelBaselineScope = {
  isActive: true,
  customerId: null,
  contractTypeId: null,
  deviceId: null,
  vendorId: null,
  deviceTypeId: null,
} as const

function serializePolicy(record: {
  id: string
  targetFirmwareReleaseId: string
  isActive: boolean
  notes: string | null
  deviceModelId: string | null
  createdAt: Date
  updatedAt: Date
  targetFirmwareRelease: {
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    releasedAt: Date | null
    firmwareTrain: { id: string; name: string } | null
  }
}) {
  return {
    id: record.id,
    targetFirmwareReleaseId: record.targetFirmwareReleaseId,
    isActive: record.isActive,
    notes: record.notes,
    deviceModelId: record.deviceModelId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    release: {
      ...record.targetFirmwareRelease,
      releasedAt: record.targetFirmwareRelease.releasedAt?.toISOString() ?? null,
    },
  }
}

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
  const policies = await prisma.firmwarePolicy.findMany({
    where: { ...modelBaselineScope, deviceModelId: { in: modelIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { targetFirmwareRelease: { select: targetFirmwareSelect } },
  })
  const byModel = new Map<string, (typeof policies)[number]>()
  for (const policy of policies) {
    if (policy.deviceModelId && !byModel.has(policy.deviceModelId)) byModel.set(policy.deviceModelId, policy)
  }
  return byModel
}

function assertReleaseCompatibleWithModels(
  models: Array<{ id: string; vendorId: string; platform: string | null; model: string }>,
  release: {
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
  },
) {
  if (!release.isActive) {
    throw new FirmwarePolicyCompatibilityError('Archived firmware cannot be selected as a new desired target.')
  }
  const normalizedStatus = release.status.toUpperCase()
  if (!NORMAL_DESIRED_FIRMWARE_STATUSES.includes(normalizedStatus as (typeof NORMAL_DESIRED_FIRMWARE_STATUSES)[number])) {
    throw new FirmwarePolicyCompatibilityError('Choose firmware with APPROVED or RECOMMENDED status as the desired target.')
  }

  const wrongVendor = models.find((model) => model.vendorId !== release.vendorId)
  if (wrongVendor) {
    throw new FirmwarePolicyCompatibilityError(
      models.length === 1
        ? 'Desired firmware must belong to the same vendor as the device model.'
        : 'All selected models must use the same vendor as the desired firmware release.',
    )
  }

  const releasePlatform = normalizePlatform(release.platform)
  const incompatible = models.filter(
    (model) => model.platform && normalizePlatform(model.platform) !== releasePlatform,
  )
  if (incompatible.length > 0) {
    throw new FirmwarePolicyCompatibilityError(
      incompatible.length === 1
        ? `Desired firmware is not compatible with selected model ${incompatible[0].model}.`
        : `Desired firmware is not compatible with ${incompatible.length} selected models.`,
    )
  }
}

export async function getActiveModelDesiredPolicy(deviceModelId: string) {
  const record = await prisma.firmwarePolicy.findFirst({
    where: modelBaselineWhere(deviceModelId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { targetFirmwareRelease: { select: targetFirmwareSelect } },
  })

  return record ? serializePolicy(record) : null
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
  const changedModels = models.filter(
    (model) => currentByModel.get(model.id)?.targetFirmwareReleaseId !== firmwareReleaseId,
  )

  if (changedModels.length === 0) {
    return { changed: 0, unchanged: modelIds.length, modelIds }
  }

  await prisma.$transaction(async (tx) => {
    for (const model of changedModels) {
      const current = currentByModel.get(model.id)
      await tx.firmwarePolicy.updateMany({
        where: modelBaselineWhere(model.id),
        data: { isActive: false },
      })
      const next = await tx.firmwarePolicy.create({
        data: {
          deviceModelId: model.id,
          targetFirmwareReleaseId: firmwareReleaseId,
          isActive: true,
        },
        select: { id: true, targetFirmwareReleaseId: true },
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
            version: current?.targetFirmwareRelease.version ?? null,
            status: current?.targetFirmwareRelease.status ?? null,
          },
          after: {
            policyId: next.id,
            firmwareReleaseId: next.targetFirmwareReleaseId,
            version: release.version,
            status: release.status,
          },
          metadata: {
            platform: model.platform ?? release.platform,
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
            version: current.targetFirmwareRelease.version,
            status: current.targetFirmwareRelease.status,
          },
          after: {
            policyId: null,
            firmwareReleaseId: null,
            version: null,
            status: null,
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
