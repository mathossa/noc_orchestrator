import { NextResponse } from 'next/server'
import { FirmwareReleaseValidationError } from '@/lib/firmware-releases'
import {
  FirmwareReleaseConflictError,
  FirmwareReleaseInUseError,
  FirmwareReleaseNotFoundError,
  FirmwareReleaseReferenceError,
} from '@/lib/firmware-release-store'

export function firmwareReleaseApiError(error: unknown) {
  if (error instanceof FirmwareReleaseValidationError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } },
      { status: 400 },
    )
  }
  if (error instanceof FirmwareReleaseReferenceError) {
    return NextResponse.json({ error: { code: 'INVALID_REFERENCE', message: error.message } }, { status: 400 })
  }
  if (error instanceof FirmwareReleaseConflictError) {
    return NextResponse.json({ error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
  }
  if (error instanceof FirmwareReleaseInUseError) {
    return NextResponse.json({ error: { code: 'REFERENCE_IN_USE', message: error.message } }, { status: 409 })
  }
  if (error instanceof FirmwareReleaseNotFoundError) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: error.message } }, { status: 404 })
  }
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'This vendor, platform/family, and version already exist in the catalog.' } },
      { status: 409 },
    )
  }
  console.error('Firmware release request failed', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'The firmware-release request could not be completed.' } },
    { status: 500 },
  )
}
