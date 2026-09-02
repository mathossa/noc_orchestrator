import { NextResponse } from 'next/server'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { rememberReviewedBatchReferences } from '@/lib/device-import-staged-profile-aliases'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'
import {
  bulkAssignDeviceImportModelFamilies,
  bulkCreateAndAssignDeviceImportModelFamilies,
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
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
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
      const data = await bulkCreateDeviceImportModels({ ...body, batchId })
      await rememberReviewedBatchReferences(batchId, ['DEVICE_MODEL'])
      await synchronizeImportedModelPlatforms(batchId)
      await resolveStagedFirmwarePlatforms(batchId)
      return NextResponse.json({ data })
    }
    if (body.action === 'ASSIGN_FAMILIES') {
      return NextResponse.json({ data: await bulkAssignDeviceImportModelFamilies({ ...body, batchId }) })
    }
    if (body.action === 'CREATE_FAMILIES') {
      return NextResponse.json({ data: await bulkCreateAndAssignDeviceImportModelFamilies({ ...body, batchId }) })
    }
    return NextResponse.json({ error: { code: 'INVALID_ACTION', message: 'Choose a supported Model assistant action.' } }, { status: 400 })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    return errorResponse(error)
  }
}
