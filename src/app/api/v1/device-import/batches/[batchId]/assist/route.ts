import { NextResponse } from 'next/server'
import { getDeviceImportCoreAssist } from '@/lib/device-import-staged-core-assist'
import { getDeviceImportFirmwareAssist } from '@/lib/device-import-staged-firmware-assist'
import { repairPlaceholderDeviceImportFirmware } from '@/lib/device-import-staged-firmware-repair'
import { getDeviceImportModelAssist } from '@/lib/device-import-staged-model-assist'
import { repairDuplicateDeviceImportModelReferences } from '@/lib/device-import-staged-model-dedup'
import { listImportProfileRuleWorkspace } from '@/lib/device-import-profile-rule-store'
import { getDeviceImportSmartGroups } from '@/lib/device-import-staged-rules'
import { getDeviceImportSiteCreateProposals } from '@/lib/device-import-staged-site-bulk-create'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ batchId: string }> }

async function installRemainingRowSample(batchId: string, workspace: Awaited<ReturnType<typeof getDeviceImportBatchWorkspace>>) {
  const rows = await prisma.deviceImportStagedRow.findMany({
    where: { batchId, status: { not: 'PUBLISHED' } },
    orderBy: { rowNumber: 'asc' },
    take: 100,
    select: { id: true, rowNumber: true, rawData: true, mappedData: true, status: true },
  })
  workspace.rows = rows
  workspace.counts.rows.sample = rows.length
  return workspace
}

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    // Read only the lightweight batch state first. Building the complete
    // workspace loads the reference/options universe and should happen once.
    const batch = await prisma.deviceImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, profileId: true },
    })
    if (!batch) throw new DeviceImportStagingError('Import batch was not found.')

    if (batch.status === 'PUBLISHED') {
      const [workspace, rows] = await Promise.all([
        getDeviceImportBatchWorkspace(batchId),
        getDeviceImportSmartGroups(batchId),
      ])
      return NextResponse.json({
        data: {
          workspace,
          core: { proposals: [] },
          sites: { proposals: [] },
          models: { readyToCreate: [], rulePredictions: [], linkedModels: [], families: [], newFamilyProposals: [] },
          firmware: { proposals: [], rawReferenceCount: 0, proposalCount: 0 },
          rows,
          vendorAliases: [],
          profileRules: { profile: null, rules: [], aliases: [] },
        },
      })
    }

    // These are version-marked legacy migrations. They execute at most once
    // for an old staged batch. Keep them serial: each migration can rewrite and
    // refresh staged references, so running them concurrently risks one repair
    // rebuilding state while the other repair is deleting/merging it.
    await repairPlaceholderDeviceImportFirmware(batchId)
    await repairDuplicateDeviceImportModelReferences(batchId)

    const workspace = await installRemainingRowSample(batchId, await getDeviceImportBatchWorkspace(batchId))
    const [core, sites, models, firmware, rows, vendorAliases, profileRules] = await Promise.all([
      getDeviceImportCoreAssist(batchId),
      getDeviceImportSiteCreateProposals(batchId),
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
        sites,
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
