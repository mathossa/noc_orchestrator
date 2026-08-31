export type CustomerSource = 'MANUAL' | 'API' | 'IMPORT'

export type CustomerRecord = {
  id: string
  code: string | null
  name: string
  contractTypeId: string | null
  contractType: { id: string; code: string; name: string; firmwareManagementEnabled: boolean; isActive: boolean } | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: string | null
  deviceCount: number
}

export type CustomerDetailRecord = CustomerRecord & {
  createdAt: string
  updatedAt: string
  workflowCounts: {
    planned: number
    ignored: number
    customerDeclined: number
    done: number
  }
  desiredStateSummary: {
    available: boolean
    current: number | null
    actionRequired: number | null
  }
}

export type CustomerFieldErrors = Record<string, string>

export class CustomerValidationError extends Error {
  constructor(
    message: string,
    readonly fields: CustomerFieldErrors,
  ) {
    super(message)
    this.name = 'CustomerValidationError'
  }
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return cleaned.length > 0 ? cleaned : null
}

export function cleanCustomerName(value: unknown) {
  return optionalText(value) ?? ''
}

export function cleanCustomerCode(value: unknown) {
  const cleaned = optionalText(value)
  if (!cleaned) return null
  return cleaned.toUpperCase().replace(/[\s_]+/g, '-')
}

export function parseCustomerInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const name = cleanCustomerName(body.name)
  const code = cleanCustomerCode(body.code)
  const contractTypeId = optionalText(body.contractTypeId)
  const source = optionalText(body.source)?.toUpperCase() ?? 'MANUAL'
  const externalProvider = optionalText(body.externalProvider)
  const externalId = optionalText(body.externalId)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
  const errors: CustomerFieldErrors = {}

  if (!name) errors.name = 'Customer name is required.'
  else if (name.length > 160) errors.name = 'Customer name must be 160 characters or fewer.'

  if (code && !/^[A-Z0-9][A-Z0-9.-]*$/.test(code)) {
    errors.code = 'Use letters, numbers, dots, or hyphens only.'
  }

  if (!['MANUAL', 'API', 'IMPORT'].includes(source)) {
    errors.source = 'Choose MANUAL, API, or IMPORT.'
  }

  if (externalProvider && externalProvider.length > 120) {
    errors.externalProvider = 'External provider must be 120 characters or fewer.'
  }

  if (externalId && externalId.length > 255) {
    errors.externalId = 'External ID must be 255 characters or fewer.'
  }

  if (Object.keys(errors).length > 0) {
    throw new CustomerValidationError('Please correct the highlighted fields.', errors)
  }

  return {
    name,
    code,
    contractTypeId,
    source,
    externalProvider,
    externalId,
    isActive,
  }
}
