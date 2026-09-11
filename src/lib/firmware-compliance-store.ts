import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
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

/** Five batch reads, independent of device count; no per-device database operations. */
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
  const [policyRows, releases, ruleRows, overrideRows] = await Promise.all([
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
    const effectivePolicy = resolveFirmwarePolicyAt(
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

    const rules = [
      ...(rulesByModel.get(model.id) ?? []),
      ...(rulesByFamily.get(model.familyId ?? '') ?? []),
    ]
    const overrides = overridesByModel.get(model.id) ?? []
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
