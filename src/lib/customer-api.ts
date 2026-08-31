import { NextResponse } from 'next/server'
import { CustomerValidationError } from '@/lib/customers'
import {
  CustomerConflictError,
  CustomerContractError,
  CustomerInUseError,
  CustomerNotFoundError,
} from '@/lib/customer-store'

export function customerApiError(error: unknown) {
  if (error instanceof CustomerValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }

  if (error instanceof CustomerContractError) {
    return NextResponse.json(
      { error: { code: 'INVALID_CONTRACT', message: error.message, fields: { contractTypeId: error.message } } },
      { status: 400 },
    )
  }

  if (error instanceof CustomerConflictError) {
    return NextResponse.json({ error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
  }

  if (error instanceof CustomerInUseError) {
    return NextResponse.json({ error: { code: 'CUSTOMER_IN_USE', message: error.message } }, { status: 409 })
  }

  if (error instanceof CustomerNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  ) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'A customer with this code already exists.' } },
      { status: 409 },
    )
  }

  console.error('Customer request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The customer request could not be completed.' } },
    { status: 500 },
  )
}
