import { NextResponse } from 'next/server'
import { ReferenceValidationError } from '@/lib/reference-data'
import {
  ReferenceConflictError,
  ReferenceInUseError,
  ReferenceNotFoundError,
} from '@/lib/reference-data-store'

export function referenceApiError(error: unknown) {
  if (error instanceof ReferenceValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }

  if (error instanceof ReferenceConflictError) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: error.message } },
      { status: 409 },
    )
  }

  if (error instanceof ReferenceInUseError) {
    return NextResponse.json(
      { error: { code: 'REFERENCE_IN_USE', message: error.message } },
      { status: 409 },
    )
  }

  if (error instanceof ReferenceNotFoundError) {
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
      { error: { code: 'CONFLICT', message: 'A reference record with this code or normalized name already exists.' } },
      { status: 409 },
    )
  }

  console.error('Reference data request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The reference-data request could not be completed.' } },
    { status: 500 },
  )
}
