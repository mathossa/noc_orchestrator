import { randomUUID } from 'node:crypto'
import { normalizeImportText } from '@/lib/device-import'
import { suggestImportModelFamily } from '@/lib/device-import-model-family'
import { refreshDeviceImportBatchReferences, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

const MAX_BULK_MODELS = 250
const MAX_FAMILY_ASSIGNMENTS = 250

type ModelReference = {
  id: string
  sourceValue: string
  metadata: unknown
  status: string
  targetId: string | null
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

async function assertMutableBatch(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  return batch
}

export async function getDeviceImportModelAssist(batchId: string) {
  await assertMutableBatch(batchId)
  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'DEVICE_MODEL' },
    orderBy: { sourceValue: 'asc' },
    select: { id: true, sourceValue: true, metadata: true, status: true, targetId: true },
  }) as ModelReference[]

  const targetIds = [...new Set(references.map((reference) => reference.targetId).filter((id): id is string => Boolean(id)))]
  const [models, families] = await Promise.all([
    targetIds.length ? prisma.deviceModel.findMany({
      where: { id: { in: targetIds } },
      select: {
        id: true,
        vendorId: true,
        deviceTypeId: true,
        familyId: true,
        model: true,
        platform: true,
        isActive: true,
        vendor: { select: { id: true, code: true, name: true } },
        deviceType: { select: { id: true, code: true, name: true } },
        family: { select: { id: true, vendorId: true, name: true, isActive: true } },
      },
    }) : Promise.resolve([]),
    prisma.deviceModelFamily.findMany({
      where: { isActive: true },
      orderBy: [{ vendor: { name: 'asc' } }, { name: 'asc' }],
      select: { id: true, vendorId: true, name: true, isActive: true },
    }),
  ])

  const refsByTarget = new Map<string, ModelReference[]>()
  for (const reference of references) {
    if (!reference.targetId) continue
    const list = refsByTarget.get(reference.targetId) ?? []
    list.push(reference)
    refsByTarget.set(reference.targetId, list)
  }

  const linkedModels = models
    .map((model) => {
      const sourceValues = [...new Set((refsByTarget.get(model.id) ?? []).map((reference) => reference.sourceValue))]
      const suggestion = model.familyId ? null : suggestImportModelFamily(
        `${sourceValues.join(' ')} ${model.model}`,
        model.vendorId,
        families,
      )
      return {
        ...model,
        sourceValues,
        suggestedFamilyId: suggestion?.id ?? null,
        suggestedFamilyName: suggestion?.name ?? null,
      }
    })
    .sort((left, right) => left.vendor.name.localeCompare(right.vendor.name) || left.model.localeCompare(right.model))

  const readyToCreate = references.filter((reference) => {
    if (reference.status !== 'UNRESOLVED') return false
    const meta = metadata(reference.metadata)
    return Boolean(meta.vendorTargetId && meta.deviceTypeTargetId)
  }).map((reference) => ({
    id: reference.id,
    sourceValue: reference.sourceValue,
    vendorTargetId: metadata(reference.metadata).vendorTargetId!,
    deviceTypeTargetId: metadata(reference.metadata).deviceTypeTargetId!,
    platform: metadata(reference.metadata).platform ?? null,
  }))

  return { readyToCreate, linkedModels, families }
}

