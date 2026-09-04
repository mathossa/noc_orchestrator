import {
  IMPORTER_V2_FIELDS,
  type ImporterV2Confidence,
  type ImporterV2Field,
} from '@/lib/importer-v2-evaluator'

export type ImporterV2IdentityIdentifiers = {
  sourceId?: string | null
  serialNumber?: string | null
  macAddress?: string | null
}

export type ImporterV2NormalizedIdentityIdentifiers = {
  sourceId: string | null
  serialNumber: string | null
  macAddress: string | null
}

export type ImporterV2IdentityContext = Partial<
  Record<ImporterV2Field, string | null>
>

export type ImporterV2IdentitySource = {
  provider: string
  sourceAdapterId: string
  identifiers: ImporterV2IdentityIdentifiers
  context?: ImporterV2IdentityContext
}

export type ImporterV2IdentityCandidate = {
  canonicalDeviceId: string
  crosswalkId?: string | null
  identifiers: ImporterV2IdentityIdentifiers
  context?: ImporterV2IdentityContext
}

export type ImporterV2IdentitySignalKind =
  | 'SOURCE_ID'
  | 'SERIAL_NUMBER'
  | 'MAC_ADDRESS'

export type ImporterV2IdentitySignal = {
  kind: ImporterV2IdentitySignalKind
  sourceValue: string | null
  candidateValue: string | null
  normalizedSourceValue: string | null
  normalizedCandidateValue: string | null
  status: 'AGREE' | 'DISAGREE' | 'MISSING'
}

export type ImporterV2IdentityContextDifference = {
  field: ImporterV2Field
  sourceValue: string | null
  candidateValue: string | null
}

export type ImporterV2IdentityCandidateResult = {
  canonicalDeviceId: string
  crosswalkId: string | null
  confidence: ImporterV2Confidence
  requiresConfirmation: true
  signals: readonly ImporterV2IdentitySignal[]
  contextDifferences: readonly ImporterV2IdentityContextDifference[]
  explanation: string
}

export type ImporterV2IdentityResolution = {
  kind: 'INVALID' | 'NEW' | 'MATCH_SUGGESTED' | 'AMBIGUOUS'
  requiresConfirmation: boolean
  normalizedIdentifiers: ImporterV2NormalizedIdentityIdentifiers
  candidates: readonly ImporterV2IdentityCandidateResult[]
  options: readonly (
    | 'CONFIRM_MATCH'
    | 'CHOOSE_CANDIDATE'
    | 'CREATE_NEW'
    | 'MANUAL_OVERRIDE'
  )[]
  explanation: string
}

export type ImporterV2SourceIdentityRow = {
  rowNumber: number
  identifiers: ImporterV2IdentityIdentifiers
  values?: Partial<Record<ImporterV2Field, string | null>>
}

export type ImporterV2DuplicateSourceGroup = {
  key: string
  rowNumbers: readonly number[]
  conflictingFields: readonly ImporterV2Field[]
  hasConflicts: boolean
}

export type ImporterV2IdentifierCollision = {
  kind: 'SERIAL_NUMBER' | 'MAC_ADDRESS'
  normalizedValue: string
  rowNumbers: readonly number[]
  explanation: string
}

export type ImporterV2SourceIdentityAnalysis = {
  duplicateGroups: readonly ImporterV2DuplicateSourceGroup[]
  identifierCollisions: readonly ImporterV2IdentifierCollision[]
}

const IDENTITY_FIELDS = new Set<ImporterV2Field>([
  'sourceId',
  'serialNumber',
  'macAddress',
])

