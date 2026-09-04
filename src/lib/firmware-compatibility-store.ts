import { prisma } from '@/lib/prisma'
import { AUDIT_ACTIONS } from '@/lib/audit-events'
import {
  evaluateFirmwareCompatibility,
  FIRMWARE_COMPATIBILITY_DECISIONS,
  FIRMWARE_COMPATIBILITY_SOURCE_TYPES,
  resolveCompatibleFirmwareImage,
  type FirmwareCompatibilityDecision,
  type FirmwareCompatibilityModel,
  type FirmwareCompatibilityOverride,
  type FirmwareCompatibilityRelease,
  type FirmwareCompatibilityRule,
  type FirmwareCompatibilitySourceType,
} from '@/lib/firmware-compatibility'

export class FirmwareCompatibilityValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareCompatibilityValidationError'
  }
}

export class FirmwareCompatibilityReferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareCompatibilityReferenceError'
  }
}

export class FirmwareCompatibilityNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareCompatibilityNotFoundError'
  }
}

export type FirmwareCompatibilityRuleWriteInput = {
  vendorId?: unknown
  deviceModelFamilyId?: unknown
  deviceModelId?: unknown
  platform?: unknown
  firmwareTrainId?: unknown
  logicalVersion?: unknown
  firmwareReleaseId?: unknown
  imageCode?: unknown
  decision?: unknown
  sourceType?: unknown
  explanation?: unknown
  notes?: unknown
  isActive?: unknown
  validFrom?: unknown
  validUntil?: unknown
}

