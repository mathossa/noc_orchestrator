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
  results: FirmwarePolicyCompatibilityImpactItem[]
  resolved: FirmwarePolicyCompatibilityImpactItem[]
  ambiguous: FirmwarePolicyCompatibilityImpactItem[]
  incompatible: FirmwarePolicyCompatibilityImpactItem[]
  unknown: FirmwarePolicyCompatibilityImpactItem[]
}

function aggregate(results: FirmwarePolicyCompatibilityImpactItem[]): FirmwarePolicyCompatibilityImpact {
  return {
    canApply: results.every((result) => result.status === 'RESOLVED'),
    results,
    resolved: results.filter((result) => result.status === 'RESOLVED'),
    ambiguous: results.filter((result) => result.status === 'AMBIGUOUS'),
    incompatible: results.filter((result) => result.status === 'INCOMPATIBLE'),
    unknown: results.filter((result) => result.status === 'UNKNOWN'),
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
  const unresolved = impact.results.filter((result) => result.status !== 'RESOLVED')
  if (unresolved.length === 0) return 'All affected models have one resolvable compatible firmware path.'
  const sample = unresolved.slice(0, 5).map((result) => `${result.model}: ${result.status}`).join(', ')
  const remainder = unresolved.length > 5 ? `, +${unresolved.length - 5} more` : ''
  return `Firmware compatibility is unresolved for ${unresolved.length} affected model(s): ${sample}${remainder}.`
}
