import { NextResponse } from 'next/server'
import {
  FIRMWARE_WORK_PLAN_STATES,
  FirmwareWorkPlanTransitionError,
  type FirmwareWorkPlanState,
} from '@/lib/firmware-work-planning'
import type { FirmwareWorkPlanQuery } from '@/lib/firmware-work-plan-query-store'

const FIRMWARE_RECOMMENDATIONS = [
  'NO_ACTION',
  'UPDATE_RECOMMENDED',
  'UPDATE_REQUIRED',
  'PLATFORM_MIGRATION',
  'REVIEW_REQUIRED',
] as const

export class FirmwareWorkPlanApiValidationError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'FirmwareWorkPlanApiValidationError'
  }
}

function cleaned(value: string | null) {
  return (value ?? '').normalize('NFKC').trim()
}

function positiveInteger(
  value: string | null,
  field: string,
  errors: Record<string, string>,
) {
  if (!value) return undefined
  if (!/^\d+$/.test(value)) {
    errors[field] = 'Enter a positive integer.'
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    errors[field] = 'Enter a positive integer.'
    return undefined
  }
  return parsed
}

function parseInstant(
  value: unknown,
  field: string,
  required: boolean,
): Date | undefined {
  if (value == null || value === '') {
    if (required)
      throw new FirmwareWorkPlanApiValidationError(
        `${field} is required.`,
        { [field]: 'Enter a date and time.' },
      )
    return undefined
  }
  if (typeof value !== 'string') {
    throw new FirmwareWorkPlanApiValidationError(
      `${field} must be an ISO 8601 timestamp.`,
      { [field]: 'Enter a valid date and time.' },
    )
  }
  const normalized = value.trim()
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    throw new FirmwareWorkPlanApiValidationError(
      `${field} must include an explicit timezone.`,
      { [field]: 'Include a timezone so the intended instant is unambiguous.' },
    )
  }
  const parsed = new Date(normalized)
  if (!Number.isFinite(parsed.getTime())) {
    throw new FirmwareWorkPlanApiValidationError(
      `${field} must be a valid timestamp.`,
      { [field]: 'Enter a valid date and time.' },
    )
  }
  return parsed
}

function state(value: unknown, field: string): FirmwareWorkPlanState {
  if (
    typeof value !== 'string' ||
    !FIRMWARE_WORK_PLAN_STATES.includes(value as FirmwareWorkPlanState)
  ) {
    throw new FirmwareWorkPlanApiValidationError(
      `${field} must be a supported firmware work plan state.`,
      { [field]: 'Choose a supported work plan state.' },
    )
  }
  return value as FirmwareWorkPlanState
}

function optionalText(value: unknown, field: string) {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string')
    throw new FirmwareWorkPlanApiValidationError(`${field} must be text.`, {
      [field]: 'Enter text.',
    })
  return value
}

