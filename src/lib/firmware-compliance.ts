import type {
  FirmwareCompatibilityRelease,
  FirmwareCompatibilityResult,
  FirmwareImageResolution,
} from '@/lib/firmware-compatibility'
import type { FirmwarePolicyResolution } from '@/lib/firmware-policies'
import {
  isEquivalentFirmwareRelease,
  isFirmwarePolicyEligible,
  normalizedFirmwarePlatform,
} from '@/lib/firmware-releases'
import {
  compareFirmwareVersions,
  type FirmwareVersionOrder,
} from '@/lib/firmware-versioning'

export type FirmwareCompliance =
  | 'PREFERRED'
  | 'ACCEPTED'
  | 'BELOW_MINIMUM'
  | 'OUTSIDE_RANGE'
  | 'BLOCKED_RELEASE'
  | 'UNKNOWN_FIRMWARE'
  | 'INCOMPATIBLE'
  | 'NO_POLICY'
  | 'NOT_COMPARABLE'
  | 'COMPATIBILITY_UNRESOLVED'
  | 'TARGET_UNRESOLVED'
export type FirmwareRelation =
  | 'BELOW_MINIMUM'
  | 'AT_MINIMUM'
  | 'BELOW_PREFERRED'
  | 'AT_PREFERRED'
  | 'ABOVE_PREFERRED'
  | 'ABOVE_MAXIMUM'
  | 'NOT_COMPARABLE'
export type FirmwareRecommendation =
  | 'NO_ACTION'
  | 'UPDATE_RECOMMENDED'
  | 'UPDATE_REQUIRED'
  | 'PLATFORM_MIGRATION'
  | 'REVIEW_REQUIRED'
export type ComplianceRelease = FirmwareCompatibilityRelease & {
  isActive: boolean
  catalogState: string
  policyEligibility: string
  variantEquivalence: string
  status: string
  firmwareTrain: { id: string; name: string } | null
}
export type FirmwareComplianceInput = {
  currentFirmware: ComplianceRelease | null
  rawVersion?: string | null
  effectivePolicy: FirmwarePolicyResolution
  preferredTarget: ComplianceRelease | null
  minimum: ComplianceRelease | null
  maximum: ComplianceRelease | null
  currentCompatibility: FirmwareCompatibilityResult | null
  targetCompatibility: FirmwareImageResolution | null
  resolvedTarget: ComplianceRelease | null
  targetReason?: string
}
export type FirmwareComplianceResult = FirmwareComplianceInput & {
  compliance: FirmwareCompliance
  relationToPreferred: FirmwareRelation
  recommendation: FirmwareRecommendation
  policySource: FirmwarePolicyResolution['source']
  effectiveTrack: { key: string; name: string; classification: string } | null
  explanation: string
}

