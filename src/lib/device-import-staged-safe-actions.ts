import { getDeviceImportCoreAssist, bulkCreateDeviceImportCoreReferences } from '@/lib/device-import-staged-core-assist'
import { bulkCreateDeviceImportFirmware, getDeviceImportFirmwareAssist } from '@/lib/device-import-staged-firmware-assist'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import {
  bulkAssignDeviceImportModelFamilies,
  bulkCreateAndAssignDeviceImportModelFamilies,
  bulkCreateDeviceImportModels,
  getDeviceImportModelAssist,
} from '@/lib/device-import-staged-model-assist'
import { rememberReviewedBatchReferences } from '@/lib/device-import-staged-profile-aliases'
import { resolveDeviceImportStagedReferencesBulk } from '@/lib/device-import-staged-reference-bulk'
import { bulkCreateDeviceImportSites, getDeviceImportSiteCreateProposals } from '@/lib/device-import-staged-site-bulk-create'
import { getDeviceImportBatchWorkspace, DeviceImportStagingError } from '@/lib/device-import-staging-store'

const SAFE_SUGGESTION_SCORE = 0.97
const BULK_SIZE = 250
const MAX_PASSES = 40

function chunks<T>(items: T[], size = BULK_SIZE) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

async function repairPlatformContext(batchId: string) {
  await synchronizeImportedModelPlatforms(batchId)
  await resolveStagedFirmwarePlatforms(batchId)
}

