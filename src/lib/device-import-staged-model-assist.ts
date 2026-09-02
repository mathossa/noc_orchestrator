import { randomUUID } from 'node:crypto'
import { normalizeImportText } from '@/lib/device-import'
import { suggestImportModelFamily, suggestNewImportModelFamilyName } from '@/lib/device-import-model-family'
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

type ModelCreateInput = {
  referenceId: string
  model: string
  platform: string | null
  familyId: string | null
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
  const vendorIds = [...new Set(references.map((reference) => metadata(reference.metadata).vendorTargetId).filter((id): id is string => Boolean(id)))]
  const typeIds = [...new Set(references.map((reference) => metadata(reference.metadata).deviceTypeTargetId).filter((id): id is string => Boolean(id)))]
  const [models, families, vendors, deviceTypes] = await Promise.all([
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
    vendorIds.length ? prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, code: true, name: true, isActive: true },
    }) : Promise.resolve([]),
    typeIds.length ? prisma.deviceType.findMany({
      where: { id: { in: typeIds } },
      select: { id: true, code: true, name: true, isActive: true },
    }) : Promise.resolve([]),
  ])
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]))
  const typeById = new Map(deviceTypes.map((deviceType) => [deviceType.id, deviceType]))

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
      const existingSuggestion = model.familyId ? null : suggestImportModelFamily(
        `${sourceValues.join(' ')} ${model.model}`,
        model.vendorId,
        families,
      )
      const proposedNewFamilyName = model.familyId || existingSuggestion
        ? null
        : suggestNewImportModelFamilyName(`${sourceValues[0] ?? ''} ${model.model}`, model.vendor.name, model.vendor.code)
      return {
        ...model,
        sourceValues,
        suggestedFamilyId: existingSuggestion?.id ?? null,
        suggestedFamilyName: existingSuggestion?.name ?? null,
        proposedNewFamilyName,
      }
    })
    .sort((left, right) => left.vendor.name.localeCompare(right.vendor.name) || left.model.localeCompare(right.model))

  const readyToCreate = references.filter((reference) => {
    if (reference.status !== 'UNRESOLVED') return false
    const meta = metadata(reference.metadata)
    return Boolean(meta.vendorTargetId && meta.deviceTypeTargetId && vendorById.get(meta.vendorTargetId)?.isActive && typeById.get(meta.deviceTypeTargetId)?.isActive)
  }).map((reference) => {
    const meta = metadata(reference.metadata)
    const vendor = vendorById.get(meta.vendorTargetId!)!
    const deviceType = typeById.get(meta.deviceTypeTargetId!)!
    const existingSuggestion = suggestImportModelFamily(reference.sourceValue, vendor.id, families)
    return {
      id: reference.id,
      sourceValue: reference.sourceValue,
      vendorTargetId: vendor.id,
      vendorName: vendor.name,
      vendorCode: vendor.code,
      deviceTypeTargetId: deviceType.id,
      deviceTypeName: deviceType.name,
      deviceTypeCode: deviceType.code,
      proposedModel: reference.sourceValue,
      proposedPlatform: meta.platform ?? '',
      suggestedFamilyId: existingSuggestion?.id ?? null,
      suggestedFamilyName: existingSuggestion?.name ?? null,
      proposedNewFamilyName: existingSuggestion ? null : suggestNewImportModelFamilyName(reference.sourceValue, vendor.name, vendor.code),
    }
  })

  const groupedNewFamilies = new Map<string, {
    key: string
    vendorId: string
    vendorName: string
    name: string
    modelIds: string[]
    modelNames: string[]
  }>()
  for (const model of linkedModels) {
    if (model.familyId || model.suggestedFamilyId || !model.proposedNewFamilyName) continue
    const key = `${model.vendorId}|${normalizeImportText(model.proposedNewFamilyName)}`
    const current = groupedNewFamilies.get(key)
    if (current) {
      current.modelIds.push(model.id)
      current.modelNames.push(model.model)
    } else {
      groupedNewFamilies.set(key, {
        key,
        vendorId: model.vendorId,
        vendorName: model.vendor.name,
        name: model.proposedNewFamilyName,
        modelIds: [model.id],
        modelNames: [model.model],
      })
    }
  }

  return { readyToCreate, linkedModels, families, newFamilyProposals: [...groupedNewFamilies.values()] }
}

function parseModelCreateItems(rawInput: Record<string, unknown>, references: ModelReference[]): ModelCreateInput[] {
  const rawItems = Array.isArray(rawInput.items) ? rawInput.items : []
  if (rawItems.length) {
    return rawItems.map((rawItem) => {
      const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
      const referenceId = typeof item.referenceId === 'string' ? item.referenceId.trim() : ''
      const model = typeof item.model === 'string' ? item.model.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
      const platform = typeof item.platform === 'string' && item.platform.trim() ? item.platform.normalize('NFKC').trim().replace(/\s+/g, ' ') : null
      const familyId = typeof item.familyId === 'string' && item.familyId.trim() ? item.familyId.trim() : null
      if (!referenceId || !model) throw new DeviceImportStagingError('Every prepared Model needs a staged reference and concrete Model name.')
      if (model.length > 160) throw new DeviceImportStagingError(`Model “${model}” is longer than 160 characters.`)
      if (platform && platform.length > 160) throw new DeviceImportStagingError(`Platform “${platform}” is longer than 160 characters.`)
      return { referenceId, model, platform, familyId }
    })
  }
  const referenceIds = Array.isArray(rawInput.referenceIds)
    ? rawInput.referenceIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
    : []
  return referenceIds.map((referenceId) => {
    const reference = references.find((candidate) => candidate.id === referenceId)
    return { referenceId, model: reference?.sourceValue ?? '', platform: reference ? metadata(reference.metadata).platform ?? null : null, familyId: null }
  })
}