/** Pure technical resolution. Workflow decisions never enter this contract. */
export function resolveFirmwareCompliance(
  input: FirmwareComplianceInput,
): FirmwareComplianceResult {
  const {
    currentFirmware: current,
    effectivePolicy,
    preferredTarget: preferred,
    minimum,
    maximum,
  } = input
  const policy = effectivePolicy.policy
  const finish = (
    compliance: FirmwareCompliance,
    explanation: string,
    relationToPreferred: FirmwareRelation = 'NOT_COMPARABLE',
    recommendation: FirmwareRecommendation = 'REVIEW_REQUIRED',
  ): FirmwareComplianceResult => ({
    ...input,
    compliance,
    relationToPreferred,
    recommendation,
    explanation,
    policySource: effectivePolicy.source,
    effectiveTrack: policy
      ? {
          key: policy.trackKey,
          name: policy.trackName,
          classification: policy.trackClass,
        }
      : null,
  })
  if (current && ['BLOCKED', 'WITHDRAWN'].includes(current.catalogState)) {
    return finish(
      'BLOCKED_RELEASE',
      `Current exact release is ${current.catalogState.toLowerCase()}; review is required regardless of policy or deployment history.`,
    )
  }
  if (input.currentCompatibility?.status === 'INCOMPATIBLE')
    return finish(
      'INCOMPATIBLE',
      input.currentCompatibility.provenance.explanation,
    )
  if (!current) {
    if (input.rawVersion) {
      return finish(
        'NOT_COMPARABLE',
        `Observed current firmware “${input.rawVersion}” is recorded, but its canonical catalog association is unresolved. The running version is known; only catalog enrichment/comparison requires review.`,
      )
    }
    return finish(
      'UNKNOWN_FIRMWARE',
      'No observed current firmware is recorded.',
    )
  }
  if (!policy)
    return finish(
      'NO_POLICY',
      `Effective policy could not be resolved: ${effectivePolicy.unresolvedReason ?? 'NO_POLICY'}.`,
    )
  if (!preferred)
    return finish(
      'TARGET_UNRESOLVED',
      input.targetReason ?? 'The policy has no resolvable preferred release.',
    )

  const compare = (right: ComplianceRelease): FirmwareVersionOrder => {
    if (
      current.vendorId !== right.vendorId ||
      normalizedFirmwarePlatform(current.platform) !==
        normalizedFirmwarePlatform(right.platform)
    )
      return 'NOT_COMPARABLE'
    if (isEquivalentFirmwareRelease(current, right)) return 'EQUAL'
    return compareFirmwareVersions({
      vendorKey: current.vendorId,
      platform: current.platform,
      leftVersion: current.version,
      rightVersion: right.version,
    }).result
  }
  const preferredOrder = compare(preferred)
  const minOrder = minimum ? compare(minimum) : null
  const maxOrder = maximum ? compare(maximum) : null
  const relation: FirmwareRelation =
    minOrder === 'LESS'
      ? 'BELOW_MINIMUM'
      : maxOrder === 'GREATER'
        ? 'ABOVE_MAXIMUM'
        : preferredOrder === 'EQUAL'
          ? 'AT_PREFERRED'
          : minOrder === 'EQUAL'
            ? 'AT_MINIMUM'
            : preferredOrder === 'LESS'
              ? 'BELOW_PREFERRED'
              : preferredOrder === 'GREATER'
                ? 'ABOVE_PREFERRED'
                : 'NOT_COMPARABLE'

  if (
    !isFirmwarePolicyEligible(preferred) ||
    (input.resolvedTarget && !isFirmwarePolicyEligible(input.resolvedTarget))
  ) {
    return finish(
      'TARGET_UNRESOLVED',
      'The preferred or resolved exact target is archived, blocked, withdrawn, or no longer policy-eligible.',
      relation,
    )
  }
  if (
    input.targetCompatibility?.status !== 'RESOLVED' ||
    !input.resolvedTarget
  ) {
    return finish(
      'COMPATIBILITY_UNRESOLVED',
      input.targetCompatibility?.explanation ??
        'Target compatibility has not been evaluated.',
      relation,
    )
  }
  if (input.currentCompatibility?.status !== 'COMPATIBLE') {
    return finish(
      'COMPATIBILITY_UNRESOLVED',
      input.currentCompatibility?.provenance.explanation ??
        'Current compatibility has not been evaluated.',
      relation,
    )
  }
  if (!isEquivalentFirmwareRelease(input.resolvedTarget, preferred)) {
    return finish(
      'TARGET_UNRESOLVED',
      'The compatible image has a variant that the preferred target does not permit.',
      relation,
    )
  }
  if (current.vendorId !== preferred.vendorId)
    return finish(
      'NOT_COMPARABLE',
      'Current and preferred releases have different vendors.',
    )
  if (
    normalizedFirmwarePlatform(current.platform) !==
    normalizedFirmwarePlatform(preferred.platform)
  ) {
    return finish(
      'OUTSIDE_RANGE',
      'Current platform differs from effective policy; a compatible target on the intended platform is resolved.',
      'NOT_COMPARABLE',
      'PLATFORM_MIGRATION',
    )
  }
  if (
    (policy.minimumFirmwareReleaseId && !minimum) ||
    (policy.maximumFirmwareReleaseId && !maximum)
  ) {
    return finish(
      'TARGET_UNRESOLVED',
      'A configured policy boundary is missing.',
      relation,
    )
  }
  if (
    preferredOrder === 'NOT_COMPARABLE' ||
    minOrder === 'NOT_COMPARABLE' ||
    maxOrder === 'NOT_COMPARABLE'
  ) {
    return finish(
      'NOT_COMPARABLE',
      'Canonical version comparison cannot safely establish the policy position.',
      relation,
    )
  }
  if (
    policy.policyMode === 'EXACT' ||
    policy.policyMode === 'LATEST_APPROVED_IN_TRAIN'
  ) {
    if (isEquivalentFirmwareRelease(current, preferred))
      return finish(
        'PREFERRED',
        'Running the preferred compatible release or an explicitly permitted equivalent.',
        'AT_PREFERRED',
        'NO_ACTION',
      )
    return finish(
      'OUTSIDE_RANGE',
      'Running firmware does not match the exact effective target.',
      relation,
      preferredOrder === 'LESS' ? 'UPDATE_REQUIRED' : 'REVIEW_REQUIRED',
    )
  }
  if (
    minOrder === 'LESS' ||
    (minOrder === 'EQUAL' && !policy.minimumInclusive)
  ) {
    return finish(
      'BELOW_MINIMUM',
      'Running firmware is below the accepted lower boundary.',
      relation,
      'UPDATE_REQUIRED',
    )
  }
  if (
    maxOrder === 'GREATER' ||
    (maxOrder === 'EQUAL' && !policy.maximumInclusive)
  ) {
    return finish(
      'OUTSIDE_RANGE',
      'Running firmware is outside the accepted upper boundary.',
      relation,
    )
  }
  if (isEquivalentFirmwareRelease(current, preferred))
    return finish(
      'PREFERRED',
      'Running the preferred compatible release or an explicitly permitted equivalent.',
      'AT_PREFERRED',
      'NO_ACTION',
    )
  // Comparison equality is not itself permission to ignore a catalog variant.
  if (preferredOrder === 'EQUAL')
    return finish(
      'NOT_COMPARABLE',
      'Ordering is equal, but explicit release equivalence is not established.',
      relation,
    )
  return finish(
    'ACCEPTED',
    preferredOrder === 'LESS'
      ? 'Accepted — update recommended.'
      : 'Accepted — newer than preferred.',
    relation,
    preferredOrder === 'LESS' ? 'UPDATE_RECOMMENDED' : 'NO_ACTION',
  )
}

