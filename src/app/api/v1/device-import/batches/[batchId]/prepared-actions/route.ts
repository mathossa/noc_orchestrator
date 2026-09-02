import { NextResponse } from 'next/server'
import { applyPreparedImportActions } from '@/lib/device-import-staged-prepared-actions'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    const body = await request.json()
    return NextResponse.json({ data: await applyPreparedImportActions({ ...(typeof body === 'object' && body !== null ? body : {}), batchId }) })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_PREPARED_IMPORT_ACTION', message: error.message } }, { status: 400 })
    }
    console.error('Failed to apply prepared staged import actions', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Prepared worksheet changes could not be applied.' } },
      { status: 500 },
    )
  }
}
