const MAX_BULK_REFERENCES = 250

export type BulkResolutionItem = {
  referenceId: string
  targetId: string
  remember: boolean
}

export type BulkReferenceResolutionInput = {
  batchId: string
  items: BulkResolutionItem[]
}

export class DeviceImportBulkInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeviceImportBulkInputError'
  }
}

export function parseBulkReferenceResolutionInput(rawInput: unknown): BulkReferenceResolutionInput {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const rawItems = Array.isArray(input.items) ? input.items : []

  if (!batchId) throw new DeviceImportBulkInputError('Import batch is required.')
  if (!rawItems.length) throw new DeviceImportBulkInputError('Choose at least one staged reference to link.')
  if (rawItems.length > MAX_BULK_REFERENCES) {
    throw new DeviceImportBulkInputError(`Resolve at most ${MAX_BULK_REFERENCES} reference values in one bulk action.`)
  }

  const seen = new Set<string>()
  const items: BulkResolutionItem[] = rawItems.map((rawItem) => {
    const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
    const referenceId = typeof item.referenceId === 'string' ? item.referenceId.trim() : ''
    const targetId = typeof item.targetId === 'string' ? item.targetId.trim() : ''
    const remember = item.remember === true
    if (!referenceId || !targetId) {
      throw new DeviceImportBulkInputError('Every bulk mapping needs a staged reference and target.')
    }
    if (seen.has(referenceId)) {
      throw new DeviceImportBulkInputError('A staged reference can only appear once in a bulk action.')
    }
    seen.add(referenceId)
    return { referenceId, targetId, remember }
  })

  return { batchId, items }
}
