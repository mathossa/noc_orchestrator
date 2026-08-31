import { NextResponse } from 'next/server'
import { SiteValidationError } from '@/lib/sites'
import {
  SiteConflictError,
  SiteContractError,
  SiteCustomerError,
  SiteInUseError,
  SiteNotFoundError,
} from '@/lib/site-store'

export function siteApiError(error: unknown) {
  if (error instanceof SiteValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }

  if (error instanceof SiteCustomerError) {
    return NextResponse.json(
      { error: { code: 'INVALID_CUSTOMER', message: error.message } },
      { status: 400 },
    )
  }

  if (error instanceof SiteContractError) {
    return NextResponse.json(
      { error: { code: 'INVALID_CONTRACT', message: error.message, fields: { contractTypeId: error.message } } },
      { status: 400 },
    )
  }

  if (error instanceof SiteConflictError) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: error.message } },
      { status: 409 },
    )
  }

  if (error instanceof SiteInUseError) {
    return NextResponse.json(
      { error: { code: 'REFERENCE_IN_USE', message: error.message } },
      { status: 409 },
    )
  }

  if (error instanceof SiteNotFoundError) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: error.message } },
      { status: 404 },
    )
  }

  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This customer already has a site with the same name or code.' } },
      { status: 409 },
    )
  }

  console.error('Site request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The site request could not be completed.' } },
    { status: 500 },
  )
}
