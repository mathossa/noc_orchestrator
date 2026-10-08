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

export type ImporterV2IdentityEvidence = {
  kind: 'CANONICAL' | 'CROSSWALK'
  provider: string | null
  crosswalkId?: string | null
  lastSeenAt?: string | null
  sourceId: string | null
  serialNumber: string | null
  macAddress: string | null
  sourceIdState?: string | null
  serialNumberState?: string | null
  macAddressState?: string | null
}

export type ImporterV2IdentityCandidate = {
  canonicalDeviceId: string
  crosswalkId?: string | null
  /**
   * SAME_PROVIDER candidates may compare provider-local Source IDs.
   * CROSS_PROVIDER and CANONICAL candidates must never compare Source IDs
   * because those values live in unrelated provider namespaces.
   */
  matchScope?: 'SAME_PROVIDER' | 'CROSS_PROVIDER' | 'CANONICAL'
  identifiers: ImporterV2IdentityIdentifiers
  context?: ImporterV2IdentityContext
  evidence?: readonly ImporterV2IdentityEvidence[]
  hasConflictingDurableEvidence?: boolean
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
  matchScope: 'SAME_PROVIDER' | 'CROSS_PROVIDER' | 'CANONICAL'
  confidence: ImporterV2Confidence
  requiresConfirmation: true
  signals: readonly ImporterV2IdentitySignal[]
  contextDifferences: readonly ImporterV2IdentityContextDifference[]
  evidence: readonly ImporterV2IdentityEvidence[]
  evidenceConflict: boolean
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

/**
 * Keep durable values reported by the source as crosswalk aliases for ordinary
 * canonical corrections. An explicit IGNORE_FIELD / CLEAR_FIELD decision is
 * different: that source identifier has been declared unreliable for durable
 * identity and must not be reintroduced into the crosswalk from raw evidence.
 * Raw evidence itself remains immutable in the staged snapshot.
 */
export function importerV2SourceIdentityForCrosswalk(input: {
  rawIdentifiers: ImporterV2IdentityIdentifiers
  effectiveIdentifiers: ImporterV2IdentityIdentifiers
  suppressedSourceFields?: readonly string[]
}): { sourceId: string | null; serialNumber: string | null; macAddress: string | null } {
  const suppressed = new Set(input.suppressedSourceFields ?? [])
  const value = (
    field: keyof ImporterV2IdentityIdentifiers,
  ) =>
    suppressed.has(field)
      ? null
      : normalizeText(input.rawIdentifiers[field]) ??
        normalizeText(input.effectiveIdentifiers[field])

  return {
    sourceId: value('sourceId'),
    serialNumber: value('serialNumber'),
    macAddress: value('macAddress'),
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
  candidate: ImporterV2IdentityCandidate,
): ImporterV2IdentitySignal[] {
  const normalizedCandidate = normalizeImporterV2Identity(candidate.identifiers)
  const definitions = [
    ['SOURCE_ID', 'sourceId'],
    ['SERIAL_NUMBER', 'serialNumber'],
    ['MAC_ADDRESS', 'macAddress'],
  ] as const

  return definitions.map(([kind, key]) => {
    const sourceValue = source[key]
    // Provider Source IDs are opaque values in provider-local namespaces.
    // A same-looking Source ID from Aruba/Auvik/Meraki is never evidence of
    // cross-provider identity agreement.
    const candidateValue =
      kind === 'SOURCE_ID' &&
      candidate.matchScope &&
      candidate.matchScope !== 'SAME_PROVIDER'
        ? null
        : normalizedCandidate[key]
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

function comparableContext(value: string | null | undefined) {
  return normalizeText(value)?.toLocaleLowerCase('en-US') ?? null
}

// Cisco and Meraki inventory sources use different display names for the same
// manufacturer and hardware model. These aliases are *context only*: durable
// serial/MAC evidence is still required for an identity candidate.
function comparableHardwareVendor(value: string | null | undefined) {
  const normalized = comparableContext(value)
  if (
    normalized === 'cisco' ||
    normalized === 'cisco systems' ||
    normalized === 'cisco meraki' ||
    normalized === 'meraki'
  ) {
    return 'cisco'
  }
  return normalized
}

function comparableCiscoModel(value: string) {
  return value.replace(/^(?:(?:cisco\\s+)?meraki|cisco)\\s+/, '')
}

function compatibleHardwareContext(
  source: ImporterV2IdentityContext | undefined,
  candidate: ImporterV2IdentityContext | undefined,
) {
  const sourceVendor = comparableHardwareVendor(source?.vendor)
  const candidateVendor = comparableHardwareVendor(candidate?.vendor)
  const sourceModel = comparableContext(source?.model)
  const candidateModel = comparableContext(candidate?.model)
  if (!sourceVendor || !candidateVendor || !sourceModel || !candidateModel) {
    return false
  }
  if (sourceVendor !== candidateVendor) return false
  if (sourceVendor === 'cisco') {
    return comparableCiscoModel(sourceModel) === comparableCiscoModel(candidateModel)
  }
  return sourceModel === candidateModel
}

function candidateConfidence(
  source: ImporterV2IdentitySource,
  signals: readonly ImporterV2IdentitySignal[],
  candidate: ImporterV2IdentityCandidate,
) {
  const agreed = signals.filter((signal) => signal.status === 'AGREE')
  const disagreed = signals.filter((signal) => signal.status === 'DISAGREE')

  // A genuine same-provider device ID is the strongest durable signal and may
  // remain authoritative when a stale serial/MAC changed.
  if (
    candidate.matchScope !== 'CROSS_PROVIDER' &&
    candidate.matchScope !== 'CANONICAL' &&
    agreed.some((signal) => signal.kind === 'SOURCE_ID')
  ) {
    return 'HIGH' as const
  }

  if (candidate.hasConflictingDurableEvidence || disagreed.length > 0) {
    return 'LOW' as const
  }
  if (agreed.length >= 2) return 'HIGH' as const

  // A unique serial/MAC match to a previously confirmed crosswalk for this
  // same provider is reusable automatically on later imports.
  if (
    candidate.crosswalkId &&
    candidate.matchScope !== 'CROSS_PROVIDER' &&
    candidate.matchScope !== 'CANONICAL' &&
    agreed.length === 1
  ) {
    return 'HIGH' as const
  }

  // A first observation from another provider may converge automatically when
  // a unique canonical serial is reinforced by matching vendor + model context.
  if (
    (candidate.matchScope === 'CROSS_PROVIDER' ||
      candidate.matchScope === 'CANONICAL') &&
    agreed.some((signal) => signal.kind === 'SERIAL_NUMBER') &&
    compatibleHardwareContext(source.context, candidate.context)
  ) {
    return 'HIGH' as const
  }

  return 'MEDIUM' as const
}

function candidateExplanation(
  signals: readonly ImporterV2IdentitySignal[],
  candidate: ImporterV2IdentityCandidate,
) {
  const agreed = signals
    .filter((signal) => signal.status === 'AGREE')
    .map((signal) => signal.kind)
  const disagreed = signals
    .filter((signal) => signal.status === 'DISAGREE')
    .map((signal) => signal.kind)
  const agreedText = agreed.length > 0 ? agreed.join(', ') : 'no identifiers'
  if (candidate.hasConflictingDurableEvidence) {
    return `Durable identity agreement: ${agreedText}; other retained provider/canonical evidence conflicts with the incoming durable identifiers, so review is required.`
  }
  if (disagreed.length > 0) {
    return `Durable identity agreement: ${agreedText}; changed or stale source identifiers: ${disagreed.join(', ')}.`
  }
  if (candidate.matchScope === 'CROSS_PROVIDER') {
    return `Cross-provider durable identity agreement: ${agreedText}. Provider Source IDs were intentionally excluded from comparison.`
  }
  if (candidate.matchScope === 'CANONICAL') {
    return `Canonical durable identity agreement: ${agreedText}. Provider Source IDs were intentionally excluded from comparison.`
  }
  return `Durable identity agreement: ${agreedText}. Context fields did not affect confidence.`
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
      const signals = candidateSignals(normalizedIdentifiers, candidate)
      if (!signals.some((signal) => signal.status === 'AGREE')) return null
      return {
        canonicalDeviceId: candidate.canonicalDeviceId,
        crosswalkId: candidate.crosswalkId ?? null,
        matchScope: candidate.matchScope ?? 'SAME_PROVIDER',
        confidence: candidateConfidence(source, signals, candidate),
        requiresConfirmation: true as const,
        signals,
        contextDifferences: contextDifferences(source.context, candidate.context),
        evidence: candidate.evidence ?? [],
        evidenceConflict: candidate.hasConflictingDurableEvidence === true,
        explanation: candidateExplanation(signals, candidate),
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
      requiresConfirmation: false,
      normalizedIdentifiers,
      candidates: [],
      options: ['CREATE_NEW', 'MANUAL_OVERRIDE'],
      explanation:
        'No canonical device is supported by the supplied durable identifiers. The row can be proposed as a new device without per-row confirmation; final batch publication remains explicit.',
    }
  }

  const onlyCandidate = matchedCandidates.length === 1 ? matchedCandidates[0] : null
  const uniqueProviderSourceIdAgreement = Boolean(
    onlyCandidate?.signals.some(
      (signal) => signal.kind === 'SOURCE_ID' && signal.status === 'AGREE',
    ),
  )
  const hasDurableConflict = matchedCandidates.some(
    (candidate) =>
      candidate.evidenceConflict ||
      candidate.signals.some((signal) => signal.status === 'DISAGREE'),
  )
  const ambiguous =
    matchedCandidates.length > 1 ||
    (hasDurableConflict && !uniqueProviderSourceIdAgreement)

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

  const candidate = matchedCandidates[0]
  const automaticallyTrusted = candidate.confidence === 'HIGH'
  const hasChangedIdentifiers = candidate.signals.some(
    (signal) => signal.status === 'DISAGREE',
  )
  return {
    kind: 'MATCH_SUGGESTED',
    requiresConfirmation: !automaticallyTrusted,
    normalizedIdentifiers,
    candidates: matchedCandidates,
    options: ['CONFIRM_MATCH', 'CREATE_NEW', 'MANUAL_OVERRIDE'],
    explanation: automaticallyTrusted
      ? hasChangedIdentifiers && uniqueProviderSourceIdAgreement
        ? 'One canonical device is uniquely supported by the provider Source ID. Other source identifiers changed but do not resolve to another canonical device, so the confirmed Source ID match is reused automatically.'
        : candidate.crosswalkId
          ? 'One canonical device is supported by a previously confirmed source-identity crosswalk. The same raw serial/MAC alias is reused automatically; final batch publication remains explicit.'
          : 'One canonical device is supported by high-confidence durable identity evidence. The match can be reused automatically; final batch publication remains explicit.'
      : 'One canonical device is supported by durable identity evidence, but the evidence is not strong enough for automatic reuse and still requires confirmation.',
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
