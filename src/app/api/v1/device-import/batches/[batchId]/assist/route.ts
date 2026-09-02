import { NextResponse } from 'next/server'
import { getDeviceImportCoreAssist } from '@/lib/device-import-staged-core-assist'
import { getDeviceImportFirmwareAssist } from '@/lib/device-import-staged-firmware-assist'
import { getDeviceImportModelAssist } from '@/lib/device-import-staged-model-assist'
import { getDeviceImportSmartGroups } from '@/lib/device-import-staged-rules'
import { getDeviceImportSiteCreateProposals } from '@/lib/device-import-staged-site-bulk-create'
import { countNormalizableStagedGenericSites } from '@/lib/device-import-staged-site-normalize'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const workspace = await getDeviceImportBatchWorkspace(batchId)
    if (workspace.batch.status === 'PUBLISHED') {
      return NextResponse.json({
        data: {
          workspace,
          core: { proposals: [] },
          sites: { proposals: [], rawReferenceCount: 0, proposalCount: 0, duplicateReferenceCount: 0, normalizableGenericRowCount: 0 },
          models: { readyToCreate: [], linkedModels: [], families: [], newFamilyProposals: [] },
          firmware: { proposals: [], rawReferenceCount: 0, proposalCount: 0 },
          rows: { profileId: workspace.batch.profileId, groups: [], rowCounts: { PUBLISHED: workspace.batch.totalRows } },
        },
      })
    }

    const [core, siteProposals, normalizableGenericRowCount, models, firmware, rows] = await Promise.all([
      getDeviceImportCoreAssist(batchId),
      getDeviceImportSiteCreateProposals(batchId),
      countNormalizableStagedGenericSites(batchId),
      getDeviceImportModelAssist(batchId),
      getDeviceImportFirmwareAssist(batchId),
      getDeviceImportSmartGroups(batchId),
    ])

    return NextResponse.json({
      data: {
        workspace,
        core,
        sites: { ...siteProposals, normalizableGenericRowCount },
        models,
        firmware,
        rows,
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
