import { NextResponse } from 'next/server'
import { FirmwareDrilldownNotFoundError } from '@/lib/firmware-drilldown-store'

export function firmwareDrilldownApiError(error: unknown) {
  if (error instanceof FirmwareDrilldownNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }
  console.error('Firmware drill-down request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The firmware drill-down could not be loaded.' } },
    { status: 500 },
  )
}
