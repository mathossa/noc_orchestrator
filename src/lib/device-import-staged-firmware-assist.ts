import { randomUUID } from 'node:crypto'
import { normalizeImportText } from '@/lib/device-import'
import { inferFirmwareTrainName } from '@/lib/device-import-normalization'
import { applyDeviceImportFirmwareTransforms, applyDeviceImportPredictionRules, selectDeviceImportFirmwareSource, type DeviceImportPredictionRule } from '@/lib/device-import-profile-predictions'
import { firmwareReleaseStatuses, normalizedFirmwarePlatform } from '@/lib/firmware-releases'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'
import { ensureFirmwareTrainForRelease } from '@/lib/software-platform-store'

const MAX_BULK_FIRMWARE = 250

type FirmwareReference = {
  id: string
  sourceValue: string
  metadata: unknown
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

function singleSupportedModelPlatform(model: { platform: string | null; supportedPlatforms: Array<{ platform: string }> }) {
  const platforms = new Map<string, string>()
  if (model.platform) platforms.set(normalizedFirmwarePlatform(model.platform), model.platform)
  for (const entry of model.supportedPlatforms) platforms.set(normalizedFirmwarePlatform(entry.platform), entry.platform)
  platforms.delete('')
  return platforms.size === 1 ? [...platforms.values()][0] : ''
}

async function assertMutableBatch(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true, profileId: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  return batch
}

export async function getDeviceImportFirmwareAssist(batchId: string) {
  const batch = await assertMutableBatch(batchId)
  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'FIRMWARE_RELEASE', status: 'UNRESOLVED' },
    orderBy: { sourceValue: 'asc' },
    select: { id: true, sourceValue: true, metadata: true },
  }) as FirmwareReference[]

  const vendorIds = [...new Set(references.map((reference) => metadata(reference.metadata).vendorTargetId).filter((id): id is string => Boolean(id)))]
  const modelIds = [...new Set(references.map((reference) => metadata(reference.metadata).modelTargetId).filter((id): id is string => Boolean(id)))]
  const [vendors, models, existingReleases, profileRules] = await Promise.all([
    vendorIds.length ? prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, code: true, name: true, isActive: true } }) : Promise.resolve([]),
    modelIds.length ? prisma.deviceModel.findMany({
      where: { id: { in: modelIds } },
      select: {
        id: true,
        vendorId: true,
        model: true,
        platform: true,
        supportedPlatforms: { select: { platform: true } },
        isActive: true,
      },
    }) as Promise<Array<{ id: string; vendorId: string; model: string; platform: string | null; supportedPlatforms: Array<{ platform: string }>; isActive: boolean }>> : Promise.resolve([]),
    vendorIds.length ? prisma.firmwareRelease.findMany({
      where: { vendorId: { in: vendorIds } },
      select: { id: true, vendorId: true, platform: true, version: true, status: true, isActive: true },
    }) : Promise.resolve([]),
    batch.profileId ? prisma.deviceImportProfileRule.findMany({
      where: { profileId: batch.profileId, isActive: true, action: 'PREDICT' },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, action: true, field: true, operator: true, value: true, normalizedValue: true, result: true, priority: true, isActive: true },
    }) as Promise<DeviceImportPredictionRule[]> : Promise.resolve([]),
  ])
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]))
  const modelById = new Map(models.map((model) => [model.id, model]))
  const firmwareRules = profileRules.filter((rule) => {
    const result = typeof rule.result === 'object' && rule.result !== null ? rule.result as Record<string, unknown> : {}
    return Boolean(result.preferredSoftwarePlatform) || Boolean(result.firmwareSource) || (Array.isArray(result.softwarePlatforms) && result.softwarePlatforms.length > 0) || (Array.isArray(result.firmwareTransforms) && result.firmwareTransforms.length > 0)
  })

  const grouped = new Map<string, {
    key: string
    vendorId: string
    referenceIds: string[]
    versions: string[]
    version: string
    platform: string
    modelIds: string[]
    matchedPredictionRuleIds: string[]
  }>()
  for (const reference of references) {
    const meta = metadata(reference.metadata)
    const vendorId = meta.vendorTargetId
    const modelId = meta.modelTargetId
    if (!vendorId || !vendorById.get(vendorId)?.isActive || !modelId || !modelById.get(modelId)?.isActive) continue
    const model = modelById.get(modelId)!
    const appliedRules = applyDeviceImportPredictionRules({
      vendor: meta.vendorSourceValue,
      model: meta.modelSourceValue,
      platform: meta.platform,
      firmware: reference.sourceValue,
      firmwareVersion: meta.firmwareVersionSourceValue,
      softwareVersion: meta.softwareVersionSourceValue,
    }, firmwareRules)
    const predictedPlatforms = appliedRules.prediction.softwarePlatforms ?? []
    const selectedFirmware = selectDeviceImportFirmwareSource({
      effective: reference.sourceValue,
      firmwareVersion: meta.firmwareVersionSourceValue,
      softwareVersion: meta.softwareVersionSourceValue,
    }, appliedRules.prediction.firmwareSource)
    const version = applyDeviceImportFirmwareTransforms(selectedFirmware, appliedRules.prediction.firmwareTransforms)
    // Never turn an ambiguous multi-platform model back into its legacy/default
    // platform. Only staged device evidence or a genuinely single supported
    // model platform can make a Firmware proposal safe enough to prepare.
    const platform = appliedRules.prediction.preferredSoftwarePlatform ?? (predictedPlatforms.length === 1 ? predictedPlatforms[0] : null) ?? meta.platform ?? singleSupportedModelPlatform(model)
    const platformContext = platform ? normalizedFirmwarePlatform(platform) : `model:${modelId}`
    const key = `${vendorId}|${platformContext}|${normalizeImportText(version)}`
    const current = grouped.get(key)
    if (current) {
      current.referenceIds.push(reference.id)
      if (!current.versions.includes(reference.sourceValue)) current.versions.push(reference.sourceValue)
      if (!current.modelIds.includes(modelId)) current.modelIds.push(modelId)
      for (const ruleId of appliedRules.matchedRuleIds) if (!current.matchedPredictionRuleIds.includes(ruleId)) current.matchedPredictionRuleIds.push(ruleId)
    } else {
      grouped.set(key, {
        key,
        vendorId,
        referenceIds: [reference.id],
        versions: [reference.sourceValue],
        version,
        platform,
        modelIds: [modelId],
        matchedPredictionRuleIds: appliedRules.matchedRuleIds,
      })
    }
  }

  const proposals = [...grouped.values()].map((proposal) => {
    const vendor = vendorById.get(proposal.vendorId)!
    const proposalModels = proposal.modelIds.flatMap((id) => {
      const model = modelById.get(id)
      return model ? [model] : []
    })
    const existingTarget = proposal.platform
      ? existingReleases.find((release) =>
          release.vendorId === proposal.vendorId &&
          normalizedFirmwarePlatform(release.platform) === normalizedFirmwarePlatform(proposal.platform) &&
          normalizeImportText(release.version) === normalizeImportText(proposal.version),
        ) ?? null
      : null
    return {
      ...proposal,
      vendorName: vendor.name,
      vendorCode: vendor.code,
      modelNames: proposalModels.map((model) => model.model),
      status: 'AVAILABLE',
      firmwareTrainName: proposal.platform ? inferFirmwareTrainName(proposal.platform, proposal.version) : '',
      existingTarget: existingTarget ? { id: existingTarget.id, version: existingTarget.version, platform: existingTarget.platform, status: existingTarget.status } : null,
    }
  }).sort((left, right) => left.vendorName.localeCompare(right.vendorName) || left.platform.localeCompare(right.platform) || left.version.localeCompare(right.version))

  return { proposals, rawReferenceCount: references.length, proposalCount: proposals.length }
}

