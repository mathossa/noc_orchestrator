import { normalizeImportText } from '@/lib/device-import'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { refreshDeviceImportBatchReferences } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

const ROW_SAMPLE = 20

type ModelReference = {
  id: string
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  metadata: unknown
  status: string
  targetId: string | null
  suggestedTargetId: string | null
  suggestionScore: number | null
  resolutionSource: string | null
  occurrenceCount: number
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function uniqueText(values: Array<string | null | undefined>) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const clean = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
    const normalized = normalizeImportText(clean)
    if (!clean || !normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(clean)
  }
  return result
}

function vendorSource(reference: ModelReference) {
  const meta = metadata(reference.metadata)
  if (meta.vendorSourceValue) return meta.vendorSourceValue
  const legacy = /^vendor:([^|]*)/.exec(reference.contextKey)?.[1] ?? ''
  return legacy || null
}

function groupKey(reference: ModelReference) {
  return `${normalizeImportText(vendorSource(reference))}|${reference.normalizedSourceValue}`
}

function preferredResolution(references: ModelReference[], targetId: string | null) {
  if (!targetId) return null
  const priority: Record<string, number> = { USER: 5, CREATED: 4, PROFILE_ALIAS: 3, EXACT: 2 }
  return references
    .filter((reference) => reference.status === 'LINKED' && reference.targetId === targetId)
    .sort((left, right) => (priority[right.resolutionSource ?? ''] ?? 0) - (priority[left.resolutionSource ?? ''] ?? 0))[0] ?? null
}

function mergeGroup(batchId: string, references: ModelReference[]) {
  const primary = references[0]
  const metas = references.map((reference) => metadata(reference.metadata))
  const rows = [...new Set(metas.flatMap((meta) => meta.rowNumbers ?? []))].sort((a, b) => a - b).slice(0, ROW_SAMPLE)
  const deviceTypes = uniqueText(metas.flatMap((meta) => [meta.deviceTypeSourceValue, ...(meta.deviceTypeSourceValues ?? [])]))
  const platforms = uniqueText(metas.flatMap((meta) => [meta.platform, ...(meta.platforms ?? [])]))
  const vendorTargets = uniqueText(metas.map((meta) => meta.vendorTargetId))
  const typeTargets = uniqueText(metas.map((meta) => meta.deviceTypeTargetId))
  const linkedTargets = uniqueText(references.filter((reference) => reference.status === 'LINKED').map((reference) => reference.targetId))
  const targetId = linkedTargets.length === 1 ? linkedTargets[0] : null
  const preferred = preferredResolution(references, targetId)
  const sourceVendor = vendorSource(primary)

  return {
    id: primary.id,
    batchId,
    kind: 'DEVICE_MODEL',
    sourceValue: primary.sourceValue,
    normalizedSourceValue: primary.normalizedSourceValue,
    contextKey: `vendor:${normalizeImportText(sourceVendor)}`,
    metadata: {
      ...metadata(primary.metadata),
      vendorSourceValue: sourceVendor,
      vendorTargetId: vendorTargets.length === 1 ? vendorTargets[0] : null,
      deviceTypeSourceValue: deviceTypes[0] ?? null,
      deviceTypeSourceValues: deviceTypes,
      deviceTypeTargetId: typeTargets.length === 1 ? typeTargets[0] : null,
      platform: platforms.length === 1 ? platforms[0] : null,
      platforms,
      rowNumbers: rows,
      waitingFor: [],
    },
    status: targetId ? 'LINKED' : 'UNRESOLVED',
    targetId,
    suggestedTargetId: null,
    suggestionScore: null,
    resolutionSource: targetId ? preferred?.resolutionSource ?? 'USER' : null,
    occurrenceCount: references.reduce((sum, reference) => sum + reference.occurrenceCount, 0),
  }
}

export async function repairDuplicateDeviceImportModelReferences(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { status: true } })
  if (!batch || batch.status === 'PUBLISHED') return 0
  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'DEVICE_MODEL' },
    orderBy: [{ normalizedSourceValue: 'asc' }, { contextKey: 'asc' }],
    select: {
      id: true, sourceValue: true, normalizedSourceValue: true, contextKey: true, metadata: true,
      status: true, targetId: true, suggestedTargetId: true, suggestionScore: true, resolutionSource: true, occurrenceCount: true,
    },
  }) as ModelReference[]

  const groups = new Map<string, ModelReference[]>()
  for (const reference of references) {
    const key = groupKey(reference)
    const current = groups.get(key) ?? []
    current.push(reference)
    groups.set(key, current)
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1)
  if (!duplicates.length) return 0

  const ids = duplicates.flatMap((group) => group.map((reference) => reference.id))
  const replacements = duplicates.map((group) => mergeGroup(batchId, group))
  await prisma.$transaction(async (tx) => {
    await tx.deviceImportStagedReference.deleteMany({ where: { id: { in: ids } } })
    await tx.deviceImportStagedReference.createMany({ data: replacements })
  })
  await refreshDeviceImportBatchReferences(batchId)
  return duplicates.length
}
