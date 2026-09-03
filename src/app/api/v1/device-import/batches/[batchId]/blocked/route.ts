import { NextResponse } from 'next/server'
import { reviewBlockedActiveDeviceImportRows } from '@/lib/device-import-staged-publication'
import { applyDeviceImportBlockedRepair } from '@/lib/device-import-staged-repairs'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

function integerParam(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof DeviceImportStagingError) {
    return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
  }
  console.error(fallback, error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The blocked device action could not be completed.' } },
    { status: 500 },
  )
}

export async function GET(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const url = new URL(request.url)
    const offset = integerParam(url.searchParams.get('offset'), 0)
    const limit = integerParam(url.searchParams.get('limit'), 50)
    const reason = url.searchParams.get('reason')

    return NextResponse.json({
      data: await reviewBlockedActiveDeviceImportRows(batchId, { offset, limit, reason }),
    })
  } catch (error) {
    return errorResponse(error, 'Failed to review blocked staged import rows')
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await applyDeviceImportBlockedRepair({ ...body, batchId }) })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } }, { status: 400 })
    }
    return errorResponse(error, 'Failed to repair blocked staged import rows')
  }
}
