import { normalizeImportText, type DeviceImportReferenceKind } from '@/lib/device-import'
import { bulkCreateDeviceImportCoreReferences } from '@/lib/device-import-staged-core-assist'
import { bulkCreateDeviceImportFirmware } from '@/lib/device-import-staged-firmware-assist'
import {
  bulkAssignDeviceImportModelFamilies,
  bulkCreateAndAssignDeviceImportModelFamilies,
  bulkCreateDeviceImportModels,
} from '@/lib/device-import-staged-model-assist'
import { rememberReviewedBatchReferences, rememberReviewedImportAliases } from '@/lib/device-import-staged-profile-aliases'
import { resolveDeviceImportStagedReferencesBulk } from '@/lib/device-import-staged-reference-bulk'
import { bulkCreateDeviceImportSites } from '@/lib/device-import-staged-site-bulk-create'
import { refreshDeviceImportBatchReferences, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

const MAX_PREPARED_ACTIONS = 2_000
const CHUNK_SIZE = 200

const REFERENCE_ORDER: DeviceImportReferenceKind[] = [
  'CUSTOMER',
  'VENDOR',
  'DEVICE_TYPE',
  'SITE',
  'DEVICE_MODEL',
  'FIRMWARE_RELEASE',
]

type PreparedReferenceAction = {
  referenceId: string
  action: 'LINK' | 'CREATE'
  targetId: string | null
  remember: boolean
  values: Record<string, unknown>
}

type PreparedFamilyAction = {
  modelId: string
  action: 'ASSIGN' | 'CREATE'
  familyId: string | null
  vendorId: string | null
  name: string | null
}

type PreparedInput = {
  batchId: string
  items: PreparedReferenceAction[]
  families: PreparedFamilyAction[]
}

type ReferenceRecord = {
  id: string
  kind: string
  sourceValue: string
  status: string
  metadata: unknown
}

export type PreparedActionFailure = {
  key: string
  message: string
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function optionalText(value: unknown) {
  const valueText = text(value)
  return valueText || null
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function chunks<T>(items: T[], size = CHUNK_SIZE) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function parseReferenceAction(raw: unknown): PreparedReferenceAction {
  const input = record(raw)
  const referenceId = text(input.referenceId)
  const action = text(input.action).toUpperCase()
  if (!referenceId || !['LINK', 'CREATE'].includes(action)) {
    throw new DeviceImportStagingError('Every prepared reference needs a staged reference and LINK or CREATE action.')
  }
  const targetId = optionalText(input.targetId)
  if (action === 'LINK' && !targetId) throw new DeviceImportStagingError('Every prepared LINK action needs an existing target.')
  return {
    referenceId,
    action: action as PreparedReferenceAction['action'],
    targetId,
    remember: input.remember !== false,
    values: record(input.values),
  }
}

function parseFamilyAction(raw: unknown): PreparedFamilyAction {
  const input = record(raw)
  const modelId = text(input.modelId)
  const action = text(input.action).toUpperCase()
  if (!modelId || !['ASSIGN', 'CREATE'].includes(action)) {
    throw new DeviceImportStagingError('Every prepared Family action needs a Model and ASSIGN or CREATE action.')
  }
  const familyId = optionalText(input.familyId)
  const vendorId = optionalText(input.vendorId)
  const name = optionalText(input.name)
  if (action === 'ASSIGN' && !familyId) throw new DeviceImportStagingError('Assigning a Model Family requires an existing Family.')
  if (action === 'CREATE' && (!vendorId || !name)) throw new DeviceImportStagingError('Creating a Model Family requires a Vendor and Family name.')
  return {
    modelId,
    action: action as PreparedFamilyAction['action'],
    familyId,
    vendorId,
    name,
  }
}

export function parsePreparedImportActions(rawInput: unknown): PreparedInput {
  const input = record(rawInput)
  const batchId = text(input.batchId)
  const items = Array.isArray(input.items) ? input.items.map(parseReferenceAction) : []
  const families = Array.isArray(input.families) ? input.families.map(parseFamilyAction) : []
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  if (!items.length && !families.length) throw new DeviceImportStagingError('Prepare at least one reconciliation action before applying.')
  if (items.length + families.length > MAX_PREPARED_ACTIONS) {
    throw new DeviceImportStagingError(`Apply at most ${MAX_PREPARED_ACTIONS.toLocaleString()} prepared actions at once.`)
  }
  if (new Set(items.map((item) => item.referenceId)).size !== items.length) {
    throw new DeviceImportStagingError('A staged reference can only appear once in the prepared change set.')
  }
  if (new Set(families.map((item) => item.modelId)).size !== families.length) {
    throw new DeviceImportStagingError('A Model can only appear once in the prepared Family change set.')
  }
  return { batchId, items, families }
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The prepared action could not be applied.'
}

async function assertMutableBatch(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
}

async function loadReferences(batchId: string, referenceIds: string[]) {
  if (!referenceIds.length) return [] as ReferenceRecord[]
  return prisma.deviceImportStagedReference.findMany({
    where: { batchId, id: { in: referenceIds } },
    select: { id: true, kind: true, sourceValue: true, status: true, metadata: true },
  }) as Promise<ReferenceRecord[]>
}

async function applyChunkWithFallback<T>(
  part: T[],
  key: (item: T) => string,
  bulk: (items: T[]) => Promise<unknown>,
  failures: PreparedActionFailure[],
) {
  if (!part.length) return 0
  try {
    await bulk(part)
    return part.length
  } catch (bulkError) {
    if (part.length === 1) {
      failures.push({ key: key(part[0]), message: failureMessage(bulkError) })
      return 0
    }
    let applied = 0
    for (const item of part) {
      try {
        await bulk([item])
        applied += 1
      } catch (itemError) {
        failures.push({ key: key(item), message: failureMessage(itemError) })
      }
    }
    return applied
  }
}

async function applyLinkActions(
  batchId: string,
  items: PreparedReferenceAction[],
  referenceById: Map<string, ReferenceRecord>,
  failures: PreparedActionFailure[],
) {
  let applied = 0
  for (const kind of REFERENCE_ORDER) {
    const kindItems = items.filter((item) => referenceById.get(item.referenceId)?.kind === kind)
    for (const part of chunks(kindItems)) {
      applied += await applyChunkWithFallback(
        part,
        (item) => item.referenceId,
        (current) => resolveDeviceImportStagedReferencesBulk({
          batchId,
          deferRefresh: true,
          items: current.map((item) => ({ referenceId: item.referenceId, targetId: item.targetId, remember: item.remember })),
        }),
        failures,
      )
    }
  }
  return applied
}

async function prepareSiteCreate(batchId: string, item: PreparedReferenceAction) {
  const reference = await prisma.deviceImportStagedReference.findFirst({ where: { id: item.referenceId, batchId }, select: { id: true, metadata: true, status: true } })
  if (!reference) throw new DeviceImportStagingError('The prepared Site reference no longer exists.')
  const current = metadata(reference.metadata)
  const customerId = optionalText(item.values.customerId) ?? current.customerTargetId ?? null
  if (!customerId) throw new DeviceImportStagingError('Resolve or choose the Customer before creating this Site.')
  await prisma.deviceImportStagedReference.update({
    where: { id: reference.id },
    data: { status: 'UNRESOLVED', metadata: { ...current, customerTargetId: customerId, waitingFor: [] } },
  })
  return {
    referenceIds: [reference.id],
    name: text(item.values.name),
    code: text(item.values.code),
  }
}

function generatedReferenceCode(value: string) {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'IMPORT'
}

async function resolveOrCreateModelVendor(values: Record<string, unknown>) {
  const name = text(values.vendorName)
  if (!name) return null
  const code = text(values.vendorCode) || generatedReferenceCode(name)
  const existing = await prisma.vendor.findFirst({
    where: { OR: [{ name }, { code }] },
    select: { id: true, isActive: true },
  })
  if (existing) {
    if (!existing.isActive) throw new DeviceImportStagingError(`Vendor “${name}” already exists but is archived.`)
    return existing.id
  }
  return (await prisma.vendor.create({ data: { name, code, isActive: true }, select: { id: true } })).id
}

async function resolveOrCreateModelDeviceType(values: Record<string, unknown>) {
  const name = text(values.deviceTypeName)
  if (!name) return null
  const code = text(values.deviceTypeCode) || generatedReferenceCode(name)
  const existing = await prisma.deviceType.findFirst({
    where: { OR: [{ name }, { code }] },
    select: { id: true, isActive: true },
  })
  if (existing) {
    if (!existing.isActive) throw new DeviceImportStagingError(`Device Type “${name}” already exists but is archived.`)
    return existing.id
  }
  return (await prisma.deviceType.create({ data: { name, code, isActive: true }, select: { id: true } })).id
}

async function linkModelDependencyReference(
  batchId: string,
  kind: 'VENDOR' | 'DEVICE_TYPE',
  sourceValue: string | null | undefined,
  targetId: string,
) {
  const normalizedSourceValue = normalizeImportText(sourceValue)
  if (!normalizedSourceValue) return
  await prisma.deviceImportStagedReference.updateMany({
    where: { batchId, kind, normalizedSourceValue },
    data: {
      status: 'LINKED',
      targetId,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: 'USER',
    },
  })
}

type ModelDependencyCache = Map<string, Promise<string | null>>

function cachedModelDependency(
  cache: ModelDependencyCache,
  kind: 'VENDOR' | 'DEVICE_TYPE',
  value: string,
  resolve: () => Promise<string | null>,
) {
  const key = `${kind}|${normalizeImportText(value)}`
  const existing = cache.get(key)
  if (existing) return existing
  const pending = resolve()
  cache.set(key, pending)
  return pending
}

async function prepareModelCreate(batchId: string, item: PreparedReferenceAction, dependencyCache: ModelDependencyCache) {
  const reference = await prisma.deviceImportStagedReference.findFirst({ where: { id: item.referenceId, batchId }, select: { id: true, metadata: true } })
  if (!reference) throw new DeviceImportStagingError('The prepared Model reference no longer exists.')
  const current = metadata(reference.metadata)

  // A value explicitly typed in the worksheet must override stale imported
  // dependency metadata. This also makes a new Vendor/Device Type an inline
  // dependency of Model creation instead of requiring a separate setup step.
  let vendorId = optionalText(item.values.vendorId)
  const vendorName = text(item.values.vendorName)
  if (!vendorId && vendorName) {
    vendorId = await cachedModelDependency(dependencyCache, 'VENDOR', vendorName, () => resolveOrCreateModelVendor(item.values))
  }
  if (!vendorId) vendorId = current.vendorTargetId ?? null

  let deviceTypeId = optionalText(item.values.deviceTypeId)
  const deviceTypeName = text(item.values.deviceTypeName)
  if (!deviceTypeId && deviceTypeName) {
    deviceTypeId = await cachedModelDependency(dependencyCache, 'DEVICE_TYPE', deviceTypeName, () => resolveOrCreateModelDeviceType(item.values))
  }
  if (!deviceTypeId) deviceTypeId = current.deviceTypeTargetId ?? null

  if (!vendorId || !deviceTypeId) throw new DeviceImportStagingError('Resolve or enter both Vendor and Device Type before creating this Model.')

  await Promise.all([
    linkModelDependencyReference(batchId, 'VENDOR', optionalText(item.values.vendorSourceValue) ?? current.vendorSourceValue, vendorId),
    linkModelDependencyReference(batchId, 'DEVICE_TYPE', current.deviceTypeSourceValue, deviceTypeId),
  ])

  const platform = optionalText(item.values.platform)
  const rawPlatforms = Array.isArray(item.values.platforms)
    ? item.values.platforms
    : typeof item.values.platforms === 'string'
      ? item.values.platforms.split(',')
      : current.platforms ?? []
  const platforms = [...new Set(rawPlatforms.map((value) => text(value)).filter(Boolean))]
  if (platform && !platforms.some((value) => value.toLocaleLowerCase('en-US') === platform.toLocaleLowerCase('en-US'))) platforms.push(platform)
  await prisma.deviceImportStagedReference.update({
    where: { id: reference.id },
    data: {
      status: 'UNRESOLVED',
      metadata: {
        ...current,
        vendorTargetId: vendorId,
        deviceTypeTargetId: deviceTypeId,
        platform,
        platforms,
        waitingFor: [],
      },
    },
  })
  return {
    referenceId: reference.id,
    model: text(item.values.model),
    platform,
    platforms,
    familyId: optionalText(item.values.familyId),
    vendorAliasSource: optionalText(item.values.vendorSourceValue) ?? current.vendorSourceValue ?? null,
    vendorId,
  }
}


async function prepareFirmwareCreate(batchId: string, item: PreparedReferenceAction) {
  const reference = await prisma.deviceImportStagedReference.findFirst({ where: { id: item.referenceId, batchId }, select: { id: true, metadata: true } })
  if (!reference) throw new DeviceImportStagingError('The prepared Firmware reference no longer exists.')
  const current = metadata(reference.metadata)
  const modelId = optionalText(item.values.modelId) ?? current.modelTargetId ?? null
  const vendorId = optionalText(item.values.vendorId) ?? current.vendorTargetId ?? null
  const platform = optionalText(item.values.platform) ?? current.platform ?? null
  if (!modelId) throw new DeviceImportStagingError('Resolve or choose the Device Model before creating this Firmware Release.')
  if (!vendorId) throw new DeviceImportStagingError('Resolve or choose the Vendor before creating this Firmware Release.')
  if (!platform) throw new DeviceImportStagingError('Choose the concrete platform before creating this Firmware Release.')
  await prisma.deviceImportStagedReference.update({
    where: { id: reference.id },
    data: {
      status: 'UNRESOLVED',
      metadata: { ...current, modelTargetId: modelId, vendorTargetId: vendorId, platform, platforms: [platform], waitingFor: [] },
    },
  })
  return {
    referenceIds: [reference.id],
    version: text(item.values.version),
    platform,
    status: optionalText(item.values.status)?.toUpperCase() ?? 'AVAILABLE',
  }
}

async function applyCreateActions(
  batchId: string,
  items: PreparedReferenceAction[],
  referenceById: Map<string, ReferenceRecord>,
  failures: PreparedActionFailure[],
) {
  let applied = 0
  const rememberedKinds = new Set<DeviceImportReferenceKind>()

  const coreKinds = new Set<DeviceImportReferenceKind>(['CUSTOMER', 'VENDOR', 'DEVICE_TYPE'])
  const coreItems = items.filter((item) => coreKinds.has(referenceById.get(item.referenceId)?.kind as DeviceImportReferenceKind))
  for (const part of chunks(coreItems)) {
    const succeeded = await applyChunkWithFallback(
      part,
      (item) => item.referenceId,
      (current) => bulkCreateDeviceImportCoreReferences({
        batchId,
        deferRefresh: true,
        allowRelink: true,
        items: current.map((item) => ({
          referenceId: item.referenceId,
          name: text(item.values.name),
          code: text(item.values.code),
        })),
      }),
      failures,
    )
    if (succeeded) {
      applied += succeeded
      for (const item of part) {
        const kind = referenceById.get(item.referenceId)?.kind as DeviceImportReferenceKind | undefined
        if (kind && coreKinds.has(kind)) rememberedKinds.add(kind)
      }
    }
  }

  const siteItems = items.filter((item) => referenceById.get(item.referenceId)?.kind === 'SITE')
  if (coreItems.length && siteItems.length) await refreshDeviceImportBatchReferences(batchId)
  for (const part of chunks(siteItems)) {
    const prepared = (await Promise.all(part.map(async (item) => {
      try {
        return { source: item, value: await prepareSiteCreate(batchId, item) }
      } catch (error) {
        failures.push({ key: item.referenceId, message: failureMessage(error) })
        return null
      }
    }))).filter((entry): entry is { source: PreparedReferenceAction; value: Awaited<ReturnType<typeof prepareSiteCreate>> } => Boolean(entry))
    if (prepared.length) {
      applied += await applyChunkWithFallback(
        prepared,
        (entry) => entry.source.referenceId,
        (current) => bulkCreateDeviceImportSites({ batchId, deferRefresh: true, items: current.map((entry) => entry.value) }),
        failures,
      )
      rememberedKinds.add('SITE')
    }
  }

  const modelItems = items.filter((item) => referenceById.get(item.referenceId)?.kind === 'DEVICE_MODEL')
  const modelDependencyCache: ModelDependencyCache = new Map()
  const successfulModelFamilyDrafts: Array<{ referenceId: string; name: string }> = []
  const successfulVendorAliases: Array<{ sourceValue: string; targetId: string }> = []
  for (const part of chunks(modelItems)) {
    const prepared = (await Promise.all(part.map(async (item) => {
      try {
        return { source: item, value: await prepareModelCreate(batchId, item, modelDependencyCache) }
      } catch (error) {
        failures.push({ key: item.referenceId, message: failureMessage(error) })
        return null
      }
    }))).filter((entry): entry is { source: PreparedReferenceAction; value: Awaited<ReturnType<typeof prepareModelCreate>> } => Boolean(entry))
    if (prepared.length) {
      const beforeFailures = failures.length
      const succeeded = await applyChunkWithFallback(
        prepared,
        (entry) => entry.source.referenceId,
        (current) => bulkCreateDeviceImportModels({ batchId, deferRefresh: true, items: current.map((entry) => entry.value) }),
        failures,
      )
      applied += succeeded
      const failedKeys = new Set(failures.slice(beforeFailures).map((failure) => failure.key))
      for (const entry of prepared) {
        if (!failedKeys.has(entry.source.referenceId) && entry.value.vendorAliasSource) {
          successfulVendorAliases.push({ sourceValue: entry.value.vendorAliasSource, targetId: entry.value.vendorId })
        }
        const familyName = optionalText(entry.source.values.newFamilyName)
        if (familyName && !failedKeys.has(entry.source.referenceId)) {
          successfulModelFamilyDrafts.push({ referenceId: entry.source.referenceId, name: familyName })
        }
      }
      rememberedKinds.add('DEVICE_MODEL')
      rememberedKinds.add('VENDOR')
      rememberedKinds.add('DEVICE_TYPE')
    }
  }

  if (successfulVendorAliases.length) {
    const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { profileId: true } })
    await rememberReviewedImportAliases(batch?.profileId ?? null, successfulVendorAliases.map((alias) => ({
      kind: 'VENDOR' as const,
      sourceValue: alias.sourceValue,
      contextKey: '',
      targetId: alias.targetId,
    })))
  }

  if (successfulModelFamilyDrafts.length) {
    const references = await prisma.deviceImportStagedReference.findMany({
      where: { batchId, id: { in: successfulModelFamilyDrafts.map((item) => item.referenceId) }, status: 'LINKED', targetId: { not: null } },
      select: { id: true, targetId: true, metadata: true },
    })
    const familyGroups = new Map<string, { vendorId: string; name: string; modelIds: string[]; referenceIds: string[] }>()
    for (const reference of references) {
      const draft = successfulModelFamilyDrafts.find((item) => item.referenceId === reference.id)
      const vendorId = metadata(reference.metadata).vendorTargetId
      if (!draft || !vendorId || !reference.targetId) continue
      const key = `${vendorId}|${draft.name.toLocaleLowerCase('en-US')}`
      const current = familyGroups.get(key)
      if (current) {
        if (!current.modelIds.includes(reference.targetId)) current.modelIds.push(reference.targetId)
        current.referenceIds.push(reference.id)
      } else {
        familyGroups.set(key, { vendorId, name: draft.name, modelIds: [reference.targetId], referenceIds: [reference.id] })
      }
    }
    for (const part of chunks([...familyGroups.values()])) {
      try {
        await bulkCreateAndAssignDeviceImportModelFamilies({
          batchId,
          deferRefresh: true,
          items: part.map((group) => ({ vendorId: group.vendorId, name: group.name, modelIds: group.modelIds })),
        })
      } catch (error) {
        for (const group of part) {
          for (const referenceId of group.referenceIds) failures.push({ key: referenceId, message: `Model created, but Family assignment failed: ${failureMessage(error)}` })
        }
      }
    }
  }

  const firmwareItems = items.filter((item) => referenceById.get(item.referenceId)?.kind === 'FIRMWARE_RELEASE')
  if (modelItems.length && firmwareItems.length) await refreshDeviceImportBatchReferences(batchId)
  for (const part of chunks(firmwareItems)) {
    const prepared = (await Promise.all(part.map(async (item) => {
      try {
        return { source: item, value: await prepareFirmwareCreate(batchId, item) }
      } catch (error) {
        failures.push({ key: item.referenceId, message: failureMessage(error) })
        return null
      }
    }))).filter((entry): entry is { source: PreparedReferenceAction; value: Awaited<ReturnType<typeof prepareFirmwareCreate>> } => Boolean(entry))
    if (prepared.length) {
      applied += await applyChunkWithFallback(
        prepared,
        (entry) => entry.source.referenceId,
        (current) => bulkCreateDeviceImportFirmware({ batchId, deferRefresh: true, items: current.map((entry) => entry.value) }),
        failures,
      )
      rememberedKinds.add('FIRMWARE_RELEASE')
    }
  }

  if (rememberedKinds.size) await rememberReviewedBatchReferences(batchId, [...rememberedKinds])
  return applied
}

async function applyFamilyActions(batchId: string, items: PreparedFamilyAction[], failures: PreparedActionFailure[]) {
  let applied = 0
  const assignments = items.filter((item) => item.action === 'ASSIGN')
  for (const part of chunks(assignments)) {
    applied += await applyChunkWithFallback(
      part,
      (item) => `family:${item.modelId}`,
      (current) => bulkAssignDeviceImportModelFamilies({
        batchId,
        deferRefresh: true,
        items: current.map((item) => ({ modelId: item.modelId, familyId: item.familyId })),
      }),
      failures,
    )
  }

  const creates = items.filter((item) => item.action === 'CREATE')
  const grouped = new Map<string, { vendorId: string; name: string; modelIds: string[] }>()
  for (const item of creates) {
    if (!item.vendorId || !item.name) continue
    const key = `${item.vendorId}|${item.name.toLocaleLowerCase('en-US')}`
    const current = grouped.get(key)
    if (current) current.modelIds.push(item.modelId)
    else grouped.set(key, { vendorId: item.vendorId, name: item.name, modelIds: [item.modelId] })
  }
  for (const part of chunks([...grouped.values()])) {
    try {
      await bulkCreateAndAssignDeviceImportModelFamilies({ batchId, deferRefresh: true, items: part })
      applied += part.reduce((sum, item) => sum + item.modelIds.length, 0)
    } catch (error) {
      for (const group of part) {
        for (const modelId of group.modelIds) failures.push({ key: `family:${modelId}`, message: failureMessage(error) })
      }
    }
  }
  return applied
}

export async function applyPreparedImportActions(rawInput: unknown) {
  const input = parsePreparedImportActions(rawInput)
  await assertMutableBatch(input.batchId)

  const references = await loadReferences(input.batchId, input.items.map((item) => item.referenceId))
  if (references.length !== input.items.length) throw new DeviceImportStagingError('One or more prepared staged references no longer exist in this batch.')
  const referenceById = new Map(references.map((reference) => [reference.id, reference]))
  const failures: PreparedActionFailure[] = []

  const linkItems = input.items.filter((item) => item.action === 'LINK')
  const createItems = input.items.filter((item) => item.action === 'CREATE')

  let applied = 0
  applied += await applyLinkActions(input.batchId, linkItems, referenceById, failures)
  const linkedKinds = new Set(linkItems.map((item) => referenceById.get(item.referenceId)?.kind))
  const createdKinds = new Set(createItems.map((item) => referenceById.get(item.referenceId)?.kind))
  const needsLinkDependencyRefresh =
    (createdKinds.has('SITE') && linkedKinds.has('CUSTOMER')) ||
    (createdKinds.has('FIRMWARE_RELEASE') && linkedKinds.has('DEVICE_MODEL'))
  if (needsLinkDependencyRefresh) await refreshDeviceImportBatchReferences(input.batchId)
  applied += await applyCreateActions(input.batchId, createItems, referenceById, failures)
  applied += await applyFamilyActions(input.batchId, input.families, failures)

  const workspace = await refreshDeviceImportBatchReferences(input.batchId)
  return {
    applied,
    failed: failures.length,
    failures,
    remaining: workspace.counts.references.unresolved,
    workspace,
  }
}
