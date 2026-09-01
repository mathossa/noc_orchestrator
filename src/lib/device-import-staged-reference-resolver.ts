import { normalizeImportText, type DeviceImportReferenceKind } from '@/lib/device-import'
import { saveImportReferenceAlias } from '@/lib/device-import-reference-store'
import { getDeviceImportBatchWorkspace, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import { stagedReferenceDependsOn } from '@/lib/device-import-staging-dependencies'
import {
  bestImportReferenceSuggestion,
  type DeviceImportStagedReferenceMetadata,
} from '@/lib/device-import-staging'
import { normalizedPlatform } from '@/lib/devices'
import { prisma } from '@/lib/prisma'

const UPDATE_CONCURRENCY = 25

type BatchRecord = {
  id: string
  profileId: string | null
  status: string
}

type StagedReferenceRecord = {
  id: string
  batchId: string
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
  occurrenceCount: number
}

type AliasRef = {
  kind: string
  normalizedSourceValue: string
  contextKey: string
  targetId: string
}

type SiteRef = {
  id: string
  customerId: string
  code: string | null
  name: string
  isActive: boolean
}

type ModelRef = {
  id: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string | null
  isActive: boolean
  vendor: { id: string; name: string }
  deviceType: { id: string; name: string }
}

type FirmwareRef = {
  id: string
  vendorId: string
  platform: string
  version: string
  isActive: boolean
}

type IncrementalUniverse = {
  sites: SiteRef[]
  models: ModelRef[]
  firmwareReleases: FirmwareRef[]
  aliases: AliasRef[]
}

type ResolvedReferenceState = {
  status: 'UNRESOLVED' | 'WAITING' | 'LINKED'
  targetId: string | null
  suggestedTargetId: string | null
  suggestionScore: number | null
  resolutionSource: string | null
  metadata: DeviceImportStagedReferenceMetadata
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? (value as DeviceImportStagedReferenceMetadata) : {}
}

function sameSource(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right) && normalizeImportText(left) === normalizeImportText(right)
}

function aliasContext(reference: StagedReferenceRecord) {
  const meta = metadata(reference.metadata)
  if (reference.kind === 'SITE') return meta.customerTargetId ?? ''
  if (reference.kind === 'DEVICE_MODEL') return meta.vendorTargetId ?? ''
  if (reference.kind === 'FIRMWARE_RELEASE') {
    return meta.vendorTargetId ? `${meta.vendorTargetId}|${normalizedPlatform(meta.platform ?? '')}` : ''
  }
  return ''
}

