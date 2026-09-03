import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { createMissingImportEntity } from '@/lib/device-import-staged-manual-create'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string; referenceId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId, referenceId } = await context.params
  try {
    const body = await request.json()
    const result = await createMissingImportEntity(batchId, referenceId, body)
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    return NextResponse.json({ data: { result, workspace: await getDeviceImportBatchWorkspace(batchId) } }, { status: 201 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_MANUAL_CREATE', message: error.message } }, { status: 400 })
    }
    console.error('Failed to create missing staged import entity', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The missing entity could not be created.' } },
      { status: 500 },
    )
  }
}
