import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { DeviceImportReferenceError } from '@/lib/device-import-reference-store'
import { resolveDeviceImportStagedReferencesBulk } from '@/lib/device-import-staged-reference-bulk'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    await resolveDeviceImportStagedReferencesBulk({ ...body, batchId })
    await synchronizeImportedModelPlatforms(batchId)
    return NextResponse.json({ data: await getDeviceImportBatchWorkspace(batchId) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    if (error instanceof DeviceImportStagingError || error instanceof DeviceImportReferenceError) {
      return NextResponse.json(
        { error: { code: 'INVALID_STAGED_REFERENCES', message: error.message } },
        { status: 400 },
      )
    }
    console.error('Failed to bulk resolve staged import references', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged references could not be resolved.' } },
      { status: 500 },
    )
  }
}
