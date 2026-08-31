import { NextResponse } from 'next/server'
import {
  FirmwarePolicyCompatibilityError,
  FirmwarePolicyNotFoundError,
  FirmwarePolicyReferenceError,
  FirmwarePolicyValidationError,
} from '@/lib/firmware-policy-store'

export function firmwarePolicyApiError(error: unknown) {
  if (error instanceof FirmwarePolicyValidationError) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 })
  }
  if (error instanceof FirmwarePolicyReferenceError || error instanceof FirmwarePolicyCompatibilityError) {
    return NextResponse.json({ error: { code: 'INVALID_REFERENCE', message: error.message } }, { status: 400 })
  }
  if (error instanceof FirmwarePolicyNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'Another active desired-firmware policy already exists for this model.' } },
      { status: 409 },
    )
  }

  console.error('Firmware policy request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The desired-firmware policy request could not be completed.' } },
    { status: 500 },
  )
}
