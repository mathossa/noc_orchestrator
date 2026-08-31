export const FIRMWARE_WORKFLOW_STATES = ['PLANNED', 'IGNORED', 'CUSTOMER_DECLINED', 'DONE'] as const
export type FirmwareWorkflowState = (typeof FIRMWARE_WORKFLOW_STATES)[number]

export type FirmwareLifecycleFieldErrors = Record<string, string>

export class FirmwareLifecycleValidationError extends Error {
  constructor(
    message: string,
    readonly fields: FirmwareLifecycleFieldErrors = {},
  ) {
    super(message)
    this.name = 'FirmwareLifecycleValidationError'
  }
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.normalize('NFKC').trim()
  return cleaned.length > 0 ? cleaned : null
}

function optionalDate(value: unknown, field: string, errors: FirmwareLifecycleFieldErrors) {
  const cleaned = optionalText(value)
  if (!cleaned) return null
  const parsed = new Date(cleaned)
  if (Number.isNaN(parsed.getTime())) {
    errors[field] = 'Enter a valid date and time.'
    return null
  }
  return parsed
}

export function parseFirmwareLifecycleInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const errors: FirmwareLifecycleFieldErrors = {}
  const stateValue = optionalText(body.state)?.toUpperCase() ?? ''
  const state = FIRMWARE_WORKFLOW_STATES.includes(stateValue as FirmwareWorkflowState)
    ? (stateValue as FirmwareWorkflowState)
    : null
  const reason = optionalText(body.reason)
  const notes = optionalText(body.notes)
  const plannedFor = optionalDate(body.plannedFor, 'plannedFor', errors)
  const reviewAt = optionalDate(body.reviewAt, 'reviewAt', errors)

  if (!state) errors.state = 'Choose Planned, Ignored, Customer Declined, or Done.'
  if ((state === 'IGNORED' || state === 'CUSTOMER_DECLINED') && !reason) {
    errors.reason = state === 'IGNORED'
      ? 'A reason is required when a firmware action is ignored.'
      : 'A reason is required when the customer declines the firmware action.'
  }
  if (reason && reason.length > 1000) errors.reason = 'Reason must be 1000 characters or fewer.'
  if (notes && notes.length > 5000) errors.notes = 'Notes must be 5000 characters or fewer.'

  if (Object.keys(errors).length > 0 || !state) {
    throw new FirmwareLifecycleValidationError('Please correct the lifecycle decision fields.', errors)
  }

  return {
    state,
    reason,
    notes,
    plannedFor: state === 'PLANNED' ? plannedFor : null,
    reviewAt: state === 'IGNORED' || state === 'CUSTOMER_DECLINED' ? reviewAt : null,
  }
}
