import { NextResponse } from 'next/server'
import { FirmwareDocumentationError } from '@/lib/firmware-release-documentation-store'
import { AdminAccessError } from '@/lib/api-admin'

export function documentationApiError(error: unknown) {
  if (error instanceof AdminAccessError) {
    return NextResponse.json(
      { error: { code: 'ACCESS_DENIED', message: error.message } },
      { status: error.status },
    )
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } },
      { status: 400 },
    )
  }
  if (error instanceof FirmwareDocumentationError) {
    return NextResponse.json({ error: { message: error.message } }, { status: error.status })
  }
  console.error('Firmware documentation request failed', error)
  return NextResponse.json({ error: { message: 'Documentation request failed.' } }, { status: 500 })
}
