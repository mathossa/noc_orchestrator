import { NextResponse } from 'next/server'
import { rememberReviewedBatchReferences } from '@/lib/device-import-staged-profile-aliases'
import {
  bulkCreateDeviceImportCoreReferences,
  getDeviceImportCoreAssist,
} from '@/lib/device-import-staged-core-assist'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof DeviceImportStagingError) {
    return NextResponse.json({ error: { code: 'INVALID_CORE_ASSIST_ACTION', message: error.message } }, { status: 400 })
  }
  console.error('Failed to run staged import core assistant', error)
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The import proposal action could not be completed.' } }, { status: 500 })
}

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    return NextResponse.json({ data: await getDeviceImportCoreAssist(batchId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    const data = await bulkCreateDeviceImportCoreReferences({ ...body, batchId })
    await rememberReviewedBatchReferences(batchId, ['CUSTOMER', 'VENDOR', 'DEVICE_TYPE', 'CONTRACT_TYPE'])
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    return errorResponse(error)
  }
}
