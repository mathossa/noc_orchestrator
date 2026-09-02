import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'
import { resolveDeviceImportStagedReferenceIncrementally } from '@/lib/device-import-staged-reference-resolver'

type RouteContext = { params: Promise<{ batchId: string; referenceId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId, referenceId } = await context.params
  try {
    const body = await request.json()
    await resolveDeviceImportStagedReferenceIncrementally({ ...body, batchId, referenceId })
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    return NextResponse.json({ data: await getDeviceImportBatchWorkspace(batchId) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_REFERENCE', message: error.message } }, { status: 400 })
    }
    console.error('Failed to resolve staged import reference', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged reference could not be resolved.' } },
      { status: 500 },
    )
  }
}
