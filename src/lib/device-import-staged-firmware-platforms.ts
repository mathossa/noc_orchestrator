import { normalizeImportText } from '@/lib/device-import'
import { bestImportReferenceSuggestion, type DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function platformSet(model: { platform: string | null; supportedPlatforms: Array<{ platform: string }> }) {
  const values = new Map<string, string>()
  if (model.platform) values.set(normalizedPlatform(model.platform), model.platform)
  for (const entry of model.supportedPlatforms) values.set(normalizedPlatform(entry.platform), entry.platform)
  values.delete('')
  return values
}

function stagedPlatform(meta: DeviceImportStagedReferenceMetadata, model: { platform: string | null; supportedPlatforms: Array<{ platform: string }> }) {
  if (meta.platform) return meta.platform
  const imported = new Map((meta.platforms ?? []).map((value) => [normalizedPlatform(value), value]))
  imported.delete('')
  if (imported.size === 1) return [...imported.values()][0]
  const supported = platformSet(model)
  if (supported.size === 1) return [...supported.values()][0]
  return null
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
    const platform = stagedPlatform(meta, model)
    const nextMetadata = {
      ...meta,
      vendorTargetId: model.vendorId,
      platform,
      waitingFor: [],
    }
    if (!platform) {
      if (reference.status !== 'UNRESOLVED' || reference.targetId || meta.platform) {
        await prisma.deviceImportStagedReference.update({
          where: { id: reference.id },
          data: {
            status: 'UNRESOLVED',
            targetId: null,
            suggestedTargetId: null,
            suggestionScore: null,
            resolutionSource: null,
            metadata: nextMetadata,
          },
        })
        updated += 1
      }
      continue
    }

    const contextKey = `${model.vendorId}|${normalizedPlatform(platform)}`
    const compatible = releases.filter((release) =>
      release.vendorId === model.vendorId && normalizedPlatform(release.platform) === normalizedPlatform(platform),
    )
    const remembered = aliases.find((alias) =>
      alias.normalizedSourceValue === reference.normalizedSourceValue && alias.contextKey === contextKey,
    )?.targetId ?? null
    const rememberedTarget = remembered ? compatible.find((release) => release.id === remembered) ?? null : null
    const exact = compatible.filter((release) => normalizeImportText(release.version) === reference.normalizedSourceValue)
    const manualTarget = reference.targetId && ['USER', 'CREATED'].includes(reference.resolutionSource ?? '')
      ? compatible.find((release) => release.id === reference.targetId) ?? null
      : null
    const target = rememberedTarget ?? (exact.length === 1 ? exact[0] : null) ?? manualTarget

    if (target) {
      const source = rememberedTarget ? 'PROFILE_ALIAS' : exact.length === 1 && target.id === exact[0].id ? 'EXACT' : reference.resolutionSource
      await prisma.deviceImportStagedReference.update({
        where: { id: reference.id },
        data: {
          status: 'LINKED',
          targetId: target.id,
          suggestedTargetId: null,
          suggestionScore: null,
          resolutionSource: source,
          metadata: nextMetadata,
        },
      })
      updated += 1
      continue
    }

    const best = bestImportReferenceSuggestion(reference.sourceValue, compatible, (release) => release.version)
    await prisma.deviceImportStagedReference.update({
      where: { id: reference.id },
      data: {
        status: 'UNRESOLVED',
        targetId: null,
        suggestedTargetId: best?.candidate.id ?? null,
        suggestionScore: best?.score ?? null,
        resolutionSource: null,
        metadata: nextMetadata,
      },
    })
    updated += 1
  }

  const unresolved = await prisma.deviceImportStagedReference.count({ where: { batchId, status: { not: 'LINKED' } } })
  await prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: unresolved === 0 ? 'READY' : 'STAGED' } })
  return { updated }
}
