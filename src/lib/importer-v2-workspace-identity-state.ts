export type ImporterV2WorkspaceIdentityCandidate = {
  canonicalDeviceId: string
  confidence: string | null
  explanation: string | null
  durableEvidence: readonly string[]
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

function candidateEvidence(candidate: Record<string, unknown>) {
  const direct = stringList(candidate.evidence)
  if (direct.length) return direct

  const signals = Array.isArray(candidate.signals) ? candidate.signals : []
  return signals
    .map(object)
    .filter((signal): signal is Record<string, unknown> => Boolean(signal))
    .filter((signal) => signal.status === 'AGREE')
    .map((signal) => text(signal.kind))
    .filter((kind): kind is string => Boolean(kind))
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
    .map((candidate) => ({
      canonicalDeviceId:
        text(candidate.canonicalDeviceId) ?? text(candidate.deviceId) ?? '',
      confidence: text(candidate.confidence),
      explanation: text(candidate.explanation),
      durableEvidence: candidateEvidence(candidate),
      contextDifferences: candidateDifferences(candidate),
    }))
    .filter((candidate) => candidate.canonicalDeviceId)
}

function latestIdentityDecision(decisions: readonly WorkspaceDecision[]) {
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index]
    if (decision.action !== 'IDENTITY_RESOLUTION') continue
    const value = object(decision.value)
    const kind = text(value?.kind)
    if (
      kind !== 'CONFIRM_MATCH' &&
      kind !== 'CHOOSE_CANDIDATE' &&
      kind !== 'CREATE_NEW' &&
      kind !== 'MANUAL_OVERRIDE'
    ) {
      continue
    }
    return {
      kind,
      canonicalDeviceId: text(value?.canonicalDeviceId),
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

  const decision = latestIdentityDecision(input.decisions ?? [])
  const sourceKind = text(source.kind) ?? text(source.status)
  const requiresConfirmation =
    decision === null &&
    (source.requiresConfirmation === true ||
      (typeof sourceKind === 'string' && sourceKind.includes('REVIEW')) ||
      sourceKind === 'MATCH_SUGGESTED' ||
      sourceKind === 'AMBIGUOUS' ||
      sourceKind === 'NEW')

  return {
    kind: sourceKind,
    requiresConfirmation,
    resolved: decision !== null,
    selectedDecision: decision?.kind ?? null,
    selectedCanonicalDeviceId: decision?.canonicalDeviceId ?? null,
    explanation: text(source.explanation),
    candidates: candidates(source),
    options: stringList(source.options),
  }
}

export function importerV2WorkspaceIdentityNeedsReview(input: {
  identityResolution: unknown
  decisions?: readonly WorkspaceDecision[]
}) {
  return importerV2WorkspaceIdentityReview(input)?.requiresConfirmation ?? false
}
