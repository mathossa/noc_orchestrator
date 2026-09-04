import {
  IMPORTER_V2_FIELDS,
  type ImporterV2Field,
} from '@/lib/importer-v2-evaluator'
import {
  importerV2DurableIdentityOverlaps,
  normalizeImporterV2Identity,
  type ImporterV2IdentityIdentifiers,
} from '@/lib/importer-v2-identity'

export type ImporterV2RepeatClassification =
  | 'NEW'
  | 'CHANGED'
  | 'UNCHANGED'
  | 'MOVED'
  | 'RENAMED'
  | 'MISSING'
  | 'AMBIGUOUS'

export type ImporterV2RepeatSnapshotRow = {
  rowNumber: number
  canonicalDeviceId: string | null
  identifiers: ImporterV2IdentityIdentifiers
  values: Partial<Record<ImporterV2Field, string | null>>
}

export type ImporterV2RepeatCurrentRow = {
  rowNumber: number
  canonicalDeviceId: string | null
  identityStatus: 'MATCHED' | 'NEW' | 'AMBIGUOUS'
  identifiers: ImporterV2IdentityIdentifiers
  values: Partial<Record<ImporterV2Field, string | null>>
  canonicalValues?: Partial<Record<ImporterV2Field, string | null>>
}

export type ImporterV2FieldChange = {
  field: ImporterV2Field
  before: string | null
  after: string | null
}

export type ImporterV2SynchronizationProposal = {
  field: ImporterV2Field
  before: string | null
  after: string | null
  allowed: boolean
  requiresConfirmation: true
  reason:
    | 'SOURCE_OWNED_VALUE'
    | 'CANONICAL_VALUE_BLANK'
    | 'OBSERVED_CURRENT_FIRMWARE'
    | 'MANUAL_VALUE_PROTECTED'
    | 'CANONICAL_STATE_UNKNOWN'
}

export type ImporterV2InactiveProposal = {
  proposed: boolean
  allowed: boolean
  requiresConfirmation: boolean
  reason:
    | 'NOT_FULL_INVENTORY_EXPORT'
    | 'FULL_INVENTORY_CONFIRMATION_REQUIRED'
    | 'AMBIGUOUS_IDENTITY_OVERLAP'
}

export type ImporterV2RepeatDiffItem = {
  rowNumber: number | null
  previousRowNumber: number | null
  canonicalDeviceId: string | null
  classification: ImporterV2RepeatClassification
  changeKinds: readonly ('MOVED' | 'RENAMED' | 'CHANGED')[]
  changes: readonly ImporterV2FieldChange[]
  proposals: readonly ImporterV2SynchronizationProposal[]
  inactiveProposal: ImporterV2InactiveProposal | null
  requiresConfirmation: true
  explanation: string
}

export type ImporterV2RepeatDiffResult = {
  items: readonly ImporterV2RepeatDiffItem[]
  summary: Record<ImporterV2RepeatClassification, number>
}

const MOVED_FIELDS = new Set<ImporterV2Field>([
  'customer',
  'businessUnit',
  'site',
])
const RENAMED_FIELDS = new Set<ImporterV2Field>(['deviceName', 'hostname'])
const OBSERVED_FIRMWARE_FIELDS = new Set<ImporterV2Field>([
  'currentFirmware',
  'firmwareVersion',
  'softwareVersion',
])