export function parseFirmwareWorkPlanQuery(
  params: URLSearchParams,
): FirmwareWorkPlanQuery {
  const errors: Record<string, string> = {}
  const stateValues = params
    .getAll('state')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
  const states = stateValues.map((value) => {
    if (!FIRMWARE_WORK_PLAN_STATES.includes(value as FirmwareWorkPlanState)) {
      errors.state = 'Choose supported work plan states.'
      return null
    }
    return value as FirmwareWorkPlanState
  })
  const page = positiveInteger(params.get('page'), 'page', errors)
  const pageSize = positiveInteger(params.get('pageSize'), 'pageSize', errors)
  if (pageSize && pageSize > 200)
    errors.pageSize = 'Choose a page size of 200 or less.'
  const recommendation = cleaned(params.get('recommendation')).toUpperCase()
  if (
    recommendation &&
    !FIRMWARE_RECOMMENDATIONS.includes(
      recommendation as (typeof FIRMWARE_RECOMMENDATIONS)[number],
    )
  )
    errors.recommendation = 'Choose a supported firmware recommendation.'

  let scheduledFrom: Date | undefined
  let scheduledUntil: Date | undefined
  try {
    scheduledFrom = parseInstant(
      cleaned(params.get('scheduledFrom')),
      'scheduledFrom',
      false,
    )
  } catch (error) {
    if (error instanceof FirmwareWorkPlanApiValidationError)
      Object.assign(errors, error.fields)
    else throw error
  }
  try {
    scheduledUntil = parseInstant(
      cleaned(params.get('scheduledUntil')),
      'scheduledUntil',
      false,
    )
  } catch (error) {
    if (error instanceof FirmwareWorkPlanApiValidationError)
      Object.assign(errors, error.fields)
    else throw error
  }

  if (
    scheduledFrom &&
    scheduledUntil &&
    scheduledFrom.getTime() >= scheduledUntil.getTime()
  ) {
    errors.scheduledUntil = 'End must be after start.'
  }
  if (Object.keys(errors).length)
    throw new FirmwareWorkPlanApiValidationError(
      'Invalid firmware planning query.',
      errors,
    )

  return {
    ...(states.length ? { states: states.filter(Boolean) as FirmwareWorkPlanState[] } : {}),
    ...(cleaned(params.get('customerId'))
      ? { customerId: cleaned(params.get('customerId')) }
      : {}),
    ...(cleaned(params.get('siteId'))
      ? { siteId: cleaned(params.get('siteId')) }
      : {}),
    ...(cleaned(params.get('deviceId'))
      ? { deviceId: cleaned(params.get('deviceId')) }
      : {}),
    ...(cleaned(params.get('deviceModelId'))
      ? { deviceModelId: cleaned(params.get('deviceModelId')) }
      : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(scheduledFrom ? { scheduledFrom } : {}),
    ...(scheduledUntil ? { scheduledUntil } : {}),
    ...(page ? { page } : {}),
    ...(pageSize ? { pageSize } : {}),
  }
}

export function parseFirmwareWorkPlanTransition(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new FirmwareWorkPlanApiValidationError(
      'Request body must be an object.',
    )
  const body = raw as Record<string, unknown>
  const expectedState = state(body.expectedState, 'expectedState')
  const toState = state(body.toState, 'toState')
  const expectedUpdatedAt = parseInstant(
    body.expectedUpdatedAt,
    'expectedUpdatedAt',
    true,
  )!
  const reason = optionalText(body.reason, 'reason')
  const notes = optionalText(body.notes, 'notes')

  if (toState === 'SCHEDULED') {
    return {
      expectedState,
      expectedUpdatedAt,
      toState,
      scheduledFor: parseInstant(body.scheduledFor, 'scheduledFor', true)!,
      maintenanceWindowReference: optionalText(
        body.maintenanceWindowReference,
        'maintenanceWindowReference',
      ),
      reason,
      notes,
    }
  }

  if (
    body.scheduledFor !== undefined ||
    body.maintenanceWindowReference !== undefined
  ) {
    throw new FirmwareWorkPlanApiValidationError(
      'Scheduling fields are only valid when entering SCHEDULED.',
      {
        scheduledFor: 'Remove scheduling fields or choose SCHEDULED.',
      },
    )
  }

  return {
    expectedState,
    expectedUpdatedAt,
    toState: toState as Exclude<FirmwareWorkPlanState, 'SCHEDULED'>,
    reason,
    notes,
  }
}

export function firmwareWorkPlanApiError(error: unknown) {
  if (error instanceof FirmwareWorkPlanApiValidationError)
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          fields: error.fields,
        },
      },
      { status: 400 },
    )

  if (error instanceof FirmwareWorkPlanTransitionError)
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_TRANSITION',
          message: error.message,
        },
      },
      { status: 409 },
    )

  if (
    error instanceof Error &&
    error.name === 'FirmwareWorkPlanError' &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    const stalePreview = error.status === 409 && /preview/i.test(error.message)
    const staleWrite =
      error.status === 409 &&
      /changed|reload before transitioning/i.test(error.message)
    return NextResponse.json(
      {
        error: {
          code:
            error.status === 404
              ? 'NOT_FOUND'
              : stalePreview
                ? 'STALE_PREVIEW'
                : staleWrite
                  ? 'STALE_WRITE'
                  : error.status === 409
                    ? 'CONFLICT'
                    : 'VALIDATION_ERROR',
          message: staleWrite
            ? 'This plan changed after it was displayed. Refresh and review the latest state before applying the transition.'
            : error.message,
        },
      },
      { status: error.status },
    )
  }

  if (error instanceof SyntaxError)
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must contain valid JSON.',
        },
      },
      { status: 400 },
    )

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2034', 'P2002'].includes(String(error.code))
  )
    return NextResponse.json(
      {
        error: {
          code: 'CONFLICT',
          message:
            'Planning data changed while the request was being processed. Refresh and review before trying again.',
        },
      },
      { status: 409 },
    )

  console.error('Firmware work plan request failed', error)
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The firmware planning request could not be completed.',
      },
    },
    { status: 500 },
  )
}
