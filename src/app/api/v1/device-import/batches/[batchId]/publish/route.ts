import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { synchronizeImportedModelPlatforms } from '@/lib/device-import-model-platforms'
import { resolveStagedFirmwarePlatforms } from '@/lib/device-import-staged-firmware-platforms'
import {
  publishActiveDeviceImportBatch,
  type StagedDevicePublishSelection,
} from '@/lib/device-import-staged-publication'
import { DeviceImportStagingError } from '@/lib/device-import-staging-store'

type RouteContext = { params: Promise<{ batchId: string }> }

function publishSelection(value: unknown): StagedDevicePublishSelection {
  const input = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  if (input.mode === 'VALID') return { mode: 'VALID' }
  if (input.mode === 'ROWS') return { mode: 'ROWS', rows: Array.isArray(input.rows) ? input.rows.map(Number) : [] }
  return { mode: 'ALL' }
}

export async function POST(request: Request, context: RouteContext) {
  const { batchId } = await context.params
  try {
    await synchronizeImportedModelPlatforms(batchId)
    await resolveStagedFirmwarePlatforms(batchId)
    const session = await auth.api.getSession({ headers: request.headers })
    const body = await request.json().catch(() => ({}))
    return NextResponse.json({
      data: await publishActiveDeviceImportBatch(batchId, session?.user.id ?? null, publishSelection(body)),
    })
  } catch (error) {
    if (error instanceof DeviceImportStagingError) {
      return NextResponse.json({ error: { code: 'INVALID_STAGED_IMPORT', message: error.message } }, { status: 400 })
    }
    console.error('Failed to publish staged import batch', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Device publication stopped unexpectedly. Completed chunks remain published; reload the batch to see what is still staged and retry the remainder.',
        },
      },
      { status: 500 },
    )
  }
}
