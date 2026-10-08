import { NextResponse } from 'next/server'
import { FirmwareDocumentationError } from '@/lib/firmware-release-documentation-store'

export function documentationApiError(error: unknown) {
  if (error instanceof FirmwareDocumentationError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }
  console.error('Firmware documentation request failed', error)
  return NextResponse.json({ error: { message: 'Documentation request failed.' } }, { status: 500 })
}
