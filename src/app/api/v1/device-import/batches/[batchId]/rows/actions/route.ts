import { NextResponse } from 'next/server'
import {
  applyDeviceImportRowAction,
  getDeviceImportSmartGroups,
} from '@/lib/device-import-staged-rules'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof DeviceImportStagingError) {
    return NextResponse.json({ error: { code: 'INVALID_IMPORT_ROW_ACTION', message: error.message } }, { status: 400 })
  }
  console.error('Failed to update staged import rows', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The staged import row action could not be completed.' } },
    { status: 500 },
  )
}

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    return NextResponse.json({ data: await getDeviceImportSmartGroups(batchId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await applyDeviceImportRowAction({ ...body, batchId }) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    return errorResponse(error)
  }
}
