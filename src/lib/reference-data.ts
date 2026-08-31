export type ReferenceKind = 'vendors' | 'device-types' | 'contract-types'

export type ReferenceRecord = {
  id: string
  code: string
  name: string
  description?: string | null
  websiteUrl?: string | null
  firmwareManagementEnabled?: boolean
  isActive: boolean
}

export type FieldErrors = Record<string, string>

export class ReferenceValidationError extends Error {
  constructor(
    message: string,
    readonly fields: FieldErrors,
  ) {
    super(message)
    this.name = 'ReferenceValidationError'
  }
}

export function cleanReferenceName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function normalizeReferenceName(value: unknown) {
  return cleanReferenceName(value).toLocaleLowerCase('en-US')
}

export function cleanReferenceCode(value: unknown) {
  if (typeof value !== 'string') return ''

  return value.trim().toUpperCase().replace(/[\s_]+/g, '-')
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned.length > 0 ? cleaned : null
}

function validateBaseInput(input: unknown) {
  const body = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const code = cleanReferenceCode(body.code)
  const name = cleanReferenceName(body.name)
  const errors: FieldErrors = {}

  if (!code) errors.code = 'Code is required.'
  else if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(code)) {
    errors.code = 'Use letters, numbers, dots, or hyphens only.'
  }

  if (!name) errors.name = 'Name is required.'
  else if (name.length > 120) errors.name = 'Name must be 120 characters or fewer.'

  if (Object.keys(errors).length > 0) {
    throw new ReferenceValidationError('Please correct the highlighted fields.', errors)
  }

  return { body, code, name }
}

export function parseReferenceInput(kind: ReferenceKind, input: unknown) {
  const { body, code, name } = validateBaseInput(input)
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true

  if (kind === 'vendors') {
    const websiteUrl = optionalText(body.websiteUrl)
    if (websiteUrl) {
      try {
        const parsed = new URL(websiteUrl)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol')
      } catch {
        throw new ReferenceValidationError('Please correct the highlighted fields.', {
          websiteUrl: 'Enter a valid http(s) URL.',
        })
      }
    }

    return { code, name, websiteUrl, isActive }
  }

  const description = optionalText(body.description)

  if (kind === 'contract-types') {
    const firmwareManagementEnabled =
      typeof body.firmwareManagementEnabled === 'boolean' ? body.firmwareManagementEnabled : true

    return { code, name, description, firmwareManagementEnabled, isActive }
  }

  return { code, name, description, isActive }
}

export function findNormalizedNameConflict<T extends { id: string; name: string }>(
  records: T[],
  candidateName: string,
  excludeId?: string,
) {
  const normalized = normalizeReferenceName(candidateName)
  return records.find((record) => record.id !== excludeId && normalizeReferenceName(record.name) === normalized) ?? null
}

export function referencedRecordMessage(kind: ReferenceKind, referenceCount: number) {
  if (referenceCount < 1) return null

  const noun = kind === 'vendors' ? 'vendor' : kind === 'device-types' ? 'device type' : 'contract type'
  return `This ${noun} is referenced by ${referenceCount} record${referenceCount === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`
}
