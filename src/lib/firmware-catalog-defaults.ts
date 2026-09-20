import { compareFirmwareVersions } from '@/lib/firmware-versioning'

export const firmwareReleaseDecisions = ['NEEDS_REVIEW', 'ALLOWED', 'BLOCKED', 'WITHDRAWN'] as const
export type FirmwareReleaseDecision = (typeof firmwareReleaseDecisions)[number]

export const firmwareTrainStates = ['PREFERRED', 'ACCEPTED', 'DEPRECATED'] as const
export type FirmwareTrainState = (typeof firmwareTrainStates)[number]

export type TrainPolicyPosition =
  | 'PREFERRED'
  | 'ACCEPTABLE'
  | 'BELOW_MINIMUM'
  | 'OUTSIDE_ACCEPTABLE'
  | 'REVIEW_REQUIRED'
  | 'NOT_ALLOWED'
  | 'NOT_COMPARABLE'

export type TrainPolicyRelease = {
  id: string
  version: string
  decision: FirmwareReleaseDecision
  isActive?: boolean
}

export type TrainPolicyEvaluation = {
  position: TrainPolicyPosition
  acceptable: boolean
  updateRequired: boolean
  reason: string
}

export function releaseDecisionFromCatalogSemantics(input: {
  catalogState: string
  policyEligibility: string
}): FirmwareReleaseDecision {
  if (input.catalogState === 'BLOCKED') return 'BLOCKED'
  if (input.catalogState === 'WITHDRAWN') return 'WITHDRAWN'
  if (input.catalogState === 'OBSERVED') return 'NEEDS_REVIEW'
  if (input.catalogState === 'VERIFIED' && ['ALLOWED', 'PREFERRED'].includes(input.policyEligibility)) {
    return 'ALLOWED'
  }
  if (input.catalogState === 'VERIFIED' && input.policyEligibility === 'DISALLOWED') {
    return 'BLOCKED'
  }
  return 'NEEDS_REVIEW'
}

export function catalogSemanticsFromReleaseDecision(decision: FirmwareReleaseDecision) {
  switch (decision) {
    case 'ALLOWED':
      return { catalogState: 'VERIFIED' as const, policyEligibility: 'ALLOWED' as const }
    case 'BLOCKED':
      return { catalogState: 'BLOCKED' as const, policyEligibility: 'DISALLOWED' as const }
    case 'WITHDRAWN':
      return { catalogState: 'WITHDRAWN' as const, policyEligibility: 'DISALLOWED' as const }
    case 'NEEDS_REVIEW':
    default:
      return { catalogState: 'OBSERVED' as const, policyEligibility: 'NOT_EVALUATED' as const }
  }
}

function deniedByDecision(release: TrainPolicyRelease): TrainPolicyEvaluation | null {
  if (release.decision === 'BLOCKED' || release.decision === 'WITHDRAWN') {
    return {
      position: 'NOT_ALLOWED',
      acceptable: false,
      updateRequired: true,
      reason: release.decision === 'BLOCKED' ? 'The exact release is blocked.' : 'The exact release is withdrawn.',
    }
  }
  if (release.decision === 'NEEDS_REVIEW' || release.isActive === false) {
    return {
      position: 'REVIEW_REQUIRED',
      acceptable: false,
      updateRequired: true,
      reason: release.isActive === false ? 'The release is archived.' : 'The release still needs catalog review.',
    }
  }
  return null
}

export function evaluateReleaseAgainstTrain(input: {
  vendorKey: string
  platform: string
  release: TrainPolicyRelease
  preferredRelease: TrainPolicyRelease | null
  minimumAcceptableRelease: TrainPolicyRelease | null
}): TrainPolicyEvaluation {
  const releaseDecision = deniedByDecision(input.release)
  if (releaseDecision) return releaseDecision

  const preferred = input.preferredRelease
  if (!preferred) {
    return {
      position: 'REVIEW_REQUIRED',
      acceptable: false,
      updateRequired: true,
      reason: 'The train has no preferred release configured.',
    }
  }
  const preferredDecision = deniedByDecision(preferred)
  if (preferredDecision) {
    return {
      position: 'REVIEW_REQUIRED',
      acceptable: false,
      updateRequired: true,
      reason: 'The configured preferred release is not currently usable.',
    }
  }
  if (input.release.id === preferred.id) {
    return { position: 'PREFERRED', acceptable: true, updateRequired: false, reason: 'This is the train preferred release.' }
  }

  const minimum = input.minimumAcceptableRelease
  if (!minimum) {
    return {
      position: 'OUTSIDE_ACCEPTABLE',
      acceptable: false,
      updateRequired: true,
      reason: 'No minimum is configured, so only the preferred release is acceptable.',
    }
  }
  const minimumDecision = deniedByDecision(minimum)
  if (minimumDecision) {
    return {
      position: 'REVIEW_REQUIRED',
      acceptable: false,
      updateRequired: true,
      reason: 'The configured minimum acceptable release is not currently usable.',
    }
  }

  const comparison = compareFirmwareVersions({
    vendorKey: input.vendorKey,
    platform: input.platform,
    leftVersion: input.release.version,
    rightVersion: minimum.version,
  })
  if (comparison.result === 'NOT_COMPARABLE') {
    return {
      position: 'NOT_COMPARABLE',
      acceptable: false,
      updateRequired: true,
      reason: comparison.reason,
    }
  }
  if (comparison.result === 'LESS') {
    return {
      position: 'BELOW_MINIMUM',
      acceptable: false,
      updateRequired: true,
      reason: 'The release is below the train minimum acceptable release.',
    }
  }
  return {
    position: 'ACCEPTABLE',
    acceptable: true,
    updateRequired: false,
    reason: 'The release is allowed and at or above the train minimum acceptable release.',
  }
}

