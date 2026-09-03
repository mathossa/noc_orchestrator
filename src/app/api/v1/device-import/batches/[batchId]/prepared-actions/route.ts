import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { applyPreparedImportActions } from '@/lib/device-import-staged-prepared-actions'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    const applied = await applyPreparedImportActions({
      ...(typeof body === 'object' && body !== null ? body : {}),
      batchId,
    })

    // Dependency-changing writes belong to the write request, not the next GET.
    // This makes the worksheet read path stable and ensures a Model link/create
    // immediately propagates its supported Platform before Firmware is resolved.
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    const workspace = await getDeviceImportBatchWorkspace(batchId)

    return NextResponse.json({
      data: {
        ...applied,
        remaining: workspace.counts.references.unresolved,
        workspace,
      },
    })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_PREPARED_IMPORT_ACTION', message: error.message } }, { status: 400 })
    }
    console.error('Failed to apply prepared staged import actions', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Prepared worksheet changes could not be applied.' } },
      { status: 500 },
    )
  }
}
