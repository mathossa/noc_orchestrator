import { NextResponse } from 'next/server'
import { DeviceValidationError } from '@/lib/devices'
import {
  DeviceConflictError,
  DeviceInUseError,
  DeviceNotFoundError,
  DeviceReferenceError,
} from '@/lib/device-store'
import { SiteCustomerError } from '@/lib/site-store'

export function deviceApiError(error: unknown) {
  if (error instanceof DeviceValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }

  if (error instanceof DeviceReferenceError || error instanceof SiteCustomerError) {
    return NextResponse.json(
      { error: { code: 'INVALID_REFERENCE', message: error.message } },
      { status: 400 },
    )
  }

  if (error instanceof DeviceConflictError) {
    return NextResponse.json({ error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
  }

  if (error instanceof DeviceInUseError) {
    return NextResponse.json({ error: { code: 'DEVICE_IN_USE', message: error.message } }, { status: 409 })
  }

  if (error instanceof DeviceNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }

  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This customer already has a device with the same name.' } },
      { status: 409 },
    )
  }

  console.error('Device request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The device request could not be completed.' } },
    { status: 500 },
  )
}