export type FirmwareCompatibilityOverrideWriteInput = {
  deviceModelId?: unknown
  firmwareReleaseId?: unknown
  decision?: unknown
  reason?: unknown
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function optionalString(value: unknown) {
  const cleaned = cleanString(value)
  return cleaned || null
}

function parseDate(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(Number.NaN)
  if (Number.isNaN(date.getTime())) throw new FirmwareCompatibilityValidationError(`${fieldName} is invalid.`)
  return date
}

function parseDecision(value: unknown, fallback: FirmwareCompatibilityDecision = 'ALLOW') {
  const cleaned = cleanString(value || fallback).toUpperCase()
  if (!FIRMWARE_COMPATIBILITY_DECISIONS.includes(cleaned as FirmwareCompatibilityDecision)) {
    throw new FirmwareCompatibilityValidationError('Compatibility decision must be ALLOW or DENY.')
  }
  return cleaned as FirmwareCompatibilityDecision
}

function parseSourceType(value: unknown) {
  const cleaned = cleanString(value || 'CATALOG').toUpperCase()
  if (!FIRMWARE_COMPATIBILITY_SOURCE_TYPES.includes(cleaned as FirmwareCompatibilitySourceType)) {
    throw new FirmwareCompatibilityValidationError('Compatibility source type must be CATALOG or CONFIGURED_RULE.')
  }
  return cleaned as FirmwareCompatibilitySourceType
}

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function asModel(row: { id: string; vendorId: string; familyId: string | null; model?: string }): FirmwareCompatibilityModel {
  return row
}

function asRelease(row: {
  id: string
  vendorId: string
  platform: string
  firmwareTrainId: string | null
  logicalVersion: string
  version: string
  imageCode: string | null
  variant: string | null
  isActive: boolean
}): FirmwareCompatibilityRelease {
  return row
}

function asRule(row: {
  id: string
  vendorId: string
  deviceModelFamilyId: string | null
  deviceModelId: string | null
  platform: string
  firmwareTrainId: string | null
  logicalVersion: string | null
  firmwareReleaseId: string | null
  imageCode: string | null
  decision: string
  sourceType: string
  explanation: string
  isActive: boolean
  validFrom: Date | null
  validUntil: Date | null
}): FirmwareCompatibilityRule {
  return {
    ...row,
    decision: row.decision as FirmwareCompatibilityDecision,
    sourceType: row.sourceType as FirmwareCompatibilitySourceType,
  }
}

function asOverride(row: {
  id: string
  deviceModelId: string
  firmwareReleaseId: string
  decision: string
  reason: string
  version: number
  isActive: boolean
  createdAt: Date
  createdByUserId: string | null
}): FirmwareCompatibilityOverride {
  return { ...row, decision: row.decision as FirmwareCompatibilityDecision }
}

const releaseSelect = {
  id: true,
  vendorId: true,
  platform: true,
  firmwareTrainId: true,
  logicalVersion: true,
  version: true,
  imageCode: true,
  variant: true,
  isActive: true,
} as const

const ruleSelect = {
  id: true,
  vendorId: true,
  deviceModelFamilyId: true,
  deviceModelId: true,
  platform: true,
  firmwareTrainId: true,
  logicalVersion: true,
  firmwareReleaseId: true,
  imageCode: true,
  decision: true,
  sourceType: true,
  explanation: true,
  isActive: true,
  validFrom: true,
  validUntil: true,
} as const

const overrideSelect = {
  id: true,
  deviceModelId: true,
  firmwareReleaseId: true,
  decision: true,
  reason: true,
  version: true,
  isActive: true,
  createdAt: true,
  createdByUserId: true,
} as const

async function loadModel(deviceModelId: string) {
  const model = await prisma.deviceModel.findUnique({
    where: { id: deviceModelId },
    select: { id: true, vendorId: true, familyId: true, model: true, isActive: true },
  })
  if (!model) throw new FirmwareCompatibilityReferenceError('Device model was not found.')
  return model
}

async function loadRelease(firmwareReleaseId: string) {
  const release = await prisma.firmwareRelease.findUnique({ where: { id: firmwareReleaseId }, select: releaseSelect })
  if (!release) throw new FirmwareCompatibilityReferenceError('Firmware release was not found.')
  return release
}

async function loadRulesForModel(model: { id: string; familyId: string | null }) {
  return prisma.firmwareCompatibilityRule.findMany({
    where: {
      isActive: true,
      OR: [
        { deviceModelId: model.id },
        ...(model.familyId ? [{ deviceModelFamilyId: model.familyId }] : []),
      ],
    },
    orderBy: [{ deviceModelId: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: ruleSelect,
  })
}

async function loadOverrides(deviceModelId: string, firmwareReleaseIds: string[]) {
  if (firmwareReleaseIds.length === 0) return []
  return prisma.firmwareCompatibilityOverride.findMany({
    where: { deviceModelId, firmwareReleaseId: { in: firmwareReleaseIds }, isActive: true },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: overrideSelect,
  })
}

export async function evaluateModelFirmwareCompatibility(deviceModelId: string, firmwareReleaseId: string, at: Date = new Date()) {
  const [model, release] = await Promise.all([loadModel(deviceModelId), loadRelease(firmwareReleaseId)])
  const [rules, overrides] = await Promise.all([
    loadRulesForModel(model),
    loadOverrides(model.id, [release.id]),
  ])
  return evaluateFirmwareCompatibility({
    model: asModel(model),
    release: asRelease(release),
    rules: rules.map(asRule),
    overrides: overrides.map(asOverride),
    at,
  })
}

export async function resolveFirmwareImageForModel(deviceModelId: string, logicalFirmwareReleaseId: string, at: Date = new Date()) {
  const [model, logicalTarget] = await Promise.all([loadModel(deviceModelId), loadRelease(logicalFirmwareReleaseId)])
  if (model.vendorId !== logicalTarget.vendorId) {
    return resolveCompatibleFirmwareImage({
      model: asModel(model),
      logicalTarget: asRelease(logicalTarget),
      candidateReleases: [asRelease(logicalTarget)],
      rules: [],
      overrides: [],
      at,
    })
  }

  const candidates = await prisma.firmwareRelease.findMany({
    where: {
      vendorId: logicalTarget.vendorId,
      logicalVersion: logicalTarget.logicalVersion,
      isActive: true,
      ...(logicalTarget.firmwareTrainId ? { firmwareTrainId: logicalTarget.firmwareTrainId } : {}),
    },
    select: releaseSelect,
  })
  const samePlatform = candidates.filter((candidate) => normalized(candidate.platform) === normalized(logicalTarget.platform))
  const [rules, overrides] = await Promise.all([
    loadRulesForModel(model),
    loadOverrides(model.id, samePlatform.map((candidate) => candidate.id)),
  ])

  return resolveCompatibleFirmwareImage({
    model: asModel(model),
    logicalTarget: asRelease(logicalTarget),
    candidateReleases: samePlatform.map(asRelease),
    rules: rules.map(asRule),
    overrides: overrides.map(asOverride),
    at,
  })
}

export async function previewFamilyFirmwareCompatibility(deviceModelFamilyId: string, logicalFirmwareReleaseId: string, at: Date = new Date()) {
  const [family, release] = await Promise.all([
    prisma.deviceModelFamily.findUnique({ where: { id: deviceModelFamilyId }, select: { id: true, vendorId: true, name: true } }),
    loadRelease(logicalFirmwareReleaseId),
  ])
  if (!family) throw new FirmwareCompatibilityReferenceError('Device model family was not found.')
  const models = await prisma.deviceModel.findMany({
    where: { familyId: family.id, isActive: true },
    orderBy: { model: 'asc' },
    select: { id: true, model: true },
  })

  const results = []
  for (const model of models) {
    const resolution = await resolveFirmwareImageForModel(model.id, release.id, at)
    results.push({ deviceModelId: model.id, model: model.model, status: resolution.status, resolution })
  }

  return {
    deviceModelFamilyId: family.id,
    familyName: family.name,
    logicalFirmwareReleaseId: release.id,
    compatible: results.filter((result) => result.status === 'RESOLVED'),
    incompatible: results.filter((result) => result.status === 'INCOMPATIBLE'),
    unknown: results.filter((result) => result.status === 'UNKNOWN'),
    ambiguous: results.filter((result) => result.status === 'AMBIGUOUS'),
    results,
    canApply: results.every((result) => result.status === 'RESOLVED'),
  }
}

async function validateRuleReferences(input: ReturnType<typeof parseRuleInput>) {
  const [vendor, family, model, train, release] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true } }),
    input.deviceModelFamilyId
      ? prisma.deviceModelFamily.findUnique({ where: { id: input.deviceModelFamilyId }, select: { id: true, vendorId: true } })
      : Promise.resolve(null),
    input.deviceModelId
      ? prisma.deviceModel.findUnique({ where: { id: input.deviceModelId }, select: { id: true, vendorId: true } })
      : Promise.resolve(null),
    input.firmwareTrainId
      ? prisma.firmwareTrain.findUnique({ where: { id: input.firmwareTrainId }, select: { id: true, vendorId: true, platform: true } })
      : Promise.resolve(null),
    input.firmwareReleaseId
      ? prisma.firmwareRelease.findUnique({ where: { id: input.firmwareReleaseId }, select: { id: true, vendorId: true, platform: true, logicalVersion: true, imageCode: true, firmwareTrainId: true } })
      : Promise.resolve(null),
  ])
  if (!vendor) throw new FirmwareCompatibilityReferenceError('Vendor was not found.')
  if (input.deviceModelFamilyId && !family) throw new FirmwareCompatibilityReferenceError('Device model family was not found.')
  if (input.deviceModelId && !model) throw new FirmwareCompatibilityReferenceError('Device model was not found.')
  if (input.firmwareTrainId && !train) throw new FirmwareCompatibilityReferenceError('Firmware train was not found.')
  if (input.firmwareReleaseId && !release) throw new FirmwareCompatibilityReferenceError('Firmware release was not found.')
  if (family && family.vendorId !== input.vendorId) throw new FirmwareCompatibilityReferenceError('Family and compatibility vendor must match.')
  if (model && model.vendorId !== input.vendorId) throw new FirmwareCompatibilityReferenceError('Model and compatibility vendor must match.')
  if (train && (train.vendorId !== input.vendorId || normalized(train.platform) !== normalized(input.platform))) {
    throw new FirmwareCompatibilityReferenceError('Firmware train must match the compatibility vendor and platform.')
  }
  if (release) {
    if (release.vendorId !== input.vendorId || normalized(release.platform) !== normalized(input.platform)) {
      throw new FirmwareCompatibilityReferenceError('Firmware release must match the compatibility vendor and platform.')
    }
    if (input.firmwareTrainId && release.firmwareTrainId !== input.firmwareTrainId) {
      throw new FirmwareCompatibilityReferenceError('Firmware release must belong to the selected compatibility train.')
    }
    if (input.logicalVersion && normalized(release.logicalVersion) !== normalized(input.logicalVersion)) {
      throw new FirmwareCompatibilityReferenceError('Firmware release must match the selected logical version.')
    }
    if (input.imageCode && normalized(release.imageCode) !== normalized(input.imageCode)) {
      throw new FirmwareCompatibilityReferenceError('Firmware release must match the selected image code.')
    }
  }
}

