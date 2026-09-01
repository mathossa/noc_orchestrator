import { NextResponse } from 'next/server'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import {
  bulkAssignDeviceImportModelFamilies,
  bulkCreateDeviceImportModels,
  getDeviceImportModelAssist,
} from '@/lib/device-import-staged-model-assist'

type RouteContext = { params: Promise<{ batchId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof DeviceImportStagingError) {
    return NextResponse.json({ error: { code: 'INVALID_MODEL_ASSIST_ACTION', message: error.message } }, { status: 400 })
  }
  console.error('Failed to run staged import model assistant', error)
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The Model assistant action could not be completed.' } }, { status: 500 })
}

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    return NextResponse.json({ data: await getDeviceImportModelAssist(batchId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json() as Record<string, unknown>
    if (body.action === 'CREATE_MODELS') {
      return NextResponse.json({ data: await bulkCreateDeviceImportModels({ ...body, batchId }) })
    }
    if (body.action === 'ASSIGN_FAMILIES') {
      return NextResponse.json({ data: await bulkAssignDeviceImportModelFamilies({ ...body, batchId }) })
    }
    return NextResponse.json({ error: { code: 'INVALID_ACTION', message: 'Choose a supported Model assistant action.' } }, { status: 400 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    return errorResponse(error)
  }
}
