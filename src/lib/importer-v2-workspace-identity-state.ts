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
  selectedDecision: 'CONFIRM_MATCH' | 'CHOOSE_CANDIDATE' | 'CREATE_NEW' | 'MANUAL_OVERRIDE' | null
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
  value?: unknown
}

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

function automaticIdentityDecision(input: {
  source: Record<string, unknown>
  sourceKind: string | null
  candidates: readonly ImporterV2WorkspaceIdentityCandidate[]
}) {
  if (input.source.requiresConfirmation !== false) return null
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

  const normalizedCandidates = candidates(source)
  const sourceKind = text(source.kind) ?? text(source.status)
  const explicitDecision = latestIdentityDecision(input.decisions ?? [])
  const automaticDecision = explicitDecision
    ? null
    : automaticIdentityDecision({
        source,
        sourceKind,
        candidates: normalizedCandidates,
      })
  const decision = explicitDecision ?? automaticDecision
  const requiresConfirmation =
    decision === null &&
    (source.requiresConfirmation === true ||
      (typeof sourceKind === 'string' && sourceKind.includes('REVIEW')) ||
      sourceKind === 'AMBIGUOUS')

  return {
    kind: sourceKind,
    requiresConfirmation,
    resolved: decision !== null,
    selectedDecision: decision?.kind ?? null,
    selectedCanonicalDeviceId: decision?.canonicalDeviceId ?? null,
    explanation: text(source.explanation),
    candidates: normalizedCandidates,
    options: stringList(source.options),
  }
}

export function importerV2WorkspaceIdentityNeedsReview(input: {
  identityResolution: unknown
  decisions?: readonly WorkspaceDecision[]
}) {
  return importerV2WorkspaceIdentityReview(input)?.requiresConfirmation ?? false
}
