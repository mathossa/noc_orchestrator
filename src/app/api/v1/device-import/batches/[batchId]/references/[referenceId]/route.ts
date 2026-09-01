import { NextResponse } from 'next/server'
import { DeviceImportStagingError, resolveDeviceImportStagedReference } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string; referenceId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId, referenceId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({
      data: await resolveDeviceImportStagedReference({ ...body, batchId, referenceId }),
    })
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
