import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { publishActiveDeviceImportBatch } from '@/lib/device-import-staged-publication'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({ data: await publishActiveDeviceImportBatch(batchId, session?.user.id ?? null) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    console.error('Failed to publish staged import batch', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged import batch could not be published.' } },
      { status: 500 },
    )
  }
}
