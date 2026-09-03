import { NextResponse } from 'next/server'
import { DeviceImportStagingError, getDeviceImportBatchWorkspace } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    return NextResponse.json({ data: await getDeviceImportBatchWorkspace(batchId) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'IMPORT_BATCH_NOT_FOUND', message: error.message } }, { status: 404 })
    }
    console.error('Failed to load staged import batch', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged import batch could not be loaded.' } },
      { status: 500 },
    )
  }
}
