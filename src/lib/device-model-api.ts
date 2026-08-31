import { NextResponse } from 'next/server'
import { DeviceModelValidationError } from '@/lib/device-models'
import {
  DeviceModelConflictError,
  DeviceModelInUseError,
  DeviceModelNotFoundError,
  DeviceModelReferenceError,
} from '@/lib/device-model-store'

export function deviceModelApiError(error: unknown) {
  if (error instanceof DeviceModelValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }

  if (error instanceof DeviceModelReferenceError) {
    return NextResponse.json(
      { error: { code: 'INVALID_REFERENCE', message: error.message } },
      { status: 400 },
    )
  }

  if (error instanceof DeviceModelConflictError) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: error.message } },
      { status: 409 },
    )
  }

  if (error instanceof DeviceModelInUseError) {
    return NextResponse.json(
      { error: { code: 'REFERENCE_IN_USE', message: error.message } },
      { status: 409 },
    )
  }

  if (error instanceof DeviceModelNotFoundError) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: error.message } },
      { status: 404 },
    )
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This model already exists for the selected vendor.' } },
      { status: 409 },
    )
  }

  console.error('Device model request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The device-model request could not be completed.' } },
    { status: 500 },
  )
}
