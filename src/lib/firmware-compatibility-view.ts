import { prisma } from '@/lib/prisma'
import { resolveCatalogTrainForModel } from '@/lib/firmware-catalog-defaults'
import {
  evaluateFirmwareCompatibility,
  type FirmwareCompatibilityOverride,
  type FirmwareCompatibilityRelease,
  type FirmwareCompatibilityRule,
} from '@/lib/firmware-compatibility'
import { listFirmwareCompatibilityForModel } from '@/lib/firmware-compatibility-store'
import { listConfiguredModelSupportedPlatforms } from '@/lib/model-platform-compatibility-store'

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
    decision: row.decision as FirmwareCompatibilityRule['decision'],
    sourceType: row.sourceType as FirmwareCompatibilityRule['sourceType'],
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
  const [compatibility, supportedByModel] = await Promise.all([
    listFirmwareCompatibilityForModel(deviceModelId),
    listConfiguredModelSupportedPlatforms([deviceModelId]),
  ])
  const releases = await prisma.firmwareRelease.findMany({
    where: { vendorId: compatibility.model.vendorId, isActive: true },
    orderBy: [{ platform: 'asc' }, { logicalVersion: 'asc' }, { version: 'asc' }],
    select: releaseViewSelect,
  })
  const releaseById = new Map(releases.map((release) => [release.id, release]))
  const trainIds = [
    ...new Set(
      compatibility.rules.map((rule) => rule.firmwareTrainId).filter((id): id is string => Boolean(id)),
    ),
  ]
  const trains = trainIds.length
    ? await prisma.firmwareTrain.findMany({ where: { id: { in: trainIds } }, select: { id: true, name: true } })
    : []
  const trainById = new Map(trains.map((train) => [train.id, train.name]))
  const pureRules = compatibility.rules.map(asRule)
  const pureOverrides = compatibility.overrides.map(asOverride)
  const pureModel = compatibility.model

  const configuredPlatforms = supportedByModel.get(deviceModelId) ?? []
  const inheritedPlatforms = (compatibility.model.platform ?? '')
    .split(',')
    .map((platform) => platform.normalize('NFKC').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  const catalogPlatforms = [...new Set([...configuredPlatforms, ...inheritedPlatforms])]
  const [vendor, catalogTrains] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: compatibility.model.vendorId }, select: { code: true } }),
    prisma.firmwareTrain.findMany({
      where: {
        vendorId: compatibility.model.vendorId,
        isActive: true,
        state: { in: ['PREFERRED', 'ACCEPTED'] },
      },
      select: {
        id: true,
        name: true,
        platform: true,
        state: true,
        preferredRelease: {
          select: {
            id: true,
            vendorId: true,
            platform: true,
            firmwareTrainId: true,
            logicalVersion: true,
            version: true,
            imageCode: true,
            variant: true,
            isActive: true,
          },
        },
      },
    }),
  ])
  const catalogFallbacks = catalogPlatforms.map((platform) => {
    const trains = catalogTrains
      .filter((train) => train.platform.localeCompare(platform, 'en', { sensitivity: 'base' }) === 0)
      .map((train) => {
        const compatibilityResult = train.preferredRelease
          ? evaluateFirmwareCompatibility({
              model: pureModel,
              release: asRelease(train.preferredRelease),
              rules: pureRules,
              overrides: pureOverrides,
            })
          : null
        return {
          id: train.id,
          name: train.name,
          state: train.state as 'PREFERRED' | 'ACCEPTED',
          preferredRelease: train.preferredRelease
            ? {
                id: train.preferredRelease.id,
                version: train.preferredRelease.version,
                decision: 'ALLOWED' as const,
                isActive: train.preferredRelease.isActive,
              }
            : null,
          compatibility: compatibilityResult?.status ?? 'UNKNOWN',
          compatibilityExplanation: compatibilityResult?.provenance.explanation ?? 'The train has no preferred release to prove compatibility.',
        }
      })
    return {
      platform,
      resolution: resolveCatalogTrainForModel({
        vendorKey: vendor?.code ?? compatibility.model.vendorId,
        platform,
        trains,
      }),
    }
  })

  return {
    model: compatibility.model,
    supportedPlatforms: configuredPlatforms.length > 0 ? configuredPlatforms : inheritedPlatforms,
    catalogFallbacks,
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
      firmwareReleaseVersion: rule.firmwareReleaseId
        ? releaseById.get(rule.firmwareReleaseId)?.version ?? null
        : null,
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
    availableReleases: releases.map((release) => ({
      ...release,
      compatibility: evaluateFirmwareCompatibility({
        model: pureModel,
        release: asRelease(release),
        rules: pureRules,
        overrides: pureOverrides,
      }),
    })),
  }
}

export async function getReleaseModelCompatibilityView(firmwareReleaseId: string) {
  const release = await prisma.firmwareRelease.findUnique({
    where: { id: firmwareReleaseId },
    select: releaseViewSelect,
  })
  if (!release) return null

  const models = await prisma.deviceModel.findMany({
    where: { vendorId: release.vendorId, isActive: true },
    orderBy: { model: 'asc' },
    select: { id: true, vendorId: true, familyId: true, model: true, platform: true },
  })
  const familyIds = [
    ...new Set(models.map((model) => model.familyId).filter((id): id is string => Boolean(id))),
  ]
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
    where: {
      firmwareReleaseId: release.id,
      isActive: true,
      deviceModelId: { in: models.map((model) => model.id) },
    },
    select: {
      id: true,
      deviceModelId: true,
      firmwareReleaseId: true,
      decision: true,
      reason: true,
      version: true,
      isActive: true,
      createdAt: true,
      createdByUserId: true,
    },
  })

  const supportedByModel = await listConfiguredModelSupportedPlatforms(models.map((model) => model.id))
  const pureRelease = asRelease(release)
  const pureRules = rules.map(asRule)
  const pureOverrides = overrides.map(asOverride)
  const results = models.map((model) => ({
    model: {
      ...model,
      supportedPlatforms:
        supportedByModel.get(model.id) ??
        (model.platform ?? '')
          .split(',')
          .map((platform) => platform.normalize('NFKC').trim().replace(/\s+/g, ' '))
          .filter(Boolean),
    },
    result: evaluateFirmwareCompatibility({
      model,
      release: pureRelease,
      rules: pureRules,
      overrides: pureOverrides,
    }),
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