function parseRuleInput(raw: FirmwareCompatibilityRuleWriteInput) {
  const vendorId = cleanString(raw.vendorId)
  const deviceModelFamilyId = optionalString(raw.deviceModelFamilyId)
  const deviceModelId = optionalString(raw.deviceModelId)
  const platform = cleanString(raw.platform)
  const explanation = cleanString(raw.explanation)
  if (!vendorId) throw new FirmwareCompatibilityValidationError('Vendor is required.')
  if (!!deviceModelFamilyId === !!deviceModelId) {
    throw new FirmwareCompatibilityValidationError('Choose exactly one compatibility subject: model family or concrete model.')
  }
  if (!platform) throw new FirmwareCompatibilityValidationError('Software platform is required.')
  if (!explanation) throw new FirmwareCompatibilityValidationError('Compatibility explanation is required.')

  const validFrom = parseDate(raw.validFrom, 'Valid-from date')
  const validUntil = parseDate(raw.validUntil, 'Valid-until date')
  if (validFrom && validUntil && validUntil.getTime() <= validFrom.getTime()) {
    throw new FirmwareCompatibilityValidationError('Valid-until must be later than valid-from.')
  }

  return {
    vendorId,
    deviceModelFamilyId,
    deviceModelId,
    platform,
    firmwareTrainId: optionalString(raw.firmwareTrainId),
    logicalVersion: optionalString(raw.logicalVersion),
    firmwareReleaseId: optionalString(raw.firmwareReleaseId),
    imageCode: optionalString(raw.imageCode),
    decision: parseDecision(raw.decision),
    sourceType: parseSourceType(raw.sourceType),
    explanation,
    notes: optionalString(raw.notes),
    isActive: raw.isActive === undefined ? true : raw.isActive === true,
    validFrom,
    validUntil,
  }
}

