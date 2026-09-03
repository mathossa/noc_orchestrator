import { extractFirmwareVersion, normalizeImportText } from '@/lib/device-import'
import { classifyImportedDeviceModel, splitFirmwareVersionVariant } from '@/lib/device-import-normalization'
import {
  applyDeviceImportFirmwareTransforms,
  applyDeviceImportPredictionRules,
  selectDeviceImportFirmwareSource,
  type DeviceImportFirmwareSource,
  type DeviceImportPredictionRule,
} from '@/lib/device-import-profile-predictions'
import {
  bestImportReferenceSuggestion,
  type DeviceImportMappedValues,
  type DeviceImportStagedReferenceMetadata,
} from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'

type PlatformModel = {
  vendorId: string
  model?: string
  platform: string | null
  supportedPlatforms: Array<{ platform: string }>
}

type PlatformRelease = {
  id: string
  vendorId: string
  platform: string
  version: string
}

type FirmwareReference = {
  id: string
  kind: string
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  metadata: unknown
  status: string
  targetId: string | null
  suggestedTargetId: string | null
  suggestionScore: number | null
  resolutionSource: string | null
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
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

export function stagedFirmwareLegacyRawContext(values: DeviceImportMappedValues) {
  return `vendor:${normalizeImportText(values.vendor)}|model:${normalizeImportText(values.model)}|platform:${normalizeImportText(values.platform)}`
}

export function stagedFirmwareEvidenceContext(values: DeviceImportMappedValues) {
  const base = stagedFirmwareLegacyRawContext(values)
  const firmwareVersion = normalizeImportText(values.firmwareVersion)
  const softwareVersion = normalizeImportText(values.softwareVersion)
  if (!firmwareVersion && !softwareVersion) return base
  return `${base}|firmware-version:${firmwareVersion}|software-version:${softwareVersion}`
}

function uniqueEvidence(values: Array<string | null | undefined>) {
  const result = new Map<string, string>()
  for (const value of values) {
    const cleaned = clean(value)
    if (cleaned) result.set(normalizeImportText(cleaned), cleaned)
  }
  return [...result.values()]
}

export function hasCompetingFirmwareSourceEvidence(sourceValue: string, meta: DeviceImportStagedReferenceMetadata) {
  const effective = normalizeImportText(sourceValue)
  const candidates = [
    ...(meta.firmwareVersionSourceValues ?? []),
    ...(meta.softwareVersionSourceValues ?? []),
    meta.firmwareVersionSourceValue,
    meta.softwareVersionSourceValue,
  ]
  return candidates.some((candidate) => {
    const extracted = extractFirmwareVersion(candidate ?? null)
    return Boolean(extracted) && normalizeImportText(extracted) !== effective
  })
}

export function firmwareEvidenceGroupsForReference(
  reference: Pick<FirmwareReference, 'normalizedSourceValue' | 'contextKey'>,
  rows: Array<{ rowNumber: number; values: DeviceImportMappedValues }>,
) {
  const groups = new Map<string, Array<{ rowNumber: number; values: DeviceImportMappedValues }>>()
  for (const row of rows) {
    if (normalizeImportText(row.values.currentFirmware) !== reference.normalizedSourceValue) continue
    if (stagedFirmwareLegacyRawContext(row.values) !== reference.contextKey) continue
    const key = stagedFirmwareEvidenceContext(row.values)
    const current = groups.get(key) ?? []
    current.push(row)
    groups.set(key, current)
  }
  return [...groups.entries()].map(([contextKey, groupRows]) => ({ contextKey, rows: groupRows }))
}

function needsSourceSplit(reference: FirmwareReference) {
  if (reference.contextKey.includes('|firmware-version:')) return false
  const meta = metadata(reference.metadata)
  return uniqueEvidence(meta.firmwareVersionSourceValues ?? []).length > 1 ||
    uniqueEvidence(meta.softwareVersionSourceValues ?? []).length > 1
}

async function splitCollapsedFirmwareSourceReferences(batchId: string, references: FirmwareReference[]) {
  const candidates = references.filter((reference) => reference.kind === 'FIRMWARE_RELEASE' && needsSourceSplit(reference))
  if (!candidates.length) return 0

  const stagedRows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId, status: 'STAGED' },
    orderBy: { rowNumber: 'asc' },
    select: { rowNumber: true, mappedData: true },
  })
  const rows = stagedRows.map((row) => ({
    rowNumber: row.rowNumber,
    values: row.mappedData as unknown as DeviceImportMappedValues,
  }))
  const replacements = []
  const deleteIds: string[] = []

  for (const reference of candidates) {
    const groups = firmwareEvidenceGroupsForReference(reference, rows)
    if (groups.length <= 1) continue
    const current = metadata(reference.metadata)
    deleteIds.push(reference.id)

    for (const group of groups) {
      const first = group.rows[0].values
      const firmwareVersions = uniqueEvidence(group.rows.map((row) => row.values.firmwareVersion))
      const softwareVersions = uniqueEvidence(group.rows.map((row) => row.values.softwareVersion))
      const rawPlatform = clean(first.platform)
      replacements.push({
        batchId,
        kind: 'FIRMWARE_RELEASE',
        sourceValue: clean(first.currentFirmware) ?? reference.sourceValue,
        normalizedSourceValue: normalizeImportText(first.currentFirmware ?? reference.sourceValue),
        contextKey: group.contextKey,
        occurrenceCount: group.rows.length,
        metadata: {
          ...current,
          vendorSourceValue: clean(first.vendor) ?? current.vendorSourceValue ?? null,
          modelSourceValue: clean(first.model) ?? current.modelSourceValue ?? null,
          platform: current.platform ?? rawPlatform,
          platforms: current.platforms?.length ? current.platforms : rawPlatform ? [rawPlatform] : [],
          firmwareVersionSourceValue: clean(first.firmwareVersion),
          firmwareVersionSourceValues: firmwareVersions,
          softwareVersionSourceValue: clean(first.softwareVersion),
          softwareVersionSourceValues: softwareVersions,
          rowNumbers: group.rows.slice(0, 20).map((row) => row.rowNumber),
          waitingFor: current.waitingFor ?? [],
        },
        status: 'UNRESOLVED',
        targetId: null,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: null,
      })
    }
  }

  if (!deleteIds.length) return 0
  await prisma.$transaction(async (tx) => {
    await tx.deviceImportStagedReference.deleteMany({ where: { id: { in: deleteIds } } })
    await tx.deviceImportStagedReference.createMany({ data: replacements, skipDuplicates: true })
  })
  return deleteIds.length
}

