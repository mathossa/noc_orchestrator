export type ImporterV2WorkspaceIdentitySignal = {
  kind: string
  sourceValue: string | null
  candidateValue: string | null
  status: string | null
}

export type ImporterV2WorkspaceIdentityCandidate = {
  canonicalDeviceId: string
  confidence: string | null
  explanation: string | null
  durableEvidence: readonly string[]
  signals: readonly ImporterV2WorkspaceIdentitySignal[]
  contextDifferences: readonly {
    field: string
    sourceValue: string | null
    candidateValue: string | null
  }[]
}

export type ImporterV2WorkspaceIdentityReview = {
  kind: string | null
  requiresConfirmation: boolean
  resolved: boolean
  selectedDecision:
    | 'CONFIRM_MATCH'
    | 'CHOOSE_CANDIDATE'
    | 'CREATE_NEW'
    | 'MANUAL_OVERRIDE'
    | null
  selectedCanonicalDeviceId: string | null
  explanation: string | null
  candidates: readonly ImporterV2WorkspaceIdentityCandidate[]
  options: readonly string[]
}

type IdentityDecisionKind = NonNullable<
  ImporterV2WorkspaceIdentityReview['selectedDecision']
>

type WorkspaceDecision = {
  action: string
  field?: string | null
  value?: unknown
}

const DURABLE_IDENTITY_FIELDS = new Set([
  'sourceId',
  'serialNumber',
  'macAddress',
])

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function candidateSignals(candidate: Record<string, unknown>) {
  if (!Array.isArray(candidate.signals)) return []
  return candidate.signals
    .map(object)
    .filter((signal): signal is Record<string, unknown> => Boolean(signal))
    .map((signal) => ({
      kind: text(signal.kind) ?? 'UNKNOWN',
      sourceValue: text(signal.sourceValue),
      candidateValue: text(signal.candidateValue),
      status: text(signal.status),
    }))
}

function candidateEvidence(
  candidate: Record<string, unknown>,
  signals: readonly ImporterV2WorkspaceIdentitySignal[],
) {
  const direct = stringList(candidate.evidence)
  if (direct.length) return direct

  return signals
    .filter((signal) => signal.status === 'AGREE')
    .map((signal) => signal.kind)
}

function candidateDifferences(candidate: Record<string, unknown>) {
  if (!Array.isArray(candidate.contextDifferences)) return []
  return candidate.contextDifferences
    .map(object)
    .filter((difference): difference is Record<string, unknown> => Boolean(difference))
    .map((difference) => ({
      field: text(difference.field) ?? 'unknown',
      sourceValue: text(difference.sourceValue),
      candidateValue: text(difference.candidateValue),
    }))
}

function candidates(value: Record<string, unknown> | null) {
  if (!value || !Array.isArray(value.candidates)) return []
  return value.candidates
    .map(object)
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
    .map((candidate) => {
      const signals = candidateSignals(candidate)
      return {
        canonicalDeviceId:
          text(candidate.canonicalDeviceId) ?? text(candidate.deviceId) ?? '',
        confidence: text(candidate.confidence),
        explanation: text(candidate.explanation),
        durableEvidence: candidateEvidence(candidate, signals),
        signals,
        contextDifferences: candidateDifferences(candidate),
      }
    })
    .filter((candidate) => candidate.canonicalDeviceId)
}

function latestIdentityDecision(
  decisions: readonly WorkspaceDecision[],
): {
  kind: IdentityDecisionKind
  canonicalDeviceId: string | null
} | null {
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index]
    if (decision.action !== 'IDENTITY_RESOLUTION') continue
    const value = object(decision.value)
    const kind = text(value?.kind)

    switch (kind) {
      case 'CONFIRM_MATCH':
      case 'CHOOSE_CANDIDATE':
      case 'CREATE_NEW':
      case 'MANUAL_OVERRIDE':
        return {
          kind,
          canonicalDeviceId: text(value?.canonicalDeviceId),
        }
      default:
        continue
    }
  }
  return null
}