export async function createFirmwareCompatibilityRule(raw: FirmwareCompatibilityRuleWriteInput) {
  const input = parseRuleInput(raw)
  await validateRuleReferences(input)
  return prisma.firmwareCompatibilityRule.create({ data: input })
}

export async function updateFirmwareCompatibilityRule(id: string, raw: FirmwareCompatibilityRuleWriteInput) {
  const current = await prisma.firmwareCompatibilityRule.findUnique({ where: { id } })
  if (!current) throw new FirmwareCompatibilityNotFoundError('Compatibility rule was not found.')
  const input = parseRuleInput({ ...current, ...raw })
  await validateRuleReferences(input)
  return prisma.firmwareCompatibilityRule.update({ where: { id }, data: input })
}

export async function setFirmwareCompatibilityOverride(
  raw: FirmwareCompatibilityOverrideWriteInput,
  actorUserId: string | null = null,
) {
  const deviceModelId = cleanString(raw.deviceModelId)
  const firmwareReleaseId = cleanString(raw.firmwareReleaseId)
  const reason = cleanString(raw.reason)
  const decision = parseDecision(raw.decision)
  if (!deviceModelId) throw new FirmwareCompatibilityValidationError('Device model is required.')
  if (!firmwareReleaseId) throw new FirmwareCompatibilityValidationError('Firmware release is required.')
  if (!reason) throw new FirmwareCompatibilityValidationError('Manual override reason is required.')

  const [model, release] = await Promise.all([loadModel(deviceModelId), loadRelease(firmwareReleaseId)])
  if (model.vendorId !== release.vendorId) {
    throw new FirmwareCompatibilityReferenceError('Manual compatibility override cannot cross vendor boundaries.')
  }
  const previous = await prisma.firmwareCompatibilityOverride.findFirst({
    where: { deviceModelId, firmwareReleaseId, isActive: true },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  })
  const version = (previous?.version ?? 0) + 1

  return prisma.$transaction(async (tx) => {
    await tx.firmwareCompatibilityOverride.updateMany({
      where: { deviceModelId, firmwareReleaseId, isActive: true },
      data: { isActive: false },
    })
    const created = await tx.firmwareCompatibilityOverride.create({
      data: { deviceModelId, firmwareReleaseId, decision, reason, version, createdByUserId: actorUserId, isActive: true },
    })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        action: AUDIT_ACTIONS.firmwareCompatibilityOverrideChanged,
        entityType: 'DeviceModel',
        entityId: deviceModelId,
        before: previous ? {
          overrideId: previous.id,
          firmwareReleaseId,
          decision: previous.decision,
          reason: previous.reason,
          version: previous.version,
        } : undefined,
        after: {
          overrideId: created.id,
          firmwareReleaseId,
          decision: created.decision,
          reason: created.reason,
          version: created.version,
        },
        metadata: { compatibilitySource: 'MANUAL_OVERRIDE' },
      },
    })
    return created
  })
}

