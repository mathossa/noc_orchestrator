import { NextResponse } from 'next/server'
import { FirmwareTrainValidationError } from '@/lib/firmware-trains'
import {
  FirmwareTrainConflictError,
  FirmwareTrainInUseError,
  FirmwareTrainNotFoundError,
  FirmwareTrainReferenceError,
} from '@/lib/firmware-train-store'

export function firmwareTrainApiError(error: unknown) {
  if (error instanceof FirmwareTrainValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }
  if (error instanceof FirmwareTrainReferenceError) {
    return NextResponse.json({ error: { code: 'INVALID_REFERENCE', message: error.message } }, { status: 400 })
  }
  if (error instanceof FirmwareTrainConflictError) {
    return NextResponse.json({ error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
  }
  if (error instanceof FirmwareTrainInUseError) {
    return NextResponse.json({ error: { code: 'REFERENCE_IN_USE', message: error.message } }, { status: 409 })
  }
  if (error instanceof FirmwareTrainNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This firmware train already exists for the selected vendor and platform.' } },
      { status: 409 },
    )
  }
  console.error('Firmware train request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The firmware-train request could not be completed.' } },
    { status: 500 },
  )
}
