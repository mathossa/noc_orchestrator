import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { applyPreparedImportActions } from '@/lib/device-import-staged-prepared-actions'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    const data = await applyPreparedImportActions({ ...body, batchId })
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
        { status: 400 },
      )
    }
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json(
        { error: { code: 'INVALID_PREPARED_RECONCILIATION', message: error.message } },
        { status: 400 },
      )
    }
    console.error('Failed to apply prepared import reconciliation', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The prepared reconciliation changes could not be applied.' } },
      { status: 500 },
    )
  }
}