export async function bulkCreateDeviceImportFirmware(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const deferRefresh = input.deferRefresh === true
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  if (!rawItems.length) throw new DeviceImportStagingError('Choose at least one prepared Firmware Release.')
  if (rawItems.length > MAX_BULK_FIRMWARE) throw new DeviceImportStagingError(`Create at most ${MAX_BULK_FIRMWARE} Firmware Releases in one action.`)
  await assertMutableBatch(batchId)

  const items = rawItems.map((rawItem) => {
    const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
    const referenceIds = Array.isArray(item.referenceIds)
      ? item.referenceIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
      : []
    const version = typeof item.version === 'string' ? item.version.normalize('NFKC').trim() : ''
    const platform = typeof item.platform === 'string' ? item.platform.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
    const status = typeof item.status === 'string' ? item.status.trim().toUpperCase() : 'AVAILABLE'
    if (!referenceIds.length || !version || !platform) throw new DeviceImportStagingError('Every prepared Firmware Release needs source references, Platform, and Version.')
    if (!firmwareReleaseStatuses.includes(status as (typeof firmwareReleaseStatuses)[number])) throw new DeviceImportStagingError(`Firmware status “${status}” is not supported.`)
    return { referenceIds, version, platform, status }
  })
  const allReferenceIds = items.flatMap((item) => item.referenceIds)
  if (new Set(allReferenceIds).size !== allReferenceIds.length) throw new DeviceImportStagingError('A staged Firmware reference can only appear in one prepared release.')

  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, kind: 'FIRMWARE_RELEASE', status: 'UNRESOLVED', id: { in: allReferenceIds } },
    select: { id: true, sourceValue: true, metadata: true },
  }) as FirmwareReference[]
  if (references.length !== allReferenceIds.length) throw new DeviceImportStagingError('One or more prepared Firmware references are no longer unresolved.')
  const referenceById = new Map(references.map((reference) => [reference.id, reference]))

  const prepared = items.map((item) => {
    const refs = item.referenceIds.map((id) => referenceById.get(id)!)
    const vendorIds = [...new Set(refs.map((reference) => metadata(reference.metadata).vendorTargetId).filter((id): id is string => Boolean(id)))]
    if (vendorIds.length !== 1) throw new DeviceImportStagingError(`Prepared Firmware ${item.version} must belong to exactly one resolved Vendor.`)
    return { ...item, vendorId: vendorIds[0], refs }
  })

  const merged = new Map<string, typeof prepared[number]>()
  for (const item of prepared) {
    const key = `${item.vendorId}|${normalizedFirmwarePlatform(item.platform)}|${normalizeImportText(item.version)}`
    const current = merged.get(key)
    if (current) {
      if (current.status !== item.status) throw new DeviceImportStagingError(`Firmware ${item.version} was prepared twice with different statuses. Make the proposals consistent.`)
      current.referenceIds.push(...item.referenceIds)
      current.refs.push(...item.refs)
    } else {
      merged.set(key, { ...item, referenceIds: [...item.referenceIds], refs: [...item.refs] })
    }
  }
  const canonical = [...merged.values()]
  const vendorIds = [...new Set(canonical.map((item) => item.vendorId))]
  const modelIds = [...new Set(canonical.flatMap((item) => item.refs.map((reference) => metadata(reference.metadata).modelTargetId).filter((id): id is string => Boolean(id))))]
  const [vendors, existing, models] = await Promise.all([
    prisma.vendor.findMany({ where: { id: { in: vendorIds }, isActive: true }, select: { id: true } }),
    prisma.firmwareRelease.findMany({ where: { vendorId: { in: vendorIds } }, select: { id: true, vendorId: true, platform: true, version: true } }),
    modelIds.length ? prisma.deviceModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, familyId: true } }) : Promise.resolve([]),
  ])
  if (vendors.length !== vendorIds.length) throw new DeviceImportStagingError('One or more Firmware Vendors no longer exist or are archived.')

  const familyByModelId = new Map(models.map((model) => [model.id, model.familyId]))
  const created: Array<{ id: string; vendorId: string; platform: string; version: string; status: string; refs: FirmwareReference[]; firmwareTrainId: string; softwarePlatformId: string }> = []
  const links: Array<{ targetId: string; vendorId: string; platform: string; refs: FirmwareReference[]; firmwareTrainId: string; softwarePlatformId: string }> = []
  for (const item of canonical) {
    const familyIds = [...new Set(item.refs.map((reference) => metadata(reference.metadata).modelTargetId).map((id) => id ? familyByModelId.get(id) : null).filter((id): id is string => Boolean(id)))]
    const catalog = await ensureFirmwareTrainForRelease({ vendorId: item.vendorId, platform: item.platform, version: item.version, productFamilyId: familyIds.length === 1 ? familyIds[0] : null })
    const exact = existing.find((release) =>
      release.vendorId === item.vendorId &&
      normalizedFirmwarePlatform(release.platform) === normalizedFirmwarePlatform(item.platform) &&
      normalizeImportText(release.version) === normalizeImportText(item.version),
    )
    if (exact) {
      links.push({ targetId: exact.id, vendorId: exact.vendorId, platform: exact.platform, refs: item.refs, ...catalog })
    } else {
      created.push({ id: randomUUID(), vendorId: item.vendorId, platform: item.platform, version: item.version, status: item.status, refs: item.refs, ...catalog })
    }
  }

  const operations = [
    ...(created.length ? [prisma.firmwareRelease.createMany({
      data: created.map((release) => ({
        id: release.id,
        vendorId: release.vendorId,
        firmwareTrainId: release.firmwareTrainId,
        softwarePlatformId: release.softwarePlatformId,
        platform: release.platform,
        version: release.version,
        status: release.status,
        notes: 'Created from staged XLSX inventory import.',
        source: 'IMPORT',
        isActive: true,
      })),
    })] : []),
    ...links.map((link) => prisma.firmwareRelease.updateMany({
      where: { id: link.targetId },
      data: { firmwareTrainId: link.firmwareTrainId, softwarePlatformId: link.softwarePlatformId },
    })),
    ...created.flatMap((release) => release.refs.map((reference) => prisma.deviceImportStagedReference.update({
      where: { id: reference.id },
      data: {
        status: 'LINKED', targetId: release.id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'CREATED',
        metadata: { ...metadata(reference.metadata), vendorTargetId: release.vendorId, platform: release.platform, waitingFor: [] },
      },
    }))),
    ...links.flatMap((link) => link.refs.map((reference) => prisma.deviceImportStagedReference.update({
      where: { id: reference.id },
      data: {
        status: 'LINKED', targetId: link.targetId, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT',
        metadata: { ...metadata(reference.metadata), vendorTargetId: link.vendorId, platform: link.platform, waitingFor: [] },
      },
    }))),
  ]
  await prisma.$transaction(operations)
  const unresolved = await prisma.deviceImportStagedReference.count({ where: { batchId, status: { not: 'LINKED' } } })
  await prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: unresolved === 0 ? 'READY' : 'STAGED' } })
  return { created: created.length, linkedExisting: links.length, assist: deferRefresh ? null : await getDeviceImportFirmwareAssist(batchId) }
}
