import { NextResponse } from 'next/server'
import { DeviceImportStagingError, refreshDeviceImportBatchReferences } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    return NextResponse.json({ data: await refreshDeviceImportBatchReferences(batchId) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    console.error('Failed to refresh staged import references', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged import references could not be refreshed.' } },
      { status: 500 },
    )
  }
}