async function validateOneTimeTarget(reference: StagedReferenceRecord, targetId: string) {
  const kind = reference.kind as DeviceImportReferenceKind
  const meta = metadata(reference.metadata)

  if (kind === 'CUSTOMER') {
    const target = await prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError('The selected customer no longer exists or is archived.')
    return
  }
  if (kind === 'SITE') {
    const target = await prisma.site.findUnique({ where: { id: targetId }, select: { id: true, customerId: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError('The selected site no longer exists or is archived.')
    if (!meta.customerTargetId || target.customerId !== meta.customerTargetId) {
      throw new DeviceImportStagingError('The selected site belongs to another customer.')
    }
    return
  }
  if (kind === 'VENDOR') {
    const target = await prisma.vendor.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError('The selected vendor no longer exists or is archived.')
    return
  }
  if (kind === 'DEVICE_TYPE') {
    const target = await prisma.deviceType.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError('The selected device type no longer exists or is archived.')
    return
  }
  if (kind === 'DEVICE_MODEL') {
    const target = await prisma.deviceModel.findUnique({
      where: { id: targetId },
      select: { id: true, vendorId: true, deviceTypeId: true, isActive: true },
    })
    if (!target || !target.isActive) throw new DeviceImportStagingError('The selected model no longer exists or is archived.')
    if (meta.vendorTargetId && target.vendorId !== meta.vendorTargetId) {
      throw new DeviceImportStagingError('The selected model belongs to another vendor.')
    }
    if (meta.deviceTypeTargetId && target.deviceTypeId !== meta.deviceTypeTargetId) {
      throw new DeviceImportStagingError('The selected model belongs to another device type.')
    }
    return
  }
  if (kind === 'CONTRACT_TYPE') {
    const target = await prisma.contractType.findUnique({ where: { id: targetId }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new DeviceImportStagingError('The selected contract type no longer exists or is archived.')
    return
  }

  const target = await prisma.firmwareRelease.findUnique({
    where: { id: targetId },
    select: { id: true, vendorId: true, platform: true, isActive: true },
  })
  if (!target || !target.isActive) throw new DeviceImportStagingError('The selected firmware release no longer exists or is archived.')
  if (meta.vendorTargetId && target.vendorId !== meta.vendorTargetId) {
    throw new DeviceImportStagingError('The selected firmware belongs to another vendor.')
  }
  if (meta.platform && normalizedPlatform(target.platform) !== normalizedPlatform(meta.platform)) {
    throw new DeviceImportStagingError('The selected firmware is not compatible with the resolved model platform.')
  }
}

function exactNameOrCode(value: string, records: Array<{ name: string; code?: string | null }>) {
  const normalized = normalizeImportText(value)
  return records.filter((record) =>
    normalizeImportText(record.name) === normalized || normalizeImportText(record.code) === normalized,
  )
}

function profileAliasTarget(
  kind: DeviceImportReferenceKind,
  sourceValue: string,
  contextKey: string,
  aliases: AliasRef[],
) {
  const normalizedSourceValue = normalizeImportText(sourceValue)
  return aliases.find((alias) =>
    alias.kind === kind &&
    alias.normalizedSourceValue === normalizedSourceValue &&
    alias.contextKey === contextKey,
  )?.targetId ?? null
}

function suggestion<T extends { id: string }>(sourceValue: string, candidates: T[], label: (candidate: T) => string) {
  const best = bestImportReferenceSuggestion(sourceValue, candidates, label)
  return best ? { targetId: best.candidate.id, score: best.score } : { targetId: null, score: null }
}

function findParent(
  records: StagedReferenceRecord[],
  kind: DeviceImportReferenceKind,
  sourceValue: string | null | undefined,
  vendorSourceValue?: string | null,
) {
  if (!sourceValue) return null
  const normalized = normalizeImportText(sourceValue)
  const candidates = records.filter((record) => record.kind === kind && record.normalizedSourceValue === normalized)
  if (kind !== 'DEVICE_MODEL' || !vendorSourceValue) return candidates[0] ?? null
  return candidates.find((record) => sameSource(metadata(record.metadata).vendorSourceValue, vendorSourceValue)) ?? candidates[0] ?? null
}

function preserveManualTarget(
  reference: StagedReferenceRecord,
  targetIsValid: (targetId: string) => boolean,
  meta: DeviceImportStagedReferenceMetadata,
): ResolvedReferenceState | null {
  if (!reference.targetId || !['USER', 'CREATED'].includes(reference.resolutionSource ?? '')) return null
  if (!targetIsValid(reference.targetId)) return null
  return {
    status: 'LINKED',
    targetId: reference.targetId,
    suggestedTargetId: null,
    suggestionScore: null,
    resolutionSource: reference.resolutionSource,
    metadata: { ...meta, waitingFor: [] },
  }
}

function resolveSite(
  reference: StagedReferenceRecord,
  records: StagedReferenceRecord[],
  universe: IncrementalUniverse,
): ResolvedReferenceState {
  const meta = metadata(reference.metadata)
  const customer = findParent(records, 'CUSTOMER', meta.customerSourceValue)
  const customerTargetId = meta.customerTargetId ?? (customer?.status === 'LINKED' ? customer.targetId : null)
  if (!customerTargetId) {
    return {
      status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null,
      metadata: { ...meta, customerTargetId: null, waitingFor: ['CUSTOMER'] },
    }
  }

  const active = universe.sites.filter((record) => record.isActive && record.customerId === customerTargetId)
  const exact = exactNameOrCode(reference.sourceValue, active)
  if (exact.length === 1) {
    return {
      status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT',
      metadata: { ...meta, customerTargetId, waitingFor: [] },
    }
  }

  const remembered = profileAliasTarget('SITE', reference.sourceValue, customerTargetId, universe.aliases)
  if (remembered && active.some((record) => record.id === remembered)) {
    return {
      status: 'LINKED', targetId: remembered, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'PROFILE_ALIAS',
      metadata: { ...meta, customerTargetId, waitingFor: [] },
    }
  }

  const manual = preserveManualTarget(reference, (targetId) => active.some((record) => record.id === targetId), {
    ...meta, customerTargetId,
  })
  if (manual) return manual

  const best = suggestion(reference.sourceValue, active, (record) => record.name)
  return {
    status: 'UNRESOLVED', targetId: null, suggestedTargetId: best.targetId, suggestionScore: best.score, resolutionSource: null,
    metadata: { ...meta, customerTargetId, waitingFor: [] },
  }
}

function resolveModel(
  reference: StagedReferenceRecord,
  records: StagedReferenceRecord[],
  universe: IncrementalUniverse,
): ResolvedReferenceState {
  const meta = metadata(reference.metadata)
  const vendor = findParent(records, 'VENDOR', meta.vendorSourceValue)
  const deviceType = findParent(records, 'DEVICE_TYPE', meta.deviceTypeSourceValue)
  const vendorTargetId = meta.vendorTargetId ?? (vendor?.status === 'LINKED' ? vendor.targetId : null)
  const deviceTypeTargetId = meta.deviceTypeTargetId ?? (deviceType?.status === 'LINKED' ? deviceType.targetId : null)
  const waitingFor: DeviceImportReferenceKind[] = []
  if (!vendorTargetId && meta.vendorSourceValue) waitingFor.push('VENDOR')
  if (!deviceTypeTargetId && meta.deviceTypeSourceValue) waitingFor.push('DEVICE_TYPE')
  if (waitingFor.length) {
    return {
      status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null,
      metadata: { ...meta, vendorTargetId, deviceTypeTargetId, waitingFor },
    }
  }

  const active = universe.models.filter((record) =>
    record.isActive &&
    (!vendorTargetId || record.vendorId === vendorTargetId) &&
    (!deviceTypeTargetId || record.deviceTypeId === deviceTypeTargetId),
  )
  const normalized = normalizeImportText(reference.sourceValue)
  const exact = active.filter((record) =>
    normalizeImportText(record.model) === normalized ||
    normalizeImportText(`${record.vendor.name} ${record.model}`) === normalized,
  )
  if (exact.length === 1) {
    return {
      status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT',
      metadata: { ...meta, vendorTargetId, deviceTypeTargetId, platform: exact[0].platform, waitingFor: [] },
    }
  }

  const remembered = profileAliasTarget('DEVICE_MODEL', reference.sourceValue, vendorTargetId ?? '', universe.aliases)
  if (remembered && active.some((record) => record.id === remembered)) {
    const target = active.find((record) => record.id === remembered)!
    return {
      status: 'LINKED', targetId: remembered, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'PROFILE_ALIAS',
      metadata: { ...meta, vendorTargetId, deviceTypeTargetId, platform: target.platform, waitingFor: [] },
    }
  }

  const manual = preserveManualTarget(reference, (targetId) => active.some((record) => record.id === targetId), {
    ...meta, vendorTargetId, deviceTypeTargetId,
  })
  if (manual) {
    const target = active.find((record) => record.id === manual.targetId)
    return { ...manual, metadata: { ...manual.metadata, platform: target?.platform ?? meta.platform ?? null } }
  }

  const candidates = active.flatMap((record) => [
    { id: record.id, label: record.model },
    { id: record.id, label: `${record.vendor.name} ${record.model}` },
  ])
  const best = suggestion(reference.sourceValue, candidates, (record) => record.label)
  return {
    status: 'UNRESOLVED', targetId: null, suggestedTargetId: best.targetId, suggestionScore: best.score, resolutionSource: null,
    metadata: { ...meta, vendorTargetId, deviceTypeTargetId, waitingFor: [] },
  }
}

function resolveFirmware(
  reference: StagedReferenceRecord,
  records: StagedReferenceRecord[],
  universe: IncrementalUniverse,
): ResolvedReferenceState {
  const meta = metadata(reference.metadata)
  const modelReference = findParent(records, 'DEVICE_MODEL', meta.modelSourceValue, meta.vendorSourceValue)
  const modelTargetId = meta.modelTargetId ?? (modelReference?.status === 'LINKED' ? modelReference.targetId : null)
  if (!modelTargetId) {
    return {
      status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null,
      metadata: { ...meta, modelTargetId: null, waitingFor: ['DEVICE_MODEL'] },
    }
  }

  const model = universe.models.find((record) => record.id === modelTargetId)
  if (!model) {
    return {
      status: 'WAITING', targetId: null, suggestedTargetId: null, suggestionScore: null, resolutionSource: null,
      metadata: { ...meta, modelTargetId, waitingFor: ['DEVICE_MODEL'] },
    }
  }

  const platform = model.platform
  const contextKey = `${model.vendorId}|${normalizedPlatform(platform ?? '')}`
  const active = universe.firmwareReleases.filter((record) =>
    record.isActive &&
    record.vendorId === model.vendorId &&
    (!platform || normalizedPlatform(record.platform) === normalizedPlatform(platform)),
  )
  const exact = active.filter((record) => normalizeImportText(record.version) === normalizeImportText(reference.sourceValue))
  if (exact.length === 1) {
    return {
      status: 'LINKED', targetId: exact[0].id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT',
      metadata: { ...meta, modelTargetId, vendorTargetId: model.vendorId, platform, waitingFor: [] },
    }
  }

  const remembered = profileAliasTarget('FIRMWARE_RELEASE', reference.sourceValue, contextKey, universe.aliases)
  if (remembered && active.some((record) => record.id === remembered)) {
    return {
      status: 'LINKED', targetId: remembered, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'PROFILE_ALIAS',
      metadata: { ...meta, modelTargetId, vendorTargetId: model.vendorId, platform, waitingFor: [] },
    }
  }

  const manual = preserveManualTarget(reference, (targetId) => active.some((record) => record.id === targetId), {
    ...meta, modelTargetId, vendorTargetId: model.vendorId, platform,
  })
  if (manual) return manual

  const best = suggestion(reference.sourceValue, active, (record) => record.version)
  return {
    status: 'UNRESOLVED', targetId: null, suggestedTargetId: best.targetId, suggestionScore: best.score, resolutionSource: null,
    metadata: { ...meta, modelTargetId, vendorTargetId: model.vendorId, platform, waitingFor: [] },
  }
}

function resolveDependentReference(
  reference: StagedReferenceRecord,
  records: StagedReferenceRecord[],
  universe: IncrementalUniverse,
) {
  if (reference.kind === 'SITE') return resolveSite(reference, records, universe)
  if (reference.kind === 'DEVICE_MODEL') return resolveModel(reference, records, universe)
  if (reference.kind === 'FIRMWARE_RELEASE') return resolveFirmware(reference, records, universe)
  return null
}

function stateChanged(reference: StagedReferenceRecord, resolved: ResolvedReferenceState) {
  return reference.status !== resolved.status ||
    reference.targetId !== resolved.targetId ||
    reference.suggestedTargetId !== resolved.suggestedTargetId ||
    reference.suggestionScore !== resolved.suggestionScore ||
    reference.resolutionSource !== resolved.resolutionSource ||
    JSON.stringify(reference.metadata ?? null) !== JSON.stringify(resolved.metadata ?? null)
}

function applyResolvedState(reference: StagedReferenceRecord, resolved: ResolvedReferenceState) {
  reference.status = resolved.status
  reference.targetId = resolved.targetId
  reference.suggestedTargetId = resolved.suggestedTargetId
  reference.suggestionScore = resolved.suggestionScore
  reference.resolutionSource = resolved.resolutionSource
  reference.metadata = resolved.metadata
}

async function loadIncrementalUniverse(profileId: string | null): Promise<IncrementalUniverse> {
  const [sites, models, firmwareReleases, aliases] = await Promise.all([
    prisma.site.findMany({
      where: { isActive: true },
      select: { id: true, customerId: true, code: true, name: true, isActive: true },
    }),
    prisma.deviceModel.findMany({
      where: { isActive: true },
      select: {
        id: true,
        vendorId: true,
        deviceTypeId: true,
        model: true,
        platform: true,
        isActive: true,
        vendor: { select: { id: true, name: true } },
        deviceType: { select: { id: true, name: true } },
      },
    }),
    prisma.firmwareRelease.findMany({
      where: { isActive: true },
      select: { id: true, vendorId: true, platform: true, version: true, isActive: true },
    }),
    profileId
      ? prisma.deviceImportProfileAlias.findMany({
          where: { profileId },
          select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true },
        })
      : prisma.importReferenceAlias.findMany({
          select: { kind: true, normalizedSourceValue: true, contextKey: true, targetId: true },
        }),
  ])
  return { sites, models, firmwareReleases, aliases }
}

async function persistChangedReferences(changes: Map<string, { reference: StagedReferenceRecord; resolved: ResolvedReferenceState }>) {
  const entries = [...changes.values()]
  for (let index = 0; index < entries.length; index += UPDATE_CONCURRENCY) {
    const part = entries.slice(index, index + UPDATE_CONCURRENCY)
    await Promise.all(part.map(({ reference, resolved }) => prisma.deviceImportStagedReference.update({
      where: { id: reference.id },
      data: {
        status: resolved.status,
        targetId: resolved.targetId,
        suggestedTargetId: resolved.suggestedTargetId,
        suggestionScore: resolved.suggestionScore,
        resolutionSource: resolved.resolutionSource,
        metadata: resolved.metadata,
      },
    })))
  }
}

async function refreshDependents(batch: BatchRecord, rootReferenceId: string) {
  const [records, universe] = await Promise.all([
    prisma.deviceImportStagedReference.findMany({
      where: { batchId: batch.id },
      orderBy: [{ kind: 'asc' }, { sourceValue: 'asc' }],
    }) as Promise<StagedReferenceRecord[]>,
    loadIncrementalUniverse(batch.profileId),
  ])
  const root = records.find((record) => record.id === rootReferenceId)
  if (!root) return

  const queue: StagedReferenceRecord[] = [root]
  const processedParents = new Set<string>()
  const changes = new Map<string, { reference: StagedReferenceRecord; resolved: ResolvedReferenceState }>()

  while (queue.length) {
    const parent = queue.shift()!
    if (processedParents.has(parent.id)) continue
    processedParents.add(parent.id)

    for (const child of records) {
      if (!stagedReferenceDependsOn(parent, child)) continue
      const resolved = resolveDependentReference(child, records, universe)
      if (!resolved) continue
      if (stateChanged(child, resolved)) {
        changes.set(child.id, { reference: child, resolved })
        applyResolvedState(child, resolved)
      }
      if (child.kind === 'DEVICE_MODEL' && !processedParents.has(child.id)) queue.push(child)
    }
  }

  await persistChangedReferences(changes)
}

export async function resolveDeviceImportStagedReferenceIncrementally(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId : ''
  const referenceId = typeof input.referenceId === 'string' ? input.referenceId : ''
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : ''
  const remember = input.remember === true
  const created = input.created === true
  if (!batchId || !referenceId || !targetId) {
    throw new DeviceImportStagingError('Choose a staged reference and configured target.')
  }

  const [batch, reference] = await Promise.all([
    prisma.deviceImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true, profileId: true, status: true },
    }) as Promise<BatchRecord | null>,
    prisma.deviceImportStagedReference.findFirst({ where: { id: referenceId, batchId } }) as Promise<StagedReferenceRecord | null>,
  ])
  if (!batch || !reference) throw new DeviceImportStagingError('The staged import reference was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')

  if (remember) {
    await saveImportReferenceAlias({
      profileId: batch.profileId,
      kind: reference.kind,
      sourceValue: reference.sourceValue,
      contextKey: aliasContext(reference),
      targetId,
    })
  } else {
    await validateOneTimeTarget(reference, targetId)
  }

  await prisma.deviceImportStagedReference.update({
    where: { id: reference.id },
    data: {
      status: 'LINKED',
      targetId,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: created ? 'CREATED' : 'USER',
    },
  })

  if (['CUSTOMER', 'VENDOR', 'DEVICE_TYPE', 'DEVICE_MODEL'].includes(reference.kind)) {
    await refreshDependents(batch, reference.id)
  }

  const unresolved = await prisma.deviceImportStagedReference.count({
    where: { batchId, status: { not: 'LINKED' } },
  })
  await prisma.deviceImportBatch.update({
    where: { id: batchId },
    data: { status: unresolved === 0 ? 'READY' : 'STAGED' },
  })

  return getDeviceImportBatchWorkspace(batchId)
}
