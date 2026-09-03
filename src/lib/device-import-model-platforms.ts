import { normalizeImportText } from '@/lib/device-import'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function cleanPlatform(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

export async function synchronizeImportedModelPlatforms(batchId: string) {
  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'DEVICE_MODEL', status: 'LINKED', targetId: { not: null } },
    select: { targetId: true, metadata: true },
  })
  const modelIds = [...new Set(references.map((reference) => reference.targetId).filter((id): id is string => Boolean(id)))]
  if (!modelIds.length) return { models: 0, platformsAdded: 0 }

  const models = await prisma.deviceModel.findMany({
    where: { id: { in: modelIds } },
    select: {
      id: true,
      platform: true,
      supportedPlatforms: { select: { platform: true } },
    },
  })
  const modelById = new Map(models.map((model) => [model.id, model]))
  const inferredByModel = new Map<string, Map<string, string>>()

  for (const reference of references) {
    if (!reference.targetId) continue
    const values = metadata(reference.metadata).platforms ?? []
    const single = metadata(reference.metadata).platform
    const candidates = single ? [...values, single] : values
    const map = inferredByModel.get(reference.targetId) ?? new Map<string, string>()
    for (const candidate of candidates) {
      const cleaned = cleanPlatform(candidate)
      if (cleaned) map.set(normalizeImportText(cleaned), cleaned)
    }
    inferredByModel.set(reference.targetId, map)
  }

  const creates: Array<{ deviceModelId: string; platform: string }> = []
  const defaultUpdates: Array<{ id: string; platform: string }> = []
  for (const [modelId, inferred] of inferredByModel) {
    const model = modelById.get(modelId)
    if (!model) continue
    const existing = new Set(model.supportedPlatforms.map((entry) => normalizeImportText(entry.platform)))
    const preferred = cleanPlatform(model.platform)
    if (preferred) existing.add(normalizeImportText(preferred))
    for (const [normalized, platform] of inferred) {
      if (!existing.has(normalized)) {
        creates.push({ deviceModelId: modelId, platform })
        existing.add(normalized)
      }
    }
    if (!preferred && existing.size === 1) {
      const only = inferred.values().next().value as string | undefined
      if (only) defaultUpdates.push({ id: modelId, platform: only })
    }
  }

  if (creates.length) await prisma.deviceModelPlatform.createMany({ data: creates, skipDuplicates: true })
  for (const update of defaultUpdates) {
    await prisma.deviceModel.update({ where: { id: update.id }, data: { platform: update.platform } })
  }
  return { models: inferredByModel.size, platformsAdded: creates.length }
}