function normalizeText(value: string | null | undefined) {
  if (value === null || value === undefined) return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

export function normalizeImporterV2SourceId(
  value: string | null | undefined,
) {
  return normalizeText(value)
}

export function normalizeImporterV2SerialNumber(
  value: string | null | undefined,
) {
  return normalizeText(value)?.toLocaleUpperCase('en-US') ?? null
}

export function normalizeImporterV2MacAddress(
  value: string | null | undefined,
) {
  const text = normalizeText(value)
  if (!text) return null
  const compact = text.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  return /^[0-9A-F]{12}$/.test(compact) ? compact : null
}

export function normalizeImporterV2Identity(
  identifiers: ImporterV2IdentityIdentifiers,
): ImporterV2NormalizedIdentityIdentifiers {
  return {
    sourceId: normalizeImporterV2SourceId(identifiers.sourceId),
    serialNumber: normalizeImporterV2SerialNumber(identifiers.serialNumber),
    macAddress: normalizeImporterV2MacAddress(identifiers.macAddress),
  }
}

function contextDifferences(
  source: ImporterV2IdentityContext | undefined,
  candidate: ImporterV2IdentityContext | undefined,
) {
  return IMPORTER_V2_FIELDS.filter((field) => !IDENTITY_FIELDS.has(field))
    .map((field) => ({
      field,
      sourceValue: source?.[field] ?? null,
      candidateValue: candidate?.[field] ?? null,
    }))
    .filter(
      ({ sourceValue, candidateValue }) =>
        normalizeText(sourceValue) !== normalizeText(candidateValue),
    )
}

function candidateSignals(
  source: ImporterV2NormalizedIdentityIdentifiers,
  candidate: ImporterV2IdentityIdentifiers,
): ImporterV2IdentitySignal[] {
  const normalizedCandidate = normalizeImporterV2Identity(candidate)
  const definitions = [
    ['SOURCE_ID', 'sourceId'],
    ['SERIAL_NUMBER', 'serialNumber'],
    ['MAC_ADDRESS', 'macAddress'],
  ] as const

  return definitions.map(([kind, key]) => {
    const sourceValue = source[key]
    const candidateValue = normalizedCandidate[key]
    return {
      kind,
      sourceValue,
      candidateValue,
      normalizedSourceValue: sourceValue,
      normalizedCandidateValue: candidateValue,
      status:
        sourceValue === null || candidateValue === null
          ? 'MISSING'
          : sourceValue === candidateValue
            ? 'AGREE'
            : 'DISAGREE',
    }
  })
}

function candidateConfidence(signals: readonly ImporterV2IdentitySignal[]) {
  const agreed = signals.filter((signal) => signal.status === 'AGREE')
  const disagreed = signals.filter((signal) => signal.status === 'DISAGREE')
  if (disagreed.length > 0) return 'LOW' as const
  if (
    agreed.some((signal) => signal.kind === 'SOURCE_ID') ||
    agreed.length >= 2
  ) {
    return 'HIGH' as const
  }
  return 'MEDIUM' as const
}

function candidateExplanation(signals: readonly ImporterV2IdentitySignal[]) {
  const agreed = signals
    .filter((signal) => signal.status === 'AGREE')
    .map((signal) => signal.kind)
  const disagreed = signals
    .filter((signal) => signal.status === 'DISAGREE')
    .map((signal) => signal.kind)
  const agreedText = agreed.length > 0 ? agreed.join(', ') : 'no identifiers'
  if (disagreed.length === 0) {
    return `Durable identity agreement: ${agreedText}. Context fields did not affect confidence.`
  }
  return `Durable identity agreement: ${agreedText}; conflicting durable identifiers: ${disagreed.join(', ')}.`
}

export function resolveImporterV2Identity(
  source: ImporterV2IdentitySource,
  candidates: readonly ImporterV2IdentityCandidate[],
): ImporterV2IdentityResolution {
  const normalizedIdentifiers = normalizeImporterV2Identity(source.identifiers)
  const hasDurableIdentity = Object.values(normalizedIdentifiers).some(Boolean)

  if (!hasDurableIdentity) {
    return {
      kind: 'INVALID',
      requiresConfirmation: false,
      normalizedIdentifiers,
      candidates: [],
      options: [],
      explanation:
        'A source ID, serial number, or valid MAC address is required before a device can be proposed.',
    }
  }

  const matchedCandidates = candidates
    .map((candidate) => {
      const signals = candidateSignals(normalizedIdentifiers, candidate.identifiers)
      if (!signals.some((signal) => signal.status === 'AGREE')) return null
      return {
        canonicalDeviceId: candidate.canonicalDeviceId,
        crosswalkId: candidate.crosswalkId ?? null,
        confidence: candidateConfidence(signals),
        requiresConfirmation: true as const,
        signals,
        contextDifferences: contextDifferences(source.context, candidate.context),
        explanation: candidateExplanation(signals),
      }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .toSorted((left, right) => {
      const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 }
      return (
        rank[right.confidence] - rank[left.confidence] ||
        left.canonicalDeviceId.localeCompare(right.canonicalDeviceId)
      )
    })

  if (matchedCandidates.length === 0) {
    return {
      kind: 'NEW',
      requiresConfirmation: true,
      normalizedIdentifiers,
      candidates: [],
      options: ['CREATE_NEW', 'MANUAL_OVERRIDE'],
      explanation:
        'No canonical device is supported by the supplied durable identifiers. Creating a new device still requires confirmation.',
    }
  }

  const hasDurableConflict = matchedCandidates.some((candidate) =>
    candidate.signals.some((signal) => signal.status === 'DISAGREE'),
  )
  const ambiguous = matchedCandidates.length > 1 || hasDurableConflict

  if (ambiguous) {
    return {
      kind: 'AMBIGUOUS',
      requiresConfirmation: true,
      normalizedIdentifiers,
      candidates: matchedCandidates,
      options: ['CHOOSE_CANDIDATE', 'CREATE_NEW', 'MANUAL_OVERRIDE'],
      explanation:
        matchedCandidates.length > 1
          ? 'Durable identifiers support more than one canonical device. The importer must not choose automatically.'
          : 'A durable identifier agrees while another durable identifier conflicts. The importer must not resolve this automatically.',
    }
  }

  return {
    kind: 'MATCH_SUGGESTED',
    requiresConfirmation: true,
    normalizedIdentifiers,
    candidates: matchedCandidates,
    options: ['CONFIRM_MATCH', 'CREATE_NEW', 'MANUAL_OVERRIDE'],
    explanation:
      'One canonical device is supported by durable identity evidence. The suggestion still requires confirmation.',
  }
}

export function importerV2DurableIdentityOverlaps(
  left: ImporterV2IdentityIdentifiers,
  right: ImporterV2IdentityIdentifiers,
) {
  const normalizedLeft = normalizeImporterV2Identity(left)
  const normalizedRight = normalizeImporterV2Identity(right)
  return (
    (normalizedLeft.sourceId !== null &&
      normalizedLeft.sourceId === normalizedRight.sourceId) ||
    (normalizedLeft.serialNumber !== null &&
      normalizedLeft.serialNumber === normalizedRight.serialNumber) ||
    (normalizedLeft.macAddress !== null &&
      normalizedLeft.macAddress === normalizedRight.macAddress)
  )
}

function conflictingFields(rows: readonly ImporterV2SourceIdentityRow[]) {
  return IMPORTER_V2_FIELDS.filter((field) => {
    const values = new Set(
      rows.map((row) => normalizeText(row.values?.[field] ?? null) ?? '<null>'),
    )
    return values.size > 1
  })
}

function rowSignature(rowNumbers: readonly number[]) {
  return [...rowNumbers].sort((left, right) => left - right).join(',')
}

export function analyzeImporterV2SourceRowIdentities(
  rows: readonly ImporterV2SourceIdentityRow[],
): ImporterV2SourceIdentityAnalysis {
  const duplicateBuckets = new Map<string, ImporterV2SourceIdentityRow[]>()
  const serialBuckets = new Map<string, ImporterV2SourceIdentityRow[]>()
  const macBuckets = new Map<string, ImporterV2SourceIdentityRow[]>()

  for (const row of rows) {
    const identity = normalizeImporterV2Identity(row.identifiers)
    const duplicateKey = identity.sourceId
      ? `SOURCE_ID:${identity.sourceId}`
      : identity.serialNumber && identity.macAddress
        ? `SERIAL_MAC:${identity.serialNumber}:${identity.macAddress}`
        : null

    if (duplicateKey) {
      duplicateBuckets.set(duplicateKey, [
        ...(duplicateBuckets.get(duplicateKey) ?? []),
        row,
      ])
    }
    if (identity.serialNumber) {
      serialBuckets.set(identity.serialNumber, [
        ...(serialBuckets.get(identity.serialNumber) ?? []),
        row,
      ])
    }
    if (identity.macAddress) {
      macBuckets.set(identity.macAddress, [
        ...(macBuckets.get(identity.macAddress) ?? []),
        row,
      ])
    }
  }

  const duplicateGroups = [...duplicateBuckets.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, bucket]) => {
      const conflicts = conflictingFields(bucket)
      return {
        key,
        rowNumbers: bucket.map((row) => row.rowNumber).toSorted((a, b) => a - b),
        conflictingFields: conflicts,
        hasConflicts: conflicts.length > 0,
      }
    })
    .toSorted((left, right) => left.key.localeCompare(right.key))

  const duplicateSignatures = new Set(
    duplicateGroups.map((group) => rowSignature(group.rowNumbers)),
  )

  const collisions: ImporterV2IdentifierCollision[] = []
  for (const [normalizedValue, bucket] of serialBuckets) {
    if (bucket.length < 2) continue
    const rowNumbers = bucket.map((row) => row.rowNumber).toSorted((a, b) => a - b)
    if (duplicateSignatures.has(rowSignature(rowNumbers))) continue
    collisions.push({
      kind: 'SERIAL_NUMBER',
      normalizedValue,
      rowNumbers,
      explanation:
        'The serial number is reused by multiple source rows. Serial reuse alone is not treated as a duplicate or automatic identity match.',
    })
  }
  for (const [normalizedValue, bucket] of macBuckets) {
    if (bucket.length < 2) continue
    const rowNumbers = bucket.map((row) => row.rowNumber).toSorted((a, b) => a - b)
    if (duplicateSignatures.has(rowSignature(rowNumbers))) continue
    collisions.push({
      kind: 'MAC_ADDRESS',
      normalizedValue,
      rowNumbers,
      explanation:
        'The MAC address is reused by multiple source rows. MAC reuse alone is not treated as a duplicate or automatic identity match.',
    })
  }

  return {
    duplicateGroups,
    identifierCollisions: collisions.toSorted(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.normalizedValue.localeCompare(right.normalizedValue),
    ),
  }
}
