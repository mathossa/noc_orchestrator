import { NextResponse } from 'next/server'
import { applyAllSafeDeviceImportActions } from '@/lib/device-import-staged-safe-actions'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    return NextResponse.json({ data: await applyAllSafeDeviceImportActions(batchId) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_SAFE_IMPORT_ACTION', message: error.message } }, { status: 400 })
    }
    console.error('Failed to apply safe staged import actions', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Safe import actions could not be applied.' } },
      { status: 500 },
    )
  }
}
