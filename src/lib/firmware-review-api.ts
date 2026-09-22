// SPDX-License-Identifier: AGPL-3.0-only
import { NextResponse } from 'next/server'
import {
  FIRMWARE_REVIEW_STATES,
  FirmwareReviewValidationError,
} from '@/lib/firmware-review'
import { FirmwareReviewError } from '@/lib/firmware-review-store'

export function parseFirmwareReviewQuery(params: URLSearchParams) {
  const customerId = params.get('customerId')?.trim() || undefined
  const stateValue = params.get('state')?.trim().toUpperCase()
  if (
    stateValue &&
    !FIRMWARE_REVIEW_STATES.includes(
      stateValue as (typeof FIRMWARE_REVIEW_STATES)[number],
    )
  )
    throw new FirmwareReviewValidationError('Choose a supported review state.')

  return {
    customerId,
    state: stateValue || undefined,
  }
}

export function firmwareReviewApiError(error: unknown) {
  if (
    error instanceof FirmwareReviewValidationError ||
    error instanceof FirmwareReviewError
  ) {
    const status = error instanceof FirmwareReviewError ? error.status : 400
    return NextResponse.json(
      {
        error: {
          code:
            status === 404
              ? 'NOT_FOUND'
              : status === 409
                ? 'CONFLICT'
                : 'VALIDATION_ERROR',
          message: error.message,
        },
      },
      { status },
    )
  }

  console.error(error)
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Firmware review request failed.',
      },
    },
    { status: 500 },
  )
}
