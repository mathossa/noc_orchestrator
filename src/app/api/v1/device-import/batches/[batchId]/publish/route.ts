import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { DeviceImportStagingError, publishDeviceImportBatch } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    return NextResponse.json({ data: await publishDeviceImportBatch(batchId, session?.user.id ?? null) })
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
