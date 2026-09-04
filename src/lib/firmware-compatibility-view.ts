import { prisma } from '@/lib/prisma'
import { evaluateFirmwareCompatibility, type FirmwareCompatibilityOverride, type FirmwareCompatibilityRelease, type FirmwareCompatibilityRule } from '@/lib/firmware-compatibility'
import { listFirmwareCompatibilityForModel } from '@/lib/firmware-compatibility-store'

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
  return { ...row, decision: row.decision as FirmwareCompatibilityRule['decision'], sourceType: row.sourceType as FirmwareCompatibilityRule['sourceType'] }
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
  return { ...row, decision: row.decision as FirmwareCompatibilityOverride['decision'] }
}

const releaseViewSelect = {
  id: true,
  vendorId: true,
  platform: true,
  firmwareTrainId: true,
  logicalVersion: true,
  version: true,
  imageCode: true,
  variant: true,
  isActive: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

export async function getModelFirmwareCompatibilityView(deviceModelId: string) {
  const compatibility = await listFirmwareCompatibilityForModel(deviceModelId)
  const releases = await prisma.firmwareRelease.findMany({
    where: { vendorId: compatibility.model.vendorId, isActive: true },
    orderBy: [{ platform: 'asc' }, { logicalVersion: 'asc' }, { version: 'asc' }],
    select: releaseViewSelect,
  })
  const releaseById = new Map(releases.map((release) => [release.id, release]))
  const trainIds = [...new Set(compatibility.rules.map((rule) => rule.firmwareTrainId).filter((id): id is string => Boolean(id)))]
  const trains = trainIds.length
    ? await prisma.firmwareTrain.findMany({ where: { id: { in: trainIds } }, select: { id: true, name: true } })
    : []
  const trainById = new Map(trains.map((train) => [train.id, train.name]))

  return {
    model: compatibility.model,
    supportedPlatforms: [...new Set(
      compatibility.rules
        .filter((rule) => rule.decision === 'ALLOW')
        .map((rule) => rule.platform),
    )].sort(),
    rules: compatibility.rules.map((rule) => ({
      id: rule.id,
      inherited: rule.inherited,
      decision: rule.decision,
      sourceType: rule.sourceType,
      platform: rule.platform,
      firmwareTrainId: rule.firmwareTrainId,
      firmwareTrainName: rule.firmwareTrainId ? trainById.get(rule.firmwareTrainId) ?? null : null,
      logicalVersion: rule.logicalVersion,
      firmwareReleaseId: rule.firmwareReleaseId,
      firmwareReleaseVersion: rule.firmwareReleaseId ? releaseById.get(rule.firmwareReleaseId)?.version ?? null : null,
      imageCode: rule.imageCode,
      explanation: rule.explanation,
      validFrom: rule.validFrom?.toISOString() ?? null,
      validUntil: rule.validUntil?.toISOString() ?? null,
    })),
    overrides: compatibility.overrides.map((override) => ({
      id: override.id,
      firmwareReleaseId: override.firmwareReleaseId,
      firmwareRelease: releaseById.get(override.firmwareReleaseId) ?? null,
      decision: override.decision,
      reason: override.reason,
      version: override.version,
      createdByUserId: override.createdByUserId,
      createdAt: override.createdAt.toISOString(),
    })),
    availableReleases: releases,
  }
}

export async function getReleaseModelCompatibilityView(firmwareReleaseId: string) {
  const release = await prisma.firmwareRelease.findUnique({ where: { id: firmwareReleaseId }, select: releaseViewSelect })
  if (!release) return null

  const models = await prisma.deviceModel.findMany({
    where: { vendorId: release.vendorId, isActive: true },
    orderBy: { model: 'asc' },
    select: { id: true, vendorId: true, familyId: true, model: true },
  })
  const familyIds = [...new Set(models.map((model) => model.familyId).filter((id): id is string => Boolean(id)))]
  const rules = await prisma.firmwareCompatibilityRule.findMany({
    where: {
      isActive: true,
      vendorId: release.vendorId,
      OR: [
        { deviceModelId: { in: models.map((model) => model.id) } },
        ...(familyIds.length ? [{ deviceModelFamilyId: { in: familyIds } }] : []),
      ],
    },
    select: {
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
    },
  })
  const overrides = await prisma.firmwareCompatibilityOverride.findMany({
    where: { firmwareReleaseId: release.id, isActive: true, deviceModelId: { in: models.map((model) => model.id) } },
    select: { id: true, deviceModelId: true, firmwareReleaseId: true, decision: true, reason: true, version: true, isActive: true, createdAt: true, createdByUserId: true },
  })

  const pureRelease = asRelease(release)
  const pureRules = rules.map(asRule)
  const pureOverrides = overrides.map(asOverride)
  const results = models.map((model) => ({
    model,
    result: evaluateFirmwareCompatibility({ model, release: pureRelease, rules: pureRules, overrides: pureOverrides }),
  }))

  return {
    release,
    counts: {
      compatible: results.filter(({ result }) => result.status === 'COMPATIBLE').length,
      incompatible: results.filter(({ result }) => result.status === 'INCOMPATIBLE').length,
      unknown: results.filter(({ result }) => result.status === 'UNKNOWN').length,
    },
    models: results,
  }
}