export function firmwareComplianceLabel(result: FirmwareComplianceResult) {
  if (result.recommendation === 'PLATFORM_MIGRATION')
    return 'Platform migration recommended'
  switch (result.compliance) {
    case 'PREFERRED':
      return 'Preferred'
    case 'ACCEPTED':
      return result.relationToPreferred === 'ABOVE_PREFERRED'
        ? 'Accepted — newer than preferred'
        : 'Accepted — update recommended'
    case 'BELOW_MINIMUM':
      return 'Below minimum — update required'
    case 'OUTSIDE_RANGE':
      return result.recommendation === 'UPDATE_REQUIRED'
        ? 'Outside approved range — update required'
        : 'Outside approved range — review'
    case 'BLOCKED_RELEASE':
      return 'Blocked release'
    case 'UNKNOWN_FIRMWARE':
      return 'Unknown firmware'
    case 'INCOMPATIBLE':
      return 'Incompatible'
    case 'NO_POLICY':
      return 'No policy'
    case 'NOT_COMPARABLE':
      return 'Not comparable'
    case 'COMPATIBILITY_UNRESOLVED':
      return result.targetCompatibility?.status !== 'RESOLVED'
        ? `Target compatibility ${result.targetCompatibility?.status.toLowerCase() ?? 'unknown'} — review`
        : 'Current compatibility requires review'
    case 'TARGET_UNRESOLVED':
      return 'Preferred target unresolved — review'
  }
}
