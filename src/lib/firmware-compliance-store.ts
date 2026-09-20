import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  releaseDecisionFromCatalogSemantics,
  resolveCatalogTrainForModel,
} from '@/lib/firmware-catalog-defaults'
import {
  evaluateFirmwareCompatibility,
  resolveCompatibleFirmwareImage,
  type FirmwareCompatibilityRule,
  type FirmwareCompatibilityOverride,
} from '@/lib/firmware-compatibility'
import {
  resolveFirmwarePolicyAt,
  resolveLatestApprovedInTrain,
  type FirmwarePolicyCandidate,
  type FirmwarePolicyResolution,
} from '@/lib/firmware-policies'
import { normalizedFirmwarePlatform } from '@/lib/firmware-releases'
import {
  resolveObservedFirmwareRelease,
  supportedFirmwarePlatforms,
} from '@/lib/firmware-observation'
import {
  resolveFirmwareCompliance,
  type ComplianceRelease,
  type FirmwareComplianceResult,
} from '@/lib/firmware-compliance'

const releaseSelect = {
  id: true,
  vendorId: true,
  platform: true,
  firmwareTrainId: true,
  version: true,
  logicalVersion: true,
  variant: true,
  imageCode: true,
  isActive: true,
  catalogState: true,
  policyEligibility: true,
  variantEquivalence: true,
  status: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

function bucket<T>(map: Map<string, T[]>, key: string | null, value: T) {
  if (!key) return
  const items = map.get(key)
  if (items) items.push(value)
  else map.set(key, [value])
}
const logicalKey = (release: ComplianceRelease) =>
  JSON.stringify([
    release.vendorId,
    normalizedFirmwarePlatform(release.platform),
    release.logicalVersion,
  ])

/** Bounded batch reads, independent of device count; no per-device database operations. */
export async function resolveFirmwareComplianceBatch(
  deviceIds: string[],
  at: Date = new Date(),
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, FirmwareComplianceResult>> {
  if (deviceIds.length === 0) return new Map()
  const devices = await db.device.findMany({
    where: { id: { in: [...new Set(deviceIds)] } },
    select: {
      id: true,
      customerId: true,
      siteId: true,
      deviceModelId: true,
      currentFirmwareReleaseId: true,
      currentFirmwareRawVersion: true,
      currentFirmwareNormalizedVersion: true,
      deviceModel: {
        select: {
          id: true,
          vendorId: true,
          familyId: true,
          platform: true,
        },
      },
    },
  })
  const modelIds = [...new Set(devices.map((d) => d.deviceModelId))]
  const familyIds = [
    ...new Set(
      devices.flatMap((d) =>
        d.deviceModel.familyId ? [d.deviceModel.familyId] : [],
      ),
    ),
  ]
  const vendorIds = [...new Set(devices.map((d) => d.deviceModel.vendorId))]
  const [policyRows, releases, ruleRows, overrideRows, catalogTrains] = await Promise.all([
    db.firmwarePolicy.findMany({
      where: {
        isActive: true,
        OR: [
          { deviceId: { in: deviceIds } },
          {
            customerId: { in: [...new Set(devices.map((d) => d.customerId))] },
          },
          {
            siteId: {
              in: devices.flatMap((d) => (d.siteId ? [d.siteId] : [])),
            },
          },
          { deviceModelId: { in: modelIds } },
          { deviceModelFamilyId: { in: familyIds } },
        ],
      },
    }),
    db.firmwareRelease.findMany({
      where: {
        OR: [
          { vendorId: { in: vendorIds } },
          {
            id: {
              in: devices.flatMap((d) =>
                d.currentFirmwareReleaseId ? [d.currentFirmwareReleaseId] : [],
              ),
            },
          },
        ],
      },
      select: releaseSelect,
    }),
    db.firmwareCompatibilityRule.findMany({
      where: {
        isActive: true,
        OR: [
          { deviceModelId: { in: modelIds } },
          { deviceModelFamilyId: { in: familyIds } },
        ],
      },
    }),
    db.firmwareCompatibilityOverride.findMany({
      where: { isActive: true, deviceModelId: { in: modelIds } },
    }),
    db.firmwareTrain.findMany({
      where: {
        vendorId: { in: vendorIds },
        isActive: true,
        state: { in: ['PREFERRED', 'ACCEPTED'] },
      },
      select: {
        id: true,
        vendorId: true,
        platform: true,
        name: true,
        state: true,
        preferredFirmwareReleaseId: true,
        minimumAcceptableFirmwareReleaseId: true,
      },
    }),
  ])
  const releaseById = new Map<string, ComplianceRelease>(
    releases.map((r) => [r.id, r]),
  )
  const logicalReleases = new Map<string, ComplianceRelease[]>()
  const trainReleases = new Map<string, ComplianceRelease[]>()
  for (const release of releases) {
    bucket(logicalReleases, logicalKey(release), release)
    bucket(trainReleases, release.firmwareTrainId, release)
  }
  const catalogTrainsByPlatform = new Map<string, typeof catalogTrains>()
  for (const train of catalogTrains) {
    const key = JSON.stringify([train.vendorId, normalizedFirmwarePlatform(train.platform)])
    const existing = catalogTrainsByPlatform.get(key)
    if (existing) existing.push(train)
    else catalogTrainsByPlatform.set(key, [train])
  }

  const policies = new Map<string, FirmwarePolicyCandidate[]>()
  for (const row of policyRows) {
    // Index candidate retrieval only; #43 remains responsible for applicability/precedence.
    const key = row.deviceId
      ? `d:${row.deviceId}`
      : row.siteId
        ? `s:${row.siteId}`
        : row.customerId
          ? `c:${row.customerId}`
          : row.deviceModelId
            ? `m:${row.deviceModelId}`
            : `f:${row.deviceModelFamilyId}`
    bucket(policies, key, row as FirmwarePolicyCandidate)
  }
  const rulesByModel = new Map<string, FirmwareCompatibilityRule[]>()
  const rulesByFamily = new Map<string, FirmwareCompatibilityRule[]>()
  for (const rule of ruleRows) {
    bucket(rulesByModel, rule.deviceModelId, rule as FirmwareCompatibilityRule)
    bucket(
      rulesByFamily,
      rule.deviceModelFamilyId,
      rule as FirmwareCompatibilityRule,
    )
  }
  const overridesByModel = new Map<string, FirmwareCompatibilityOverride[]>()
  for (const override of overrideRows)
    bucket(
      overridesByModel,
      override.deviceModelId,
      override as FirmwareCompatibilityOverride,
    )
  const observedCache = new Map<
    string,
    ReturnType<typeof evaluateFirmwareCompatibility>
  >()
  const imageCache = new Map<
    string,
    ReturnType<typeof resolveCompatibleFirmwareImage>
  >()
  const movingCache = new Map<
    string,
    ReturnType<typeof resolveLatestApprovedInTrain<ComplianceRelease>>
  >()
  function catalogDefaultPolicyForModel(
    model: (typeof devices)[number]['deviceModel'],
    rules: FirmwareCompatibilityRule[],
    overrides: FirmwareCompatibilityOverride[],
  ): FirmwarePolicyResolution {
    const platforms = supportedFirmwarePlatforms(model.platform)
    if (platforms.length !== 1) {
      return {
        status: 'UNRESOLVED',
        policy: null,
        source: null,
        unresolvedReason: 'CATALOG_PLATFORM_UNRESOLVED',
      }
    }
    const platform = platforms[0]
    const rows = catalogTrainsByPlatform.get(
      JSON.stringify([model.vendorId, normalizedFirmwarePlatform(platform)]),
    ) ?? []
    const resolution = resolveCatalogTrainForModel({
      vendorKey: model.vendorId,
      platform,
      trains: rows.map((train) => {
        const preferred = releaseById.get(train.preferredFirmwareReleaseId ?? '') ?? null
        const compatibility = preferred
          ? evaluateFirmwareCompatibility({ model, release: preferred, rules, overrides, at })
          : null
        return {
          id: train.id,
          name: train.name,
          state: train.state as 'PREFERRED' | 'ACCEPTED',
          preferredRelease: preferred
            ? {
                id: preferred.id,
                version: preferred.logicalVersion,
                decision: releaseDecisionFromCatalogSemantics(preferred),
                isActive: preferred.isActive,
              }
            : null,
          compatibility: compatibility?.status ?? 'UNKNOWN',
          compatibilityExplanation:
            compatibility?.provenance.explanation ??
            'The train has no preferred release configured.',
        }
      }),
    })
    if (resolution.status !== 'RESOLVED') {
      return {
        status: 'UNRESOLVED',
        policy: null,
        source: null,
        unresolvedReason:
          resolution.status === 'NO_COMPATIBLE_TRAIN'
            ? 'NO_COMPATIBLE_CATALOG_TRAIN'
            : 'CATALOG_COMPATIBILITY_UNRESOLVED',
      }
    }

    const selected = rows.find((train) => train.id === resolution.train.id)
    const preferred = selected
      ? releaseById.get(selected.preferredFirmwareReleaseId ?? '') ?? null
      : null
    if (!selected || !preferred) {
      return {
        status: 'UNRESOLVED',
        policy: null,
        source: null,
        unresolvedReason: 'CATALOG_COMPATIBILITY_UNRESOLVED',
      }
    }
    const minimum = releaseById.get(selected.minimumAcceptableFirmwareReleaseId ?? '') ?? null
    const policyId = `catalog:${selected.id}`
    const trackClass = resolution.source === 'ACCEPTED_FALLBACK' ? 'ACCEPTED' : 'PREFERRED'
    const policy: FirmwarePolicyCandidate = {
      id: policyId,
      isActive: true,
      policyMode: minimum ? 'MINIMUM' : 'EXACT',
      trackKey: policyId,
      trackName: selected.name,
      trackClass,
      isDefaultTrack: true,
      desiredPlatform: selected.platform,
      minimumFirmwareReleaseId: minimum?.id ?? null,
      targetFirmwareReleaseId: preferred.id,
      maximumFirmwareReleaseId: null,
      firmwareTrainId: selected.id,
      minimumInclusive: true,
      maximumInclusive: true,
      effectiveFrom: new Date(0),
      policyVersion: 1,
      deviceModelFamilyId: model.familyId,
      deviceModelId: model.familyId ? null : model.id,
      customerId: null,
      siteId: null,
      deviceId: null,
      contractTypeId: null,
      vendorId: null,
      deviceTypeId: null,
    }
    return {
      status: 'RESOLVED',
      policy,
      source: {
        scope: 'CATALOG',
        scopeId: `${model.vendorId}:${normalizedFirmwarePlatform(selected.platform)}`,
        subject: 'CATALOG',
        subjectId: null,
        policyId,
        policyVersion: 1,
        trackKey: policy.trackKey,
        trackName: policy.trackName,
        trackClass: policy.trackClass,
        effectiveFrom: new Date(0).toISOString(),
      },
      unresolvedReason: null,
    }
  }

  const results = new Map<string, FirmwareComplianceResult>()
  for (const device of devices) {
    const model = device.deviceModel
    const candidates = [
      `d:${device.id}`,
      `s:${device.siteId}`,
      `c:${device.customerId}`,
      `m:${model.id}`,
      `f:${model.familyId}`,
    ].flatMap((key) => policies.get(key) ?? [])
    const scopedPolicy = resolveFirmwarePolicyAt(
      candidates,
      {
        deviceId: device.id,
        customerId: device.customerId,
        siteId: device.siteId,
        deviceModelId: model.id,
        deviceModelFamilyId: model.familyId,
      },
      at,
    )

    const rules = [
      ...(rulesByModel.get(model.id) ?? []),
      ...(rulesByFamily.get(model.familyId ?? '') ?? []),
    ]
    const overrides = overridesByModel.get(model.id) ?? []
    const effectivePolicy =
      scopedPolicy.status === 'UNRESOLVED' && scopedPolicy.unresolvedReason === 'NO_POLICY'
        ? catalogDefaultPolicyForModel(model, rules, overrides)
        : scopedPolicy
    const policy = effectivePolicy.policy
    let preferredTarget =
      releaseById.get(policy?.targetFirmwareReleaseId ?? '') ?? null
    let targetReason: string | undefined
    if (policy?.policyMode === 'LATEST_APPROVED_IN_TRAIN') {
      const key = JSON.stringify([
        policy.firmwareTrainId,
        policy.desiredPlatform,
      ])
      let moving = movingCache.get(key)
      if (!moving) {
        moving = resolveLatestApprovedInTrain(
          trainReleases.get(policy.firmwareTrainId ?? '') ?? [],
          policy.firmwareTrainId ?? '',
          policy.desiredPlatform ?? '',
        )
        movingCache.set(key, moving)
      }
      preferredTarget = moving.release
      targetReason = moving.reason
    }

    let currentFirmware =
      releaseById.get(device.currentFirmwareReleaseId ?? '') ?? null
    if (!currentFirmware) {
      const observedResolution = resolveObservedFirmwareRelease({
        vendorId: model.vendorId,
        observedVersion:
          device.currentFirmwareNormalizedVersion ??
          device.currentFirmwareRawVersion,
        supportedPlatforms: supportedFirmwarePlatforms(model.platform),
        releases,
      })
      if (observedResolution.status === 'MATCHED') {
        currentFirmware = observedResolution.release
      }
    }

    const observedKey = JSON.stringify([model.id, currentFirmware?.id])
    let currentCompatibility = observedCache.get(observedKey) ?? null
    if (currentFirmware && !currentCompatibility) {
      currentCompatibility = evaluateFirmwareCompatibility({
        model,
        release: currentFirmware,
        rules,
        overrides,
        at,
      })
      observedCache.set(observedKey, currentCompatibility)
    }
    const imageKey = JSON.stringify([model.id, preferredTarget?.id])
    let targetCompatibility = imageCache.get(imageKey) ?? null
    if (preferredTarget && !targetCompatibility) {
      targetCompatibility = resolveCompatibleFirmwareImage({
        model,
        logicalTarget: preferredTarget,
        candidateReleases:
          logicalReleases.get(logicalKey(preferredTarget)) ?? [],
        rules,
        overrides,
        at,
      })
      imageCache.set(imageKey, targetCompatibility)
    }
    results.set(
      device.id,
      resolveFirmwareCompliance({
        currentFirmware,
        rawVersion:
          device.currentFirmwareNormalizedVersion ??
          device.currentFirmwareRawVersion,
        effectivePolicy,
        preferredTarget,
        currentCompatibility,
        targetCompatibility,
        targetReason,
        minimum:
          releaseById.get(policy?.minimumFirmwareReleaseId ?? '') ?? null,
        maximum:
          releaseById.get(policy?.maximumFirmwareReleaseId ?? '') ?? null,
        resolvedTarget:
          releaseById.get(targetCompatibility?.release?.id ?? '') ?? null,
      }),
    )
  }
  return results
}

export async function resolveFirmwareComplianceForDevice(
  deviceId: string,
  at: Date = new Date(),
) {
  const result = (await resolveFirmwareComplianceBatch([deviceId], at)).get(
    deviceId,
  )
  if (!result)
    throw new Error(
      'Device was not found during firmware compliance resolution.',
    )
  return result
}
