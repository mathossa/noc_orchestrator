import { normalizeImportText } from '@/lib/device-import'
import { bestImportReferenceSuggestion, type DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'

type PlatformModel = {
  vendorId: string
  platform: string | null
  supportedPlatforms: Array<{ platform: string }>
}

type PlatformRelease = {
  id: string
  vendorId: string
  platform: string
  version: string
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function platformSet(model: Pick<PlatformModel, 'platform' | 'supportedPlatforms'>) {
  const values = new Map<string, string>()
  if (model.platform) values.set(normalizedPlatform(model.platform), model.platform)
  for (const entry of model.supportedPlatforms) values.set(normalizedPlatform(entry.platform), entry.platform)
  values.delete('')
  return values
}

function importedPlatformSet(meta: DeviceImportStagedReferenceMetadata) {
  const values = new Map<string, string>()
  for (const platform of meta.platforms ?? []) {
    if (platform) values.set(normalizedPlatform(platform), platform)
  }
  values.delete('')
  return values
}

export function resolveStagedFirmwarePlatform(
  meta: DeviceImportStagedReferenceMetadata,
  model: PlatformModel,
  sourceValue = '',
  releases: PlatformRelease[] = [],
) {
  // `platforms` is the durable evidence collected from staged source rows. It
  // deliberately wins over `metadata.platform`, because older resolver passes
  // could have filled that field from the legacy DeviceModel.platform default.
  const imported = importedPlatformSet(meta)
  if (imported.size === 1) return [...imported.values()][0]
  if (imported.size > 1) return null

  if (meta.platform) return meta.platform

  const supported = platformSet(model)
  if (supported.size === 1) return [...supported.values()][0]

  // For a multi-platform model, a version can safely identify the platform only
  // when that exact version exists on exactly one of the model's supported
  // platforms. Otherwise the platform stays review-only.
  if (sourceValue && supported.size > 1) {
    const exactPlatforms = new Map<string, string>()
    for (const release of releases) {
      if (release.vendorId !== model.vendorId) continue
      if (normalizeImportText(release.version) !== normalizeImportText(sourceValue)) continue
      const normalized = normalizedPlatform(release.platform)
      if (supported.has(normalized)) exactPlatforms.set(normalized, release.platform)
    }
    if (exactPlatforms.size === 1) return [...exactPlatforms.values()][0]
  }

  return null
}

function needsUpdate(
  reference: {
    status: string
    targetId: string | null
    suggestedTargetId: string | null
    suggestionScore: number | null
    resolutionSource: string | null
    metadata: unknown
  },
  next: {
    status: string
    targetId: string | null
    suggestedTargetId: string | null
    suggestionScore: number | null
    resolutionSource: string | null
    metadata: DeviceImportStagedReferenceMetadata
  },
) {
  const current = metadata(reference.metadata)
  return reference.status !== next.status ||
    reference.targetId !== next.targetId ||
    reference.suggestedTargetId !== next.suggestedTargetId ||
    reference.suggestionScore !== next.suggestionScore ||
    reference.resolutionSource !== next.resolutionSource ||
    current.modelTargetId !== next.metadata.modelTargetId ||
    current.vendorTargetId !== next.metadata.vendorTargetId ||
    current.platform !== next.metadata.platform ||
    JSON.stringify(current.waitingFor ?? []) !== JSON.stringify(next.metadata.waitingFor ?? [])
}

export async function resolveStagedFirmwarePlatforms(batchId: string) {
  const [batch, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { profileId: true, status: true } }),
    prisma.deviceImportStagedReference.findMany({
      where: { batchId },
      select: {
        id: true,
        kind: true,
        sourceValue: true,
        normalizedSourceValue: true,
        metadata: true,
        status: true,
        targetId: true,
        suggestedTargetId: true,
        suggestionScore: true,
        resolutionSource: true,
      },
    }),
  ])
  if (!batch || batch.status === 'PUBLISHED') return { updated: 0 }

  const firmwareReferences = references.filter((reference) => reference.kind === 'FIRMWARE_RELEASE')
  if (!firmwareReferences.length) return { updated: 0 }
  const modelIds = [...new Set(firmwareReferences.map((reference) => metadata(reference.metadata).modelTargetId).filter((id): id is string => Boolean(id)))]
  const [models, releases, aliases] = await Promise.all([
    modelIds.length ? prisma.deviceModel.findMany({
      where: { id: { in: modelIds } },
      select: {
        id: true,
        vendorId: true,
        platform: true,
        supportedPlatforms: { select: { platform: true } },
      },
    }) : Promise.resolve([]),
    prisma.firmwareRelease.findMany({
      where: { isActive: true },
      select: { id: true, vendorId: true, platform: true, version: true },
    }),
    batch.profileId ? prisma.deviceImportProfileAlias.findMany({
      where: { profileId: batch.profileId, kind: 'FIRMWARE_RELEASE' },
      select: { normalizedSourceValue: true, contextKey: true, targetId: true },
    }) : Promise.resolve([]),
  ])
  const modelById = new Map(models.map((model) => [model.id, model]))
  let updated = 0

  for (const reference of firmwareReferences) {
    const meta = metadata(reference.metadata)
    const model = meta.modelTargetId ? modelById.get(meta.modelTargetId) : null
    if (!model) continue
    const platform = resolveStagedFirmwarePlatform(meta, model, reference.sourceValue, releases)
    const nextMetadata: DeviceImportStagedReferenceMetadata = {
      ...meta,
      modelTargetId: model.id,
      vendorTargetId: model.vendorId,
      platform,
      waitingFor: [],
    }

    if (!platform) {
      const next = {
        status: 'UNRESOLVED',
        targetId: null,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: null,
        metadata: nextMetadata,
      }
      if (needsUpdate(reference, next)) {
        await prisma.deviceImportStagedReference.update({
          where: { id: reference.id },
          data: next,
        })
        updated += 1
      }
      continue
    }

    const contextKey = `${model.vendorId}|${normalizedPlatform(platform)}`
    const compatible = releases.filter((release) =>
      release.vendorId === model.vendorId && normalizedPlatform(release.platform) === normalizedPlatform(platform),
    )
    const manualTarget = reference.targetId && ['USER', 'CREATED'].includes(reference.resolutionSource ?? '')
      ? compatible.find((release) => release.id === reference.targetId) ?? null
      : null
    const remembered = aliases.find((alias) =>
      alias.normalizedSourceValue === reference.normalizedSourceValue && alias.contextKey === contextKey,
    )?.targetId ?? null
    const rememberedTarget = remembered ? compatible.find((release) => release.id === remembered) ?? null : null
    const exact = compatible.filter((release) => normalizeImportText(release.version) === reference.normalizedSourceValue)
    const target = manualTarget ?? rememberedTarget ?? (exact.length === 1 ? exact[0] : null)

    if (target) {
      const source = manualTarget
        ? reference.resolutionSource
        : rememberedTarget
          ? 'PROFILE_ALIAS'
          : 'EXACT'
      const next = {
        status: 'LINKED',
        targetId: target.id,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: source,
        metadata: nextMetadata,
      }
      if (needsUpdate(reference, next)) {
        await prisma.deviceImportStagedReference.update({
          where: { id: reference.id },
          data: next,
        })
        updated += 1
      }
      continue
    }

    const best = bestImportReferenceSuggestion(reference.sourceValue, compatible, (release) => release.version)
    const next = {
      status: 'UNRESOLVED',
      targetId: null,
      suggestedTargetId: best?.candidate.id ?? null,
      suggestionScore: best?.score ?? null,
      resolutionSource: null,
      metadata: nextMetadata,
    }
    if (needsUpdate(reference, next)) {
      await prisma.deviceImportStagedReference.update({
        where: { id: reference.id },
        data: next,
      })
      updated += 1
    }
  }

  const unresolved = await prisma.deviceImportStagedReference.count({ where: { batchId, status: { not: 'LINKED' } } })
  await prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: unresolved === 0 ? 'READY' : 'STAGED' } })
  return { updated }
}
