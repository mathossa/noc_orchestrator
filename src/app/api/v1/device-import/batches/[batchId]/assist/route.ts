import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { getDeviceImportCoreAssist } from '@/lib/device-import-staged-core-assist'
import { getDeviceImportFirmwareAssist } from '@/lib/device-import-staged-firmware-assist'
import { repairPlaceholderDeviceImportFirmware } from '@/lib/device-import-staged-firmware-repair'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { getDeviceImportModelAssist } from '@/lib/device-import-staged-model-assist'
import { repairDuplicateDeviceImportModelReferences } from '@/lib/device-import-staged-model-dedup'
import { getDeviceImportSmartGroups } from '@/lib/device-import-staged-rules'
import { listImportProfileRuleWorkspace } from '@/lib/device-import-profile-rule-store'
import { getDeviceImportSiteCreateProposals } from '@/lib/device-import-staged-site-bulk-create'
import { countNormalizableStagedGenericSites } from '@/lib/device-import-staged-site-normalize'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    let workspace = await getDeviceImportBatchWorkspace(batchId)
    if (workspace.batch.status === 'PUBLISHED') {
      return NextResponse.json({
        data: {
          workspace,
          core: { proposals: [] },
          sites: { proposals: [], rawReferenceCount: 0, proposalCount: 0, duplicateReferenceCount: 0, normalizableGenericRowCount: 0 },
          models: { readyToCreate: [], rulePredictions: [], linkedModels: [], families: [], newFamilyProposals: [] },
          firmware: { proposals: [], rawReferenceCount: 0, proposalCount: 0 },
          rows: { profileId: workspace.batch.profileId, groups: [], rowCounts: { PUBLISHED: workspace.batch.totalRows } },
          vendorAliases: [],
          profileRules: { profile: null, rules: [], aliases: [] },
        },
      })
    }

    await repairPlaceholderDeviceImportFirmware(batchId)

    // Keep old staged batches usable in place. Older batches keyed Models by
    // Vendor + Device Type + Model, which could duplicate one canonical Model.
    // Repair that identity once before the other dependency passes.
    await repairDuplicateDeviceImportModelReferences(batchId)
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    workspace = await getDeviceImportBatchWorkspace(batchId)

    const [core, siteProposals, normalizableGenericRowCount, models, firmware, rows, vendorAliases, profileRules] = await Promise.all([
      getDeviceImportCoreAssist(batchId),
      getDeviceImportSiteCreateProposals(batchId),
      countNormalizableStagedGenericSites(batchId),
      getDeviceImportModelAssist(batchId),
      getDeviceImportFirmwareAssist(batchId),
      getDeviceImportSmartGroups(batchId),
      workspace.batch.profileId
        ? prisma.deviceImportProfileAlias.findMany({
            where: { profileId: workspace.batch.profileId, kind: 'VENDOR' },
            select: { sourceValue: true, targetId: true },
          })
        : Promise.resolve([]),
      workspace.batch.profileId
        ? listImportProfileRuleWorkspace(workspace.batch.profileId)
        : Promise.resolve({ profile: null, rules: [], aliases: [] }),
    ])

    return NextResponse.json({
      data: {
        workspace,
        core,
        sites: { ...siteProposals, normalizableGenericRowCount },
        models,
        firmware,
        rows,
        vendorAliases,
        profileRules,
      },
    })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_IMPORT_ASSIST', message: error.message } }, { status: 400 })
    }
    console.error('Failed to load unified import assistant', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The import reconciliation workspace could not be loaded.' } },
      { status: 500 },
    )
  }
}
