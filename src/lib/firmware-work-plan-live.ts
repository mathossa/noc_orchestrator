// SPDX-License-Identifier: AGPL-3.0-only
import type { FirmwareWorkPlanTarget, Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveFirmwareComplianceBatch } from '@/lib/firmware-compliance-store'
import {
  evaluateFirmwareCompatibility,
  type FirmwareCompatibilityOverride,
  type FirmwareCompatibilityRule,
} from '@/lib/firmware-compatibility'
import {
  policyFingerprint,
  resolveFirmwareExceptions,
} from '@/lib/firmware-exceptions'
import {
  isActiveFirmwareWorkPlanState,
  resolveFirmwareWorkPlanStaleness,
  type FirmwareWorkPlanCurrentContext,
  type FirmwareWorkPlanState,
  type FirmwareWorkPlanStaleness,
} from '@/lib/firmware-work-planning'

export type FirmwareWorkPlanLiveTarget = {
  current: (FirmwareWorkPlanCurrentContext & { deviceMissing: boolean }) | null
  activeException: ReturnType<typeof resolveFirmwareExceptions>['selected']
  activeExceptionOverridden: boolean
  staleness: FirmwareWorkPlanStaleness
}

type TargetInput = {
  state: FirmwareWorkPlanState
  snapshot: FirmwareWorkPlanTarget
}

function indexRows<T>(rows: T[], key: (row: T) => string | null) {
  const index = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    if (id === null) continue
    const bucket = index.get(id)
    if (bucket) bucket.push(row)
    else index.set(id, [row])
  }
  return index
}