export async function bulkCreateDeviceImportModels(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  await assertMutableBatch(batchId)

  const allUnresolved = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'DEVICE_MODEL', status: 'UNRESOLVED' },
    select: { id: true, sourceValue: true, metadata: true, status: true, targetId: true },
  }) as ModelReference[]
  const items = parseModelCreateItems(input, allUnresolved)
  if (!items.length) throw new DeviceImportStagingError('Choose at least one prepared Model to create.')
  if (items.length > MAX_BULK_MODELS) throw new DeviceImportStagingError(`Create at most ${MAX_BULK_MODELS} Models in one bulk action.`)
  if (new Set(items.map((item) => item.referenceId)).size !== items.length) throw new DeviceImportStagingError('A staged Model can only appear once in a bulk create action.')

  const referenceById = new Map(allUnresolved.map((reference) => [reference.id, reference]))
  if (items.some((item) => !referenceById.has(item.referenceId))) throw new DeviceImportStagingError('One or more selected Models are no longer unresolved or ready to create.')
  const references = items.map((item) => referenceById.get(item.referenceId)!)
  if (references.some((reference) => {
    const meta = metadata(reference.metadata)
    return !meta.vendorTargetId || !meta.deviceTypeTargetId
  })) throw new DeviceImportStagingError('Resolve Vendor and Device Type before bulk-creating Models.')

  const vendorIds = [...new Set(references.map((reference) => metadata(reference.metadata).vendorTargetId!))]
  const typeIds = [...new Set(references.map((reference) => metadata(reference.metadata).deviceTypeTargetId!))]
  const familyIds = [...new Set(items.map((item) => item.familyId).filter((id): id is string => Boolean(id)))]
  const [vendors, types, families, existingModels] = await Promise.all([
    prisma.vendor.findMany({ where: { id: { in: vendorIds }, isActive: true }, select: { id: true } }),
    prisma.deviceType.findMany({ where: { id: { in: typeIds }, isActive: true }, select: { id: true } }),
    familyIds.length ? prisma.deviceModelFamily.findMany({ where: { id: { in: familyIds }, isActive: true }, select: { id: true, vendorId: true } }) : Promise.resolve([]),
    prisma.deviceModel.findMany({ where: { vendorId: { in: vendorIds } }, select: { id: true, vendorId: true, deviceTypeId: true, familyId: true, model: true } }),
  ])
  if (vendors.length !== vendorIds.length) throw new DeviceImportStagingError('One or more resolved Vendors no longer exist or are archived.')
  if (types.length !== typeIds.length) throw new DeviceImportStagingError('One or more resolved Device Types no longer exist or are archived.')
  const familyById = new Map(families.map((family) => [family.id, family]))

  type PendingModel = {
    id: string
    vendorId: string
    deviceTypeId: string
    familyId: string | null
    model: string
    platform: string | null
    referenceIds: string[]
  }
  const pendingByKey = new Map<string, PendingModel>()
  const links: Array<{ referenceId: string; targetId: string; source: 'EXACT' | 'CREATED' }> = []

  for (const item of items) {
    const reference = referenceById.get(item.referenceId)!
    const meta = metadata(reference.metadata)
    const vendorId = meta.vendorTargetId!
    const deviceTypeId = meta.deviceTypeTargetId!
    if (item.familyId) {
      const family = familyById.get(item.familyId)
      if (!family || family.vendorId !== vendorId) throw new DeviceImportStagingError(`The selected family for “${item.model}” does not belong to the resolved Vendor.`)
    }
    const normalized = normalizeImportText(item.model)
    const exact = existingModels.find((model) => model.vendorId === vendorId && normalizeImportText(model.model) === normalized)
    if (exact) {
      if (exact.deviceTypeId !== deviceTypeId) throw new DeviceImportStagingError(`Model “${item.model}” already exists for this Vendor under another Device Type.`)
      links.push({ referenceId: reference.id, targetId: exact.id, source: 'EXACT' })
      continue
    }

    const key = `${vendorId}|${normalized}`
    const current = pendingByKey.get(key)
    if (current) {
      if (current.deviceTypeId !== deviceTypeId) throw new DeviceImportStagingError(`Model “${item.model}” resolves to conflicting Device Types in this import.`)
      if (current.familyId !== item.familyId || current.platform !== item.platform) throw new DeviceImportStagingError(`Model “${item.model}” has conflicting Platform or Family proposals. Make the prepared rows consistent.`)
      current.referenceIds.push(reference.id)
      continue
    }
    pendingByKey.set(key, {
      id: randomUUID(), vendorId, deviceTypeId, familyId: item.familyId, model: item.model, platform: item.platform, referenceIds: [reference.id],
    })
  }

  const pending = [...pendingByKey.values()]
  const operations = [
    ...(pending.length ? [prisma.deviceModel.createMany({
      data: pending.map((model) => ({
        id: model.id,
        vendorId: model.vendorId,
        deviceTypeId: model.deviceTypeId,
        familyId: model.familyId,
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

export async function bulkCreateAndAssignDeviceImportModelFamilies(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  if (!rawItems.length) throw new DeviceImportStagingError('Choose at least one proposed Model family.')
  if (rawItems.length > MAX_FAMILY_ASSIGNMENTS) throw new DeviceImportStagingError(`Create at most ${MAX_FAMILY_ASSIGNMENTS} Model families in one action.`)
  await assertMutableBatch(batchId)

  const items = rawItems.map((rawItem) => {
    const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
    const vendorId = typeof item.vendorId === 'string' ? item.vendorId.trim() : ''
    const name = typeof item.name === 'string' ? item.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
    const modelIds = Array.isArray(item.modelIds)
      ? item.modelIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
      : []
    if (!vendorId || !name || !modelIds.length) throw new DeviceImportStagingError('Every proposed Family needs a Vendor, Family name, and at least one Model.')
    return { vendorId, name, modelIds }
  })
  const familyKeys = items.map((item) => `${item.vendorId}|${normalizeImportText(item.name)}`)
  if (new Set(familyKeys).size !== familyKeys.length) throw new DeviceImportStagingError('Two proposed Families resolve to the same name for the same Vendor. Merge or rename them first.')
  const allModelIds = items.flatMap((item) => item.modelIds)
  if (new Set(allModelIds).size !== allModelIds.length) throw new DeviceImportStagingError('A Model can only be assigned by one proposed Family in this action.')

  const [linkedReferences, models, existingFamilies] = await Promise.all([
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, kind: 'DEVICE_MODEL', status: 'LINKED', targetId: { in: allModelIds } },
      select: { targetId: true },
    }),
    prisma.deviceModel.findMany({ where: { id: { in: allModelIds } }, select: { id: true, vendorId: true, familyId: true } }),
    prisma.deviceModelFamily.findMany({ where: { vendorId: { in: [...new Set(items.map((item) => item.vendorId))] } }, select: { id: true, vendorId: true, name: true, isActive: true } }),
  ])
  const linkedIds = new Set(linkedReferences.map((reference) => reference.targetId).filter((id): id is string => Boolean(id)))
  const modelById = new Map(models.map((model) => [model.id, model]))
  if (allModelIds.some((id) => !linkedIds.has(id) || !modelById.has(id))) throw new DeviceImportStagingError('Only Models linked in this staged import can receive proposed Families.')

  const createdFamilies: Array<{ id: string; vendorId: string; name: string; modelIds: string[] }> = []
  const familyAssignments: Array<{ familyId: string; modelIds: string[] }> = []
  let existingFamilyCount = 0
  for (const item of items) {
    for (const modelId of item.modelIds) {
      const model = modelById.get(modelId)!
      if (model.vendorId !== item.vendorId) throw new DeviceImportStagingError(`Proposed Family “${item.name}” contains a Model from another Vendor.`)
      if (model.familyId) throw new DeviceImportStagingError('A proposed new Family cannot overwrite an existing Model family assignment.')
    }
    const existing = existingFamilies.find((family) => family.vendorId === item.vendorId && normalizeImportText(family.name) === normalizeImportText(item.name))
    if (existing) {
      if (!existing.isActive) throw new DeviceImportStagingError(`Family “${item.name}” already exists but is archived. Reactivate or choose another Family.`)
      familyAssignments.push({ familyId: existing.id, modelIds: item.modelIds })
      existingFamilyCount += 1
    } else {
      const family = { id: randomUUID(), vendorId: item.vendorId, name: item.name, modelIds: item.modelIds }
      createdFamilies.push(family)
      familyAssignments.push({ familyId: family.id, modelIds: item.modelIds })
    }
  }

  const operations = [
    ...(createdFamilies.length ? [prisma.deviceModelFamily.createMany({
      data: createdFamilies.map((family) => ({ id: family.id, vendorId: family.vendorId, name: family.name, isActive: true, notes: 'Created from staged XLSX inventory import suggestion.' })),
    })] : []),
    ...familyAssignments.flatMap((assignment) => assignment.modelIds.map((modelId) => prisma.deviceModel.update({
      where: { id: modelId },
      data: { familyId: assignment.familyId },
    }))),
  ]
  await prisma.$transaction(operations)
  return {
    createdFamilies: createdFamilies.length,
    reusedFamilies: existingFamilyCount,
    assignedModels: allModelIds.length,
    assist: await getDeviceImportModelAssist(batchId),
  }
}