export async function applyAllSafeDeviceImportActions(batchId: string) {
  if (!batchId.trim()) throw new DeviceImportStagingError('Import batch is required.')

  const applied = {
    mappings: 0,
    coreCreated: 0,
    coreLinkedExisting: 0,
    sitesCreated: 0,
    sitesLinkedExisting: 0,
    modelsCreated: 0,
    modelsLinkedExisting: 0,
    familyAssignments: 0,
    familiesCreated: 0,
    familiesReused: 0,
    firmwareCreated: 0,
    firmwareLinkedExisting: 0,
  }

  let passes = 0
  let reachedPassLimit = false

  for (; passes < MAX_PASSES; passes += 1) {
    await repairPlatformContext(batchId)
    const workspace = await getDeviceImportBatchWorkspace(batchId)
    if (workspace.batch.status === 'PUBLISHED') break

    const safeMappings = workspace.references.filter((reference) =>
      reference.status === 'UNRESOLVED' &&
      Boolean(reference.suggestedTargetId) &&
      (reference.suggestionScore ?? 0) >= SAFE_SUGGESTION_SCORE,
    )
    if (safeMappings.length) {
      for (const items of chunks(safeMappings)) {
        await resolveDeviceImportStagedReferencesBulk({
          batchId,
          items: items.map((reference) => ({
            referenceId: reference.id,
            targetId: reference.suggestedTargetId!,
            remember: Boolean(workspace.batch.profileId),
          })),
        })
        applied.mappings += items.length
      }
      continue
    }

    const core = await getDeviceImportCoreAssist(batchId)
    const safeCore = core.proposals.filter((proposal) => !proposal.suggestedTargetId)
    if (safeCore.length) {
      for (const items of chunks(safeCore)) {
        const result = await bulkCreateDeviceImportCoreReferences({
          batchId,
          items: items.map((proposal) => ({
            referenceId: proposal.referenceId,
            name: proposal.proposedName,
            code: proposal.proposedCode,
          })),
        })
        applied.coreCreated += result.created
        applied.coreLinkedExisting += result.linkedExisting
      }
      await rememberReviewedBatchReferences(batchId, ['CUSTOMER', 'VENDOR', 'DEVICE_TYPE', 'CONTRACT_TYPE'])
      continue
    }

    const referenceById = new Map(workspace.references.map((reference) => [reference.id, reference]))
    const sites = await getDeviceImportSiteCreateProposals(batchId)
    const safeSites = sites.proposals.filter((proposal) =>
      Boolean(proposal.existingTarget) || proposal.referenceIds.every((id) => !referenceById.get(id)?.suggestedTargetId),
    )
    if (safeSites.length) {
      for (const items of chunks(safeSites)) {
        const result = await bulkCreateDeviceImportSites({
          batchId,
          items: items.map((proposal) => ({
            referenceIds: proposal.referenceIds,
            name: proposal.name,
            code: proposal.code,
          })),
        })
        applied.sitesCreated += result.created
        applied.sitesLinkedExisting += result.linkedExisting
      }
      continue
    }

    const models = await getDeviceImportModelAssist(batchId)
    const safeModels = models.readyToCreate.filter((proposal) => !referenceById.get(proposal.id)?.suggestedTargetId)
    if (safeModels.length) {
      for (const items of chunks(safeModels)) {
        const result = await bulkCreateDeviceImportModels({
          batchId,
          items: items.map((proposal) => ({
            referenceId: proposal.id,
            model: proposal.proposedModel,
            platform: proposal.proposedPlatform || null,
            platforms: proposal.proposedPlatforms,
            familyId: proposal.suggestedFamilyId,
          })),
        })
        applied.modelsCreated += result.created
        applied.modelsLinkedExisting += result.linkedExisting
      }
      await rememberReviewedBatchReferences(batchId, ['DEVICE_MODEL'])
      continue
    }

    const safeFamilyAssignments = models.linkedModels.filter((model) => !model.familyId && Boolean(model.suggestedFamilyId))
    if (safeFamilyAssignments.length) {
      for (const items of chunks(safeFamilyAssignments)) {
        const result = await bulkAssignDeviceImportModelFamilies({
          batchId,
          items: items.map((model) => ({ modelId: model.id, familyId: model.suggestedFamilyId! })),
        })
        applied.familyAssignments += result.updated
      }
      continue
    }

    if (models.newFamilyProposals.length) {
      for (const items of chunks(models.newFamilyProposals)) {
        const result = await bulkCreateAndAssignDeviceImportModelFamilies({
          batchId,
          items: items.map((proposal) => ({
            vendorId: proposal.vendorId,
            name: proposal.name,
            modelIds: proposal.modelIds,
          })),
        })
        applied.familiesCreated += result.createdFamilies
        applied.familiesReused += result.reusedFamilies
      }
      continue
    }

    await repairPlatformContext(batchId)
    const firmwareWorkspace = await getDeviceImportBatchWorkspace(batchId)
    const firmwareReferenceById = new Map(firmwareWorkspace.references.map((reference) => [reference.id, reference]))
    const firmware = await getDeviceImportFirmwareAssist(batchId)
    const safeFirmware = firmware.proposals.filter((proposal) =>
      Boolean(proposal.platform) &&
      (Boolean(proposal.existingTarget) || proposal.referenceIds.every((id) => !firmwareReferenceById.get(id)?.suggestedTargetId)),
    )
    if (safeFirmware.length) {
      for (const items of chunks(safeFirmware)) {
        const result = await bulkCreateDeviceImportFirmware({
          batchId,
          items: items.map((proposal) => ({
            referenceIds: proposal.referenceIds,
            version: proposal.version,
            platform: proposal.platform,
            status: proposal.status,
          })),
        })
        applied.firmwareCreated += result.created
        applied.firmwareLinkedExisting += result.linkedExisting
      }
      await rememberReviewedBatchReferences(batchId, ['FIRMWARE_RELEASE'])
      continue
    }

    break
  }

  if (passes >= MAX_PASSES) reachedPassLimit = true
  await repairPlatformContext(batchId)
  const workspace = await getDeviceImportBatchWorkspace(batchId)
  const totalApplied = Object.values(applied).reduce((sum, value) => sum + value, 0)

  return {
    applied,
    totalApplied,
    passes: Math.min(passes + 1, MAX_PASSES),
    reachedPassLimit,
    remainingManualReferences: workspace.counts.references.unresolved,
    workspace,
  }
}