export async function clearFirmwareCompatibilityOverride(
  deviceModelIdValue: unknown,
  firmwareReleaseIdValue: unknown,
  actorUserId: string | null = null,
) {
  const deviceModelId = cleanString(deviceModelIdValue)
  const firmwareReleaseId = cleanString(firmwareReleaseIdValue)
  if (!deviceModelId || !firmwareReleaseId) throw new FirmwareCompatibilityValidationError('Device model and firmware release are required.')
  const previous = await prisma.firmwareCompatibilityOverride.findFirst({
    where: { deviceModelId, firmwareReleaseId, isActive: true },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  })
  if (!previous) return { cleared: false }

  await prisma.$transaction(async (tx) => {
    await tx.firmwareCompatibilityOverride.updateMany({
      where: { deviceModelId, firmwareReleaseId, isActive: true },
      data: { isActive: false },
    })
    await tx.auditEvent.create({
      data: {
        actorUserId,
        action: AUDIT_ACTIONS.firmwareCompatibilityOverrideCleared,
        entityType: 'DeviceModel',
        entityId: deviceModelId,
        before: {
          overrideId: previous.id,
          firmwareReleaseId,
          decision: previous.decision,
          reason: previous.reason,
          version: previous.version,
        },
        after: { overrideId: null, firmwareReleaseId, decision: null, reason: null, version: null },
        metadata: { compatibilitySource: 'MANUAL_OVERRIDE' },
      },
    })
  })
  return { cleared: true }
}

export async function listFirmwareCompatibilityForModel(deviceModelId: string) {
  const model = await loadModel(deviceModelId)
  const [rules, overrides] = await Promise.all([
    loadRulesForModel(model),
    prisma.firmwareCompatibilityOverride.findMany({
      where: { deviceModelId, isActive: true },
      orderBy: [{ firmwareReleaseId: 'asc' }, { version: 'desc' }],
    }),
  ])
  return {
    model: { id: model.id, model: model.model, familyId: model.familyId, vendorId: model.vendorId },
    rules: rules.map((rule) => ({ ...rule, inherited: rule.deviceModelId !== model.id })),
    overrides,
  }
}
