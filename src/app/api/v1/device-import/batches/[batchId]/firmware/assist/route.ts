import { NextResponse } from 'next/server'
import { bulkCreateDeviceImportFirmware, getDeviceImportFirmwareAssist } from '@/lib/device-import-staged-firmware-assist'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import { rememberReviewedBatchReferences } from '@/lib/device-import-staged-profile-aliases'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof DeviceImportStagingError) {
    return NextResponse.json({ error: { code: 'INVALID_FIRMWARE_ASSIST_ACTION', message: error.message } }, { status: 400 })
  }
  console.error('Failed to run staged import Firmware assistant', error)
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The Firmware assistant action could not be completed.' } }, { status: 500 })
}

export async function GET(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    await resolveStagedFirmwarePlatforms(batchId)
    return NextResponse.json({ data: await getDeviceImportFirmwareAssist(batchId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    await resolveStagedFirmwarePlatforms(batchId)
    const data = await bulkCreateDeviceImportFirmware({ ...body, batchId })
    await rememberReviewedBatchReferences(batchId, ['FIRMWARE_RELEASE'])
    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    return errorResponse(error)
  }
}
