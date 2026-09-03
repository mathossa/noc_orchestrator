import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { reviewBlockedActiveDeviceImportRows } from '@/lib/device-import-staged-publication'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

function integerParam(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export async function GET(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)

    const url = new URL(request.url)
    const offset = integerParam(url.searchParams.get('offset'), 0)
    const limit = integerParam(url.searchParams.get('limit'), 50)
    const reason = url.searchParams.get('reason')

    return NextResponse.json({
      data: await reviewBlockedActiveDeviceImportRows(batchId, { offset, limit, reason }),
    })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    console.error('Failed to review blocked staged import rows', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The blocked device rows could not be loaded.' } },
      { status: 500 },
    )
  }
}