function normalizedValue(value: string | null | undefined) {
  if (value === null || value === undefined) return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function stableSourceKey(identifiers: ImporterV2IdentityIdentifiers) {
  const normalized = normalizeImporterV2Identity(identifiers)
  if (normalized.sourceId) return `SOURCE_ID:${normalized.sourceId}`
  if (normalized.serialNumber && normalized.macAddress) {
    return `SERIAL_MAC:${normalized.serialNumber}:${normalized.macAddress}`
  }
  return null
}

function changesBetween(
  before: Partial<Record<ImporterV2Field, string | null>>,
  after: Partial<Record<ImporterV2Field, string | null>>,
) {
  return IMPORTER_V2_FIELDS.filter(
    (field) => normalizedValue(before[field]) !== normalizedValue(after[field]),
  ).map((field) => ({
    field,
    before: before[field] ?? null,
    after: after[field] ?? null,
  }))
}

function classifyChanges(changes: readonly ImporterV2FieldChange[]) {
  if (changes.length === 0) {
    return {
      classification: 'UNCHANGED' as const,
      changeKinds: [] as ('MOVED' | 'RENAMED' | 'CHANGED')[],
    }
  }

  const moved = changes.some((change) => MOVED_FIELDS.has(change.field))
  const renamed = changes.some((change) => RENAMED_FIELDS.has(change.field))
  const changed = changes.some(
    (change) => !MOVED_FIELDS.has(change.field) && !RENAMED_FIELDS.has(change.field),
  )
  const changeKinds: ('MOVED' | 'RENAMED' | 'CHANGED')[] = []
  if (moved) changeKinds.push('MOVED')
  if (renamed) changeKinds.push('RENAMED')
  if (changed) changeKinds.push('CHANGED')

  return {
    classification: moved
      ? ('MOVED' as const)
      : renamed
        ? ('RENAMED' as const)
        : ('CHANGED' as const),
    changeKinds,
  }
}

function proposalForChange(
  current: ImporterV2RepeatCurrentRow,
  change: ImporterV2FieldChange,
): ImporterV2SynchronizationProposal {
  if (OBSERVED_FIRMWARE_FIELDS.has(change.field)) {
    return {
      ...change,
      allowed: true,
      requiresConfirmation: true,
      reason: 'OBSERVED_CURRENT_FIRMWARE',
    }
  }

  const canonicalValues = current.canonicalValues
  if (!canonicalValues || !(change.field in canonicalValues)) {
    return {
      ...change,
      allowed: false,
      requiresConfirmation: true,
      reason: 'CANONICAL_STATE_UNKNOWN',
    }
  }

  const canonicalValue = canonicalValues[change.field] ?? null
  if (normalizedValue(canonicalValue) === null) {
    return {
      ...change,
      allowed: true,
      requiresConfirmation: true,
      reason: 'CANONICAL_VALUE_BLANK',
    }
  }

  if (normalizedValue(canonicalValue) === normalizedValue(change.before)) {
    return {
      ...change,
      allowed: true,
      requiresConfirmation: true,
      reason: 'SOURCE_OWNED_VALUE',
    }
  }

  return {
    ...change,
    allowed: false,
    requiresConfirmation: true,
    reason: 'MANUAL_VALUE_PROTECTED',
  }
}

function emptySummary(): Record<ImporterV2RepeatClassification, number> {
  return {
    NEW: 0,
    CHANGED: 0,
    UNCHANGED: 0,
    MOVED: 0,
    RENAMED: 0,
    MISSING: 0,
    AMBIGUOUS: 0,
  }
}

export function diffImporterV2RepeatImport(input: {
  previousRows: readonly ImporterV2RepeatSnapshotRow[]
  currentRows: readonly ImporterV2RepeatCurrentRow[]
  isFullInventoryExport: boolean
}): ImporterV2RepeatDiffResult {
  const previousByCanonical = new Map<string, number[]>()
  const previousBySourceKey = new Map<string, number[]>()

  input.previousRows.forEach((row, index) => {
    if (row.canonicalDeviceId) {
      previousByCanonical.set(row.canonicalDeviceId, [
        ...(previousByCanonical.get(row.canonicalDeviceId) ?? []),
        index,
      ])
    }
    const key = stableSourceKey(row.identifiers)
    if (key) {
      previousBySourceKey.set(key, [
        ...(previousBySourceKey.get(key) ?? []),
        index,
      ])
    }
  })

  const matchedPrevious = new Set<number>()
  const items: ImporterV2RepeatDiffItem[] = []
  const ambiguousRows = input.currentRows.filter(
    (row) => row.identityStatus === 'AMBIGUOUS',
  )

  for (const current of input.currentRows) {
    if (current.identityStatus === 'AMBIGUOUS') {
      items.push({
        rowNumber: current.rowNumber,
        previousRowNumber: null,
        canonicalDeviceId: current.canonicalDeviceId,
        classification: 'AMBIGUOUS',
        changeKinds: [],
        changes: [],
        proposals: [],
        inactiveProposal: null,
        requiresConfirmation: true,
        explanation:
          'Durable identity is ambiguous. No synchronization proposal is safe until the identity is confirmed.',
      })
      continue
    }

    let previousIndexes: readonly number[] = []
    if (current.identityStatus !== 'NEW' && current.canonicalDeviceId) {
      previousIndexes = previousByCanonical.get(current.canonicalDeviceId) ?? []
    }
    if (current.identityStatus !== 'NEW' && previousIndexes.length === 0) {
      const key = stableSourceKey(current.identifiers)
      if (key) previousIndexes = previousBySourceKey.get(key) ?? []
    }

    if (previousIndexes.length > 1) {
      items.push({
        rowNumber: current.rowNumber,
        previousRowNumber: null,
        canonicalDeviceId: current.canonicalDeviceId,
        classification: 'AMBIGUOUS',
        changeKinds: [],
        changes: [],
        proposals: [],
        inactiveProposal: null,
        requiresConfirmation: true,
        explanation:
          'More than one previous source row could represent this device. No synchronization proposal was generated.',
      })
      continue
    }

    const previousIndex = previousIndexes[0]
    if (previousIndex === undefined) {
      items.push({
        rowNumber: current.rowNumber,
        previousRowNumber: null,
        canonicalDeviceId: current.canonicalDeviceId,
        classification: 'NEW',
        changeKinds: [],
        changes: [],
        proposals: [],
        inactiveProposal: null,
        requiresConfirmation: true,
        explanation:
          'This source device was not present in the latest successful source snapshot.',
      })
      continue
    }

    matchedPrevious.add(previousIndex)
    const previous = input.previousRows[previousIndex]
    const changes = changesBetween(previous.values, current.values)
    const { classification, changeKinds } = classifyChanges(changes)
    const proposals = changes.map((change) => proposalForChange(current, change))

    items.push({
      rowNumber: current.rowNumber,
      previousRowNumber: previous.rowNumber,
      canonicalDeviceId: current.canonicalDeviceId ?? previous.canonicalDeviceId,
      classification,
      changeKinds,
      changes,
      proposals,
      inactiveProposal: null,
      requiresConfirmation: true,
      explanation:
        classification === 'UNCHANGED'
          ? 'The source values are unchanged from the latest successful source snapshot; confirmation is still required.'
          : 'The same durable source device changed since the latest successful source snapshot. Changes are proposals only.',
    })
  }

  input.previousRows.forEach((previous, index) => {
    if (matchedPrevious.has(index)) return
    // A snapshot can retain intentionally ignored/unlinked source rows for
    // repeat evidence. Without a canonical device there is nothing to mark
    // inactive, so these rows must not produce a Missing-device proposal.
    if (!previous.canonicalDeviceId) return

    const ambiguousOverlap = ambiguousRows.some((row) =>
      importerV2DurableIdentityOverlaps(row.identifiers, previous.identifiers),
    )
    const inactiveProposal: ImporterV2InactiveProposal = !input.isFullInventoryExport
      ? {
          proposed: false,
          allowed: false,
          requiresConfirmation: false,
          reason: 'NOT_FULL_INVENTORY_EXPORT',
        }
      : ambiguousOverlap
        ? {
            proposed: false,
            allowed: false,
            requiresConfirmation: true,
            reason: 'AMBIGUOUS_IDENTITY_OVERLAP',
          }
        : {
            proposed: true,
            allowed: true,
            requiresConfirmation: true,
            reason: 'FULL_INVENTORY_CONFIRMATION_REQUIRED',
          }

    items.push({
      rowNumber: null,
      previousRowNumber: previous.rowNumber,
      canonicalDeviceId: previous.canonicalDeviceId,
      classification: 'MISSING',
      changeKinds: [],
      changes: [],
      proposals: [],
      inactiveProposal,
      requiresConfirmation: true,
      explanation:
        'The device is absent from the current source snapshot. It is never deleted automatically.',
    })
  })

  const summary = emptySummary()
  for (const item of items) summary[item.classification] += 1

  return { items, summary }
}