export type TrainFallbackCandidate = {
  id: string
  name: string
  state: FirmwareTrainState
  preferredRelease: TrainPolicyRelease | null
  compatibility: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN'
  compatibilityExplanation: string
}

export type TrainFallbackResolution =
  | { status: 'RESOLVED'; train: TrainFallbackCandidate; source: 'EXPLICIT_OVERRIDE' | 'PLATFORM_PREFERRED' | 'ACCEPTED_FALLBACK'; explanation: string }
  | { status: 'REVIEW_REQUIRED' | 'NO_COMPATIBLE_TRAIN'; train: null; source: null; explanation: string }

export function resolveCatalogTrainForModel(input: {
  vendorKey: string
  platform: string
  trains: readonly TrainFallbackCandidate[]
  explicitOverrideTrainId?: string | null
}): TrainFallbackResolution {
  const active = input.trains.filter((train) => train.state !== 'DEPRECATED')

  if (input.explicitOverrideTrainId) {
    const override = input.trains.find((train) => train.id === input.explicitOverrideTrainId)
    if (!override) return { status: 'REVIEW_REQUIRED', train: null, source: null, explanation: 'The explicit model-family train override no longer exists.' }
    if (override.compatibility !== 'COMPATIBLE') {
      return {
        status: 'REVIEW_REQUIRED',
        train: null,
        source: null,
        explanation: `The explicit train override is ${override.compatibility.toLowerCase()}: ${override.compatibilityExplanation}`,
      }
    }
    return { status: 'RESOLVED', train: override, source: 'EXPLICIT_OVERRIDE', explanation: 'Using the explicit model-family train override.' }
  }

  const preferred = active.find((train) => train.state === 'PREFERRED') ?? null
  if (!preferred) return { status: 'REVIEW_REQUIRED', train: null, source: null, explanation: 'No platform preferred train is configured.' }
  if (!preferred.preferredRelease || preferred.preferredRelease.decision !== 'ALLOWED' || preferred.preferredRelease.isActive === false) {
    return {
      status: 'REVIEW_REQUIRED',
      train: null,
      source: null,
      explanation: `Preferred train ${preferred.name} has no active Allowed preferred release.`,
    }
  }
  if (preferred.compatibility === 'COMPATIBLE') {
    return { status: 'RESOLVED', train: preferred, source: 'PLATFORM_PREFERRED', explanation: 'The model inherits the platform preferred train.' }
  }
  if (preferred.compatibility === 'UNKNOWN') {
    return {
      status: 'REVIEW_REQUIRED',
      train: null,
      source: null,
      explanation: `Compatibility with preferred train ${preferred.name} is unknown: ${preferred.compatibilityExplanation}`,
    }
  }

  const accepted = active.filter(
    (train) =>
      train.state === 'ACCEPTED' &&
      train.compatibility === 'COMPATIBLE' &&
      train.preferredRelease?.decision === 'ALLOWED' &&
      train.preferredRelease.isActive !== false,
  )
  if (accepted.length === 0) {
    return {
      status: 'NO_COMPATIBLE_TRAIN',
      train: null,
      source: null,
      explanation: `Preferred train ${preferred.name} is incompatible and no compatible accepted fallback train is known.`,
    }
  }

  let newest = accepted[0]
  for (const candidate of accepted.slice(1)) {
    const left = newest.preferredRelease
    const right = candidate.preferredRelease
    if (!left || !right) continue
    const comparison = compareFirmwareVersions({
      vendorKey: input.vendorKey,
      platform: input.platform,
      leftVersion: left.version,
      rightVersion: right.version,
    })
    if (comparison.result === 'NOT_COMPARABLE') {
      return {
        status: 'REVIEW_REQUIRED',
        train: null,
        source: null,
        explanation: `Compatible fallback trains ${newest.name} and ${candidate.name} cannot be ordered safely: ${comparison.reason}`,
      }
    }
    if (comparison.result === 'LESS') newest = candidate
  }

  return {
    status: 'RESOLVED',
    train: newest,
    source: 'ACCEPTED_FALLBACK',
    explanation: `Preferred train ${preferred.name} is incompatible; using newest safely comparable compatible accepted train ${newest.name}.`,
  }
}