function decisionTargetText(decision: WorkspaceDecision) {
  if (decision.action === 'CLEAR_FIELD') return null
  if (
    decision.action !== 'SET_FIELD' &&
    decision.action !== 'LINK_FIELD' &&
    decision.action !== 'REMEMBER_EXACT' &&
    decision.action !== 'CREATE_SCOPED_RULE'
  ) {
    return undefined
  }
  const value = object(decision.value)
  return text(value?.label)
}

function manualDurableIdentity(decisions: readonly WorkspaceDecision[]) {
  const values = new Map<string, string | null>()
  for (const decision of decisions) {
    if (!decision.field || !DURABLE_IDENTITY_FIELDS.has(decision.field)) continue
    const value = decisionTargetText(decision)
    if (value !== undefined) values.set(decision.field, value)
  }
  for (const field of DURABLE_IDENTITY_FIELDS) {
    const value = values.get(field)
    if (value) return { field, value }
  }
  return null
}

function automaticIdentityDecision(input: {
  sourceKind: string | null
  candidates: readonly ImporterV2WorkspaceIdentityCandidate[]
}) {
  if (input.sourceKind === 'NEW') {
    return {
      kind: 'CREATE_NEW' as const,
      canonicalDeviceId: null,
    }
  }

  if (
    input.sourceKind === 'MATCH_SUGGESTED' &&
    input.candidates.length === 1 &&
    input.candidates[0]?.confidence === 'HIGH'
  ) {
    return {
      kind: 'CONFIRM_MATCH' as const,
      canonicalDeviceId: input.candidates[0].canonicalDeviceId,
    }
  }

  return null
}

export function importerV2WorkspaceIdentityReview(input: {
  identityResolution: unknown
  decisions?: readonly WorkspaceDecision[]
}): ImporterV2WorkspaceIdentityReview | null {
  const source = object(input.identityResolution)
  if (!source) return null

  const decisions = input.decisions ?? []
  const normalizedCandidates = candidates(source)
  const sourceKind = text(source.kind) ?? text(source.status)
  const suppliedIdentity = manualDurableIdentity(decisions)

  // A stale source record can arrive without source ID, serial or MAC. An
  // engineer may add one of those durable identifiers in the staged workspace.
  // That turns INVALID into a new-device proposal, but final publication still
  // performs the provider-wide uniqueness check before creating a crosswalk.
  const effectiveKind =
    sourceKind === 'INVALID' && suppliedIdentity ? 'NEW' : sourceKind

  const explicitDecision = latestIdentityDecision(decisions)
  const automaticDecision = explicitDecision
    ? null
    : automaticIdentityDecision({
        sourceKind: effectiveKind,
        candidates: normalizedCandidates,
      })
  const decision = explicitDecision ?? automaticDecision
  const requiresConfirmation =
    decision === null &&
    (source.requiresConfirmation === true ||
      (typeof effectiveKind === 'string' && effectiveKind.includes('REVIEW')) ||
      effectiveKind === 'AMBIGUOUS')

  return {
    kind: effectiveKind,
    requiresConfirmation,
    resolved: decision !== null,
    selectedDecision: decision?.kind ?? null,
    selectedCanonicalDeviceId: decision?.canonicalDeviceId ?? null,
    explanation: suppliedIdentity
      ? `A durable ${suppliedIdentity.field} was supplied during reconciliation. Final publication will verify that it is unique before creating the device.`
      : text(source.explanation),
    candidates: normalizedCandidates,
    options: stringList(source.options),
  }
}

export function importerV2WorkspaceIdentityNeedsReview(input: {
  identityResolution: unknown
  decisions?: readonly WorkspaceDecision[]
}) {
  const review = importerV2WorkspaceIdentityReview(input)
  return Boolean(
    review && (review.requiresConfirmation || review.kind === 'INVALID'),
  )
}