export async function bulkCreateDeviceImportModels(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const referenceIds = Array.isArray(input.referenceIds)
    ? input.referenceIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
    : []
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  if (!referenceIds.length) throw new DeviceImportStagingError('Choose at least one staged Model to create.')
  if (referenceIds.length > MAX_BULK_MODELS) throw new DeviceImportStagingError(`Create at most ${MAX_BULK_MODELS} Models in one bulk action.`)
  if (new Set(referenceIds).size !== referenceIds.length) throw new DeviceImportStagingError('A staged Model can only appear once in a bulk create action.')
  await assertMutableBatch(batchId)

  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'DEVICE_MODEL', status: 'UNRESOLVED', id: { in: referenceIds } },
    select: { id: true, sourceValue: true, metadata: true, status: true, targetId: true },
  }) as ModelReference[]
  if (references.length !== referenceIds.length) throw new DeviceImportStagingError('One or more selected Models are no longer unresolved or ready to create.')
  if (references.some((reference) => {
    const meta = metadata(reference.metadata)
    return !meta.vendorTargetId || !meta.deviceTypeTargetId
  })) throw new DeviceImportStagingError('Resolve Vendor and Device Type before bulk-creating Models.')

  const vendorIds = [...new Set(references.map((reference) => metadata(reference.metadata).vendorTargetId!))]
  const typeIds = [...new Set(references.map((reference) => metadata(reference.metadata).deviceTypeTargetId!))]
  const [vendors, types, existingModels] = await Promise.all([
    prisma.vendor.findMany({ where: { id: { in: vendorIds }, isActive: true }, select: { id: true } }),
    prisma.deviceType.findMany({ where: { id: { in: typeIds }, isActive: true }, select: { id: true } }),
    prisma.deviceModel.findMany({
      where: { vendorId: { in: vendorIds } },
      select: { id: true, vendorId: true, deviceTypeId: true, model: true },
    }),
  ])
  if (vendors.length !== vendorIds.length) throw new DeviceImportStagingError('One or more resolved Vendors no longer exist or are archived.')
  if (types.length !== typeIds.length) throw new DeviceImportStagingError('One or more resolved Device Types no longer exist or are archived.')

  type PendingModel = {
    id: string
    vendorId: string
    deviceTypeId: string
    model: string
    platform: string | null
    referenceIds: string[]
  }
  const pendingByKey = new Map<string, PendingModel>()
  const links: Array<{ referenceId: string; targetId: string; source: 'EXACT' | 'CREATED' }> = []

  for (const reference of references) {
    const meta = metadata(reference.metadata)
    const vendorId = meta.vendorTargetId!
    const deviceTypeId = meta.deviceTypeTargetId!
    const normalized = normalizeImportText(reference.sourceValue)
    const exact = existingModels.find((model) => model.vendorId === vendorId && normalizeImportText(model.model) === normalized)
    if (exact) {
      if (exact.deviceTypeId !== deviceTypeId) {
        throw new DeviceImportStagingError(`Model “${reference.sourceValue}” already exists for this Vendor under another Device Type.`)
      }
      links.push({ referenceId: reference.id, targetId: exact.id, source: 'EXACT' })
      continue
    }

    const key = `${vendorId}|${normalized}`
    const current = pendingByKey.get(key)
    if (current) {
      if (current.deviceTypeId !== deviceTypeId) throw new DeviceImportStagingError(`Model “${reference.sourceValue}” resolves to conflicting Device Types in this import.`)
      current.referenceIds.push(reference.id)
      continue
    }
    pendingByKey.set(key, {
      id: randomUUID(),
      vendorId,
      deviceTypeId,
      model: reference.sourceValue,
      platform: meta.platform ?? null,
      referenceIds: [reference.id],
    })
  }

  const pending = [...pendingByKey.values()]
  const operations = [
    ...(pending.length ? [prisma.deviceModel.createMany({
      data: pending.map((model) => ({
        id: model.id,
        vendorId: model.vendorId,
        deviceTypeId: model.deviceTypeId,
        familyId: null,
        model: model.model,
        platform: model.platform,
        notes: 'Created from staged XLSX inventory import.',
        source: 'IMPORT',
        isActive: true,
      })),
    })] : []),
    ...pending.flatMap((model) => model.referenceIds.map((referenceId) => prisma.deviceImportStagedReference.update({
      where: { id: referenceId },
      data: { status: 'LINKED', targetId: model.id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'CREATED' },
    }))),
    ...links.map((link) => prisma.deviceImportStagedReference.update({
      where: { id: link.referenceId },
      data: { status: 'LINKED', targetId: link.targetId, suggestedTargetId: null, suggestionScore: null, resolutionSource: link.source },
    })),
  ]
  await prisma.$transaction(operations)
  const workspace = await refreshDeviceImportBatchReferences(batchId)
  return { workspace, created: pending.length, linkedExisting: links.length }
}

export async function bulkAssignDeviceImportModelFamilies(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  if (!rawItems.length) throw new DeviceImportStagingError('Choose at least one Model family assignment.')
  if (rawItems.length > MAX_FAMILY_ASSIGNMENTS) throw new DeviceImportStagingError(`Update at most ${MAX_FAMILY_ASSIGNMENTS} Model families in one action.`)
  await assertMutableBatch(batchId)

  const items = rawItems.map((rawItem) => {
    const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
    const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : ''
    const familyId = typeof item.familyId === 'string' ? item.familyId.trim() : ''
    if (!modelId || !familyId) throw new DeviceImportStagingError('Every Model family assignment needs a Model and Family.')
    return { modelId, familyId }
  })
  if (new Set(items.map((item) => item.modelId)).size !== items.length) throw new DeviceImportStagingError('A Model can only appear once in a family update.')

  const allowedTargets = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'DEVICE_MODEL', status: 'LINKED', targetId: { in: items.map((item) => item.modelId) } },
    select: { targetId: true },
  })
  const allowedIds = new Set(allowedTargets.map((reference) => reference.targetId).filter((id): id is string => Boolean(id)))
  if (items.some((item) => !allowedIds.has(item.modelId))) throw new DeviceImportStagingError('Only Models linked in this staged import can be bulk-updated here.')

  const [models, families] = await Promise.all([
    prisma.deviceModel.findMany({ where: { id: { in: items.map((item) => item.modelId) } }, select: { id: true, vendorId: true, familyId: true } }),
    prisma.deviceModelFamily.findMany({ where: { id: { in: items.map((item) => item.familyId) }, isActive: true }, select: { id: true, vendorId: true } }),
  ])
  const modelsById = new Map(models.map((model) => [model.id, model]))
  const familiesById = new Map(families.map((family) => [family.id, family]))
  for (const item of items) {
    const model = modelsById.get(item.modelId)
    const family = familiesById.get(item.familyId)
    if (!model || !family) throw new DeviceImportStagingError('One or more Models or Families no longer exist or are archived.')
    if (model.vendorId !== family.vendorId) throw new DeviceImportStagingError('A Model family must belong to the same Vendor as the Model.')
  }

  const changed = items.filter((item) => modelsById.get(item.modelId)?.familyId !== item.familyId)
  await prisma.$transaction(changed.map((item) => prisma.deviceModel.update({ where: { id: item.modelId }, data: { familyId: item.familyId } })))
  return { updated: changed.length, assist: await getDeviceImportModelAssist(batchId) }
}