/** Read only. Historical plans never consult today's inventory or recommendation. */
export async function resolveFirmwareWorkPlanLiveTargets(
  targets: TargetInput[],
  at = new Date(),
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, FirmwareWorkPlanLiveTarget>> {
  const results = new Map<string, FirmwareWorkPlanLiveTarget>()
  const active = targets.filter(({ state, snapshot }) => {
    if (isActiveFirmwareWorkPlanState(state)) return true
    results.set(snapshot.id, {
      current: null,
      activeException: null,
      activeExceptionOverridden: false,
      staleness: { stale: false, reasons: [] },
    })
    return false
  })
  if (!active.length) return results

  const deviceIds = [
    ...new Set(active.map(({ snapshot }) => snapshot.deviceId)),
  ]
  const releaseIds = [
    ...new Set(active.map(({ snapshot }) => snapshot.targetFirmwareReleaseId)),
  ]
  const devices = await db.device.findMany({
    where: { id: { in: deviceIds } },
    select: {
      id: true,
      customerId: true,
      siteId: true,
      deviceModelId: true,
      currentFirmwareReleaseId: true,
      currentFirmwareNormalizedVersion: true,
      currentFirmwareRawVersion: true,
      currentFirmwareObservedAt: true,
      deviceModel: { select: { id: true, vendorId: true, familyId: true } },
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
  const [technicalByDevice, releases, rules, overrides, exceptions] =
    await Promise.all([
      resolveFirmwareComplianceBatch(deviceIds, at, db),
      // Deliberately fetch the saved exact IDs, including blocked/inactive rows.
      db.firmwareRelease.findMany({
        where: { id: { in: releaseIds } },
        select: {
          id: true,
          vendorId: true,
          platform: true,
          firmwareTrainId: true,
          logicalVersion: true,
          version: true,
          variant: true,
          imageCode: true,
          isActive: true,
          catalogState: true,
        },
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
        where: {
          isActive: true,
          deviceModelId: { in: modelIds },
          firmwareReleaseId: { in: releaseIds },
        },
      }),
      db.firmwareException.findMany({
        where: {
          OR: [
            { scope: 'DEVICE', scopeId: { in: deviceIds } },
            {
              scope: 'CUSTOMER',
              scopeId: { in: [...new Set(devices.map((d) => d.customerId))] },
            },
            {
              scope: 'SITE',
              scopeId: {
                in: [
                  ...new Set(
                    devices.flatMap((d) => (d.siteId ? [d.siteId] : [])),
                  ),
                ],
              },
            },
            { scope: 'MODEL', scopeId: { in: modelIds } },
            { scope: 'FAMILY', scopeId: { in: familyIds } },
          ],
        },
      }),
    ])
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const releaseById = new Map(releases.map((r) => [r.id, r]))
  const modelRules = indexRows(rules, (r) => r.deviceModelId)
  const familyRules = indexRows(rules, (r) => r.deviceModelFamilyId)
  const modelOverrides = indexRows(overrides, (r) => r.deviceModelId)
  const scopedExceptions = indexRows(
    exceptions,
    (r) => `${r.scope}:${r.scopeId}`,
  )

  for (const { state, snapshot } of active) {
    const device = deviceById.get(snapshot.deviceId)
    const technical = technicalByDevice.get(snapshot.deviceId)
    if (device && !technical)
      throw new Error(
        `Firmware compliance could not be resolved for ${device.id}.`,
      )
    const release = releaseById.get(snapshot.targetFirmwareReleaseId)
    const compatibility =
      device && release
        ? evaluateFirmwareCompatibility({
            model: device.deviceModel,
            release,
            at,
            rules: [
              ...(modelRules.get(device.deviceModelId) ?? []),
              ...(familyRules.get(device.deviceModel.familyId ?? '') ?? []),
            ] as FirmwareCompatibilityRule[],
            overrides: (modelOverrides.get(device.deviceModelId) ??
              []) as FirmwareCompatibilityOverride[],
          })
        : null
    const activeException =
      device && technical
        ? resolveFirmwareExceptions(
            [
              `DEVICE:${device.id}`,
              `CUSTOMER:${device.customerId}`,
              `SITE:${device.siteId}`,
              `MODEL:${device.deviceModelId}`,
              `FAMILY:${device.deviceModel.familyId}`,
            ].flatMap((key) => scopedExceptions.get(key) ?? []),
            device,
            technical,
            at,
          ).selected
        : null
    const evidence = snapshot.exceptionSnapshot
    const overriddenId =
      evidence && typeof evidence === 'object' && !Array.isArray(evidence)
        ? evidence.id
        : null
    const activeExceptionOverridden = Boolean(
      activeException &&
      snapshot.exceptionOverride &&
      overriddenId === activeException.id,
    )
    // Match preview/create's persisted fingerprint contract exactly. Legacy unknown
    // fingerprints remain reviewable; never invent missing historical assumptions.
    const observedValues = device
      ? [
          technical?.currentFirmware?.id ?? null,
          device.currentFirmwareReleaseId,
          device.currentFirmwareNormalizedVersion,
          device.currentFirmwareRawVersion,
          device.currentFirmwareObservedAt?.toISOString() ?? null,
        ]
      : []
    const current = {
      deviceMissing: !device,
      deviceModelId: device?.deviceModelId ?? '',
      observedFirmwareFingerprint: observedValues.every((v) => v == null)
        ? null
        : JSON.stringify(observedValues),
      policyFingerprint: technical?.effectivePolicy.policy
        ? policyFingerprint(technical)
        : null,
      preferredTargetFirmwareReleaseId: technical?.preferredTarget?.id ?? null,
      targetFirmwareReleaseId: release?.isActive ? release.id : null,
      targetCatalogState: release?.catalogState ?? null,
      targetCompatibilityResolved: compatibility?.status === 'COMPATIBLE',
      hasActiveException: Boolean(activeException),
    }
    results.set(snapshot.id, {
      current,
      activeException,
      activeExceptionOverridden,
      staleness: resolveFirmwareWorkPlanStaleness(state, snapshot, {
        ...current,
        // Only the exact explicitly overridden exception is already acknowledged.
        hasActiveException:
          Boolean(activeException) && !activeExceptionOverridden,
      }),
    })
  }
  return results
}
