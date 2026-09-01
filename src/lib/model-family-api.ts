import { NextResponse } from 'next/server'
import { DeviceModelFamilyValidationError } from '@/lib/model-families'
import {
  DeviceModelFamilyConflictError,
  DeviceModelFamilyInUseError,
  DeviceModelFamilyNotFoundError,
  DeviceModelFamilyReferenceError,
} from '@/lib/model-family-store'

export function deviceModelFamilyApiError(error: unknown) {
  if (error instanceof DeviceModelFamilyValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }
  if (error instanceof DeviceModelFamilyReferenceError) {
    return NextResponse.json({ error: { code: 'INVALID_REFERENCE', message: error.message } }, { status: 400 })
  }
  if (error instanceof DeviceModelFamilyConflictError) {
    return NextResponse.json({ error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
  }
  if (error instanceof DeviceModelFamilyInUseError) {
    return NextResponse.json({ error: { code: 'REFERENCE_IN_USE', message: error.message } }, { status: 409 })
  }
  if (error instanceof DeviceModelFamilyNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This family / series already exists for the selected vendor.' } },
      { status: 409 },
    )
  }
  console.error('Device model family request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The model-family request could not be completed.' } },
    { status: 500 },
  )
}
