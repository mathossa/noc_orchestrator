import { NextResponse } from 'next/server'
import { FirmwareLifecycleValidationError } from '@/lib/firmware-lifecycle'
import {
  FirmwareLifecycleNotFoundError,
  FirmwareLifecyclePolicyError,
} from '@/lib/firmware-lifecycle-store'

export function firmwareLifecycleApiError(error: unknown) {
  if (error instanceof FirmwareLifecycleValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }
  if (error instanceof FirmwareLifecycleNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }
  if (error instanceof FirmwareLifecyclePolicyError) {
    return NextResponse.json({ error: { code: 'NO_DESIRED_POLICY', message: error.message } }, { status: 409 })
  }
  console.error('Firmware lifecycle API error', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Firmware lifecycle decision could not be saved.' } },
    { status: 500 },
  )
}
