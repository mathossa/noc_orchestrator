import { NextResponse } from 'next/server'
import { bulkCreateDeviceImportSites } from '@/lib/device-import-staged-site-bulk-create'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await bulkCreateDeviceImportSites({ ...body, batchId }) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_BULK_SITE_CREATE', message: error.message } }, { status: 400 })
    }
    console.error('Failed to bulk-create staged import Sites', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'The staged Sites could not be created.' } },
      { status: 500 },
    )
  }
}