function majorVersion(sourceValue: string) {
  const match = sourceValue.normalize('NFKC').trim().match(/^v?(\d+)(?:\.|$)/i)
  return match ? Number(match[1]) : null
}

function inferAosPlatformFromVersion(sourceValue: string, supported: Map<string, string>) {
  const major = majorVersion(sourceValue)
  if (major !== 8 && major !== 10) return null

  const aos8 = normalizedPlatform('AOS-8')
  const aos10 = normalizedPlatform('AOS-10')
  const hasAosFamily = supported.has(aos8) || supported.has(aos10)
  if (!hasAosFamily) return null

  const expected = major === 8 ? aos8 : aos10
  return supported.get(expected) ?? (major === 8 ? 'AOS-8' : 'AOS-10')
}

export function resolveStagedFirmwarePlatform(
  meta: DeviceImportStagedReferenceMetadata,
  model: PlatformModel,
  sourceValue = '',
  releases: PlatformRelease[] = [],
) {
  const imported = importedPlatformSet(meta)
  if (imported.size === 1) return [...imported.values()][0]
  if (imported.size > 1) return null

  const supported = platformSet(model)
  const aosPlatform = inferAosPlatformFromVersion(sourceValue, supported)
  if (aosPlatform) return aosPlatform
  if (supported.size === 1) return [...supported.values()][0]

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

export function canDeferUnclassifiedFirmwarePlatform(
  meta: DeviceImportStagedReferenceMetadata,
  model: Pick<PlatformModel, 'platform' | 'supportedPlatforms'>,
) {
  return importedPlatformSet(meta).size === 0 && platformSet(model).size === 0
}

function builtInFirmwareSource(modelName: string, platform: string | null): DeviceImportFirmwareSource | null {
  const classification = classifyImportedDeviceModel(modelName)
  if (classification?.classificationKey === 'CISCO_SX350' || normalizedPlatform(platform) === 'sx350') return 'SOFTWARE_VERSION'
  return null
}

function interpretedFirmwareVersion(
  reference: FirmwareReference,
  meta: DeviceImportStagedReferenceMetadata,
  model: PlatformModel,
  platform: string | null,
  rules: DeviceImportPredictionRule[],
) {
  const modelName = meta.modelSourceValue ?? model.model ?? ''
  const applied = applyDeviceImportPredictionRules({
    vendor: meta.vendorSourceValue,
    model: modelName,
    platform,
    firmware: reference.sourceValue,
    firmwareVersion: meta.firmwareVersionSourceValue,
    softwareVersion: meta.softwareVersionSourceValue,
  }, rules)
  const source = applied.prediction.firmwareSource ?? builtInFirmwareSource(modelName, platform) ?? 'EFFECTIVE'
  const selected = selectDeviceImportFirmwareSource({
    effective: reference.sourceValue,
    firmwareVersion: meta.firmwareVersionSourceValue,
    softwareVersion: meta.softwareVersionSourceValue,
  }, source)
  return applyDeviceImportFirmwareTransforms(selected, applied.prediction.firmwareTransforms)
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

async function loadReferences(batchId: string) {
  return prisma.deviceImportStagedReference.findMany({
    where: { batchId },
    select: {
      id: true,
      kind: true,
      sourceValue: true,
      normalizedSourceValue: true,
      contextKey: true,
      metadata: true,
      status: true,
      targetId: true,
      suggestedTargetId: true,
      suggestionScore: true,
      resolutionSource: true,
    },
  }) as Promise<FirmwareReference[]>
}

export async function resolveStagedFirmwarePlatforms(batchId: string) {
  const [batch, initialReferences] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { profileId: true, status: true } }),
    loadReferences(batchId),
  ])
  if (!batch || batch.status === 'PUBLISHED') return { updated: 0 }

  const splitCount = await splitCollapsedFirmwareSourceReferences(batchId, initialReferences)
  const references = splitCount ? await loadReferences(batchId) : initialReferences
  const firmwareReferences = references.filter((reference) => reference.kind === 'FIRMWARE_RELEASE')
  if (!firmwareReferences.length) return { updated: splitCount }

  const modelIds = [...new Set(firmwareReferences.map((reference) => metadata(reference.metadata).modelTargetId).filter((id): id is string => Boolean(id)))]
  const [models, releases, aliases, profileRules] = await Promise.all([
    modelIds.length ? prisma.deviceModel.findMany({
      where: { id: { in: modelIds } },
      select: {
        id: true,
        vendorId: true,
        model: true,
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
    batch.profileId ? prisma.deviceImportProfileRule.findMany({
      where: { profileId: batch.profileId, isActive: true, action: 'PREDICT' },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, action: true, field: true, operator: true, value: true, normalizedValue: true, result: true, priority: true, isActive: true },
    }) as Promise<DeviceImportPredictionRule[]> : Promise.resolve([]),
  ])
  const modelById = new Map(models.map((model) => [model.id, model]))
  let updated = splitCount

  for (const reference of firmwareReferences) {
    const meta = metadata(reference.metadata)
    const model = meta.modelTargetId ? modelById.get(meta.modelTargetId) : null
    if (!model) continue

    const preliminaryFirmware = interpretedFirmwareVersion(reference, meta, model, meta.platform ?? model.platform, profileRules)
    const platform = resolveStagedFirmwarePlatform(meta, model, preliminaryFirmware, releases)
    const interpreted = interpretedFirmwareVersion(reference, meta, model, platform, profileRules)
    const selectedVersion = splitFirmwareVersionVariant(platform ?? '', interpreted).version
    const nextMetadata: DeviceImportStagedReferenceMetadata = {
      ...meta,
      modelTargetId: model.id,
      vendorTargetId: model.vendorId,
      platform,
      waitingFor: [],
    }

    if (!platform) {
      const unclassified = canDeferUnclassifiedFirmwarePlatform(meta, model)
      const next = {
        status: unclassified ? 'LINKED' : 'UNRESOLVED',
        targetId: null,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: unclassified ? 'UNCLASSIFIED_NO_PLATFORM' : null,
        metadata: nextMetadata,
      }
      if (needsUpdate(reference, next)) {
        await prisma.deviceImportStagedReference.update({ where: { id: reference.id }, data: next })
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
    const sourceDiffersFromRaw = normalizeImportText(selectedVersion) !== reference.normalizedSourceValue
    const remembered = sourceDiffersFromRaw ? null : aliases.find((alias) =>
      alias.normalizedSourceValue === reference.normalizedSourceValue && alias.contextKey === contextKey,
    )?.targetId ?? null
    const rememberedTarget = remembered ? compatible.find((release) => release.id === remembered) ?? null : null
    const exact = compatible.filter((release) => normalizeImportText(release.version) === normalizeImportText(selectedVersion))
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
        await prisma.deviceImportStagedReference.update({ where: { id: reference.id }, data: next })
        updated += 1
      }
      continue
    }

    const best = bestImportReferenceSuggestion(selectedVersion, compatible, (release) => release.version)
    const next = {
      status: 'UNRESOLVED',
      targetId: null,
      suggestedTargetId: best?.candidate.id ?? null,
      suggestionScore: best?.score ?? null,
      resolutionSource: null,
      metadata: nextMetadata,
    }
    if (needsUpdate(reference, next)) {
      await prisma.deviceImportStagedReference.update({ where: { id: reference.id }, data: next })
      updated += 1
    }
  }

  const unresolved = await prisma.deviceImportStagedReference.count({ where: { batchId, status: { not: 'LINKED' } } })
  await prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: unresolved === 0 ? 'READY' : 'STAGED' } })
  return { updated }
}
