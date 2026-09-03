import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { repairPlaceholderDeviceImportFirmware } from '@/lib/device-import-staged-firmware-repair'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { repairDuplicateDeviceImportModelReferences } from '@/lib/device-import-staged-model-dedup'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace, refreshDeviceImportBatchReferences } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    // Refresh is the explicit maintenance/reconciliation write path. Keeping
    // these mutations here prevents ordinary worksheet GETs from repeatedly
    // rescanning and rewriting the staged batch.
    await repairPlaceholderDeviceImportFirmware(batchId)
    await repairDuplicateDeviceImportModelReferences(batchId)
    await refreshDeviceImportBatchReferences(batchId)
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    return NextResponse.json({ data: await getDeviceImportBatchWorkspace(batchId) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    console.error('Failed to refresh staged import references', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged import references could not be refreshed.' } },
      { status: 500 },
    )
  }
}
