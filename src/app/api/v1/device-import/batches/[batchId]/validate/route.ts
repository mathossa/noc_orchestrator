import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { validateActiveDeviceImportBatch } from '@/lib/device-import-staged-publication'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    return NextResponse.json({ data: await validateActiveDeviceImportBatch(batchId) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    console.error('Failed to validate staged import batch', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged import batch could not be validated.' } },
      { status: 500 },
    )
  }
}
