import { prisma } from '@/lib/prisma'
import { resolveFirmwareImageForModel } from '@/lib/firmware-compatibility-store'

export type FirmwarePolicyCompatibilityImpactItem = {
  deviceModelId: string
  model: string
  status: 'RESOLVED' | 'AMBIGUOUS' | 'INCOMPATIBLE' | 'UNKNOWN'
  explanation: string
}

export type FirmwarePolicyCompatibilityImpact = {
  canApply: boolean
  reviewRequired: boolean
  results: FirmwarePolicyCompatibilityImpactItem[]
  resolved: FirmwarePolicyCompatibilityImpactItem[]
  ambiguous: FirmwarePolicyCompatibilityImpactItem[]
  incompatible: FirmwarePolicyCompatibilityImpactItem[]
  unknown: FirmwarePolicyCompatibilityImpactItem[]
}

function aggregate(results: FirmwarePolicyCompatibilityImpactItem[]): FirmwarePolicyCompatibilityImpact {
  const incompatible = results.filter((result) => result.status === 'INCOMPATIBLE')
  const ambiguous = results.filter((result) => result.status === 'AMBIGUOUS')
  const unknown = results.filter((result) => result.status === 'UNKNOWN')
  return {
    // Desired policy expresses intent. Missing/ambiguous compatibility evidence
    // must remain visible for review, but it should not make it impossible to
    // record the intended target. Only known incompatibility blocks the write.
    canApply: incompatible.length === 0,
    reviewRequired: ambiguous.length > 0 || unknown.length > 0,
    results,
    resolved: results.filter((result) => result.status === 'RESOLVED'),
    ambiguous,
    incompatible,
    unknown,
  }
}

export async function previewLogicalTargetCompatibilityForModels(
  deviceModelIds: string[],
  logicalFirmwareReleaseId: string,
  at: Date = new Date(),
): Promise<FirmwarePolicyCompatibilityImpact> {
  if (deviceModelIds.length === 0) return aggregate([])
  const models = await prisma.deviceModel.findMany({
    where: { id: { in: deviceModelIds } },
    select: { id: true, model: true },
  })
  const nameById = new Map(models.map((model) => [model.id, model.model]))
  const results: FirmwarePolicyCompatibilityImpactItem[] = []
  for (const deviceModelId of deviceModelIds) {
    const resolution = await resolveFirmwareImageForModel(deviceModelId, logicalFirmwareReleaseId, at)
    results.push({
      deviceModelId,
      model: nameById.get(deviceModelId) ?? deviceModelId,
      status: resolution.status,
      explanation: resolution.explanation,
    })
  }
  return aggregate(results)
}

export async function previewTrainCompatibilityForModels(
  deviceModelIds: string[],
  firmwareTrainId: string,
  at: Date = new Date(),
): Promise<FirmwarePolicyCompatibilityImpact> {
  if (deviceModelIds.length === 0) return aggregate([])
  const releases = await prisma.firmwareRelease.findMany({
    where: {
      firmwareTrainId,
      isActive: true,
      catalogState: { notIn: ['BLOCKED', 'WITHDRAWN'] },
      policyEligibility: { in: ['ALLOWED', 'PREFERRED'] },
    },
    orderBy: [{ logicalVersion: 'asc' }, { version: 'asc' }],
    select: { id: true, logicalVersion: true },
  })
  const representativeByLogicalVersion = new Map<string, string>()
  for (const release of releases) {
    if (!representativeByLogicalVersion.has(release.logicalVersion)) {
      representativeByLogicalVersion.set(release.logicalVersion, release.id)
    }
  }
  const representatives = [...representativeByLogicalVersion.values()]
  const models = await prisma.deviceModel.findMany({
    where: { id: { in: deviceModelIds } },
    select: { id: true, model: true },
  })
  const nameById = new Map(models.map((model) => [model.id, model.model]))
  const results: FirmwarePolicyCompatibilityImpactItem[] = []

  for (const deviceModelId of deviceModelIds) {
    const resolutions = []
    for (const releaseId of representatives) {
      resolutions.push(await resolveFirmwareImageForModel(deviceModelId, releaseId, at))
    }
    const resolved = resolutions.find((resolution) => resolution.status === 'RESOLVED')
    const ambiguous = resolutions.find((resolution) => resolution.status === 'AMBIGUOUS')
    const unknown = resolutions.find((resolution) => resolution.status === 'UNKNOWN')
    const status: FirmwarePolicyCompatibilityImpactItem['status'] = resolved
      ? 'RESOLVED'
      : ambiguous
        ? 'AMBIGUOUS'
        : unknown
          ? 'UNKNOWN'
          : 'INCOMPATIBLE'
    const explanation = resolved?.explanation
      ?? ambiguous?.explanation
      ?? unknown?.explanation
      ?? (representatives.length === 0
        ? 'The selected train has no active policy-eligible canonical releases to evaluate.'
        : 'No compatible policy-eligible release path in the selected train is proven for this model.')
    results.push({ deviceModelId, model: nameById.get(deviceModelId) ?? deviceModelId, status, explanation })
  }

  return aggregate(results)
}

export function describeCompatibilityImpact(impact: FirmwarePolicyCompatibilityImpact) {
  if (impact.incompatible.length > 0) {
    const sample = impact.incompatible.slice(0, 5).map((result) => `${result.model}: INCOMPATIBLE`).join(', ')
    const remainder = impact.incompatible.length > 5 ? `, +${impact.incompatible.length - 5} more` : ''
    return `Firmware is explicitly incompatible with ${impact.incompatible.length} affected model(s): ${sample}${remainder}.`
  }
  if (impact.reviewRequired) {
    const review = [...impact.ambiguous, ...impact.unknown]
    const sample = review.slice(0, 5).map((result) => `${result.model}: ${result.status}`).join(', ')
    const remainder = review.length > 5 ? `, +${review.length - 5} more` : ''
    return `Firmware policy may be recorded, but compatibility review is still required for ${review.length} affected model(s): ${sample}${remainder}.`
  }
  return 'All affected models have one resolvable compatible firmware path.'
}
