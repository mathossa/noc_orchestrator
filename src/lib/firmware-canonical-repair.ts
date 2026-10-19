import { normalizedFirmwarePlatform } from '@/lib/firmware-releases'
import { normalizedObservedFirmwareVersion, supportedFirmwarePlatforms } from '@/lib/firmware-observation'

/** Read-only, exact-identity candidate selection for #152. Never infer a platform from a hostname. */
export type CanonicalRepairRelease = {
  id: string
  vendorId: string
  platform: string
  version: string
  logicalVersion: string
  variant: string | null
  imageCode: string | null
  isActive: boolean
  firmwareTrain: { id: string; name: string; platform: string; isActive: boolean } | null
}

export type CanonicalRepairModel = {
  vendorId: string
  platform: string | null
  preferredPlatform: string | null
}

export type CanonicalRepairDecision = {
  status: 'MATCHED' | 'ALREADY_CORRECT' | 'UNSUPPORTED_MODEL' | 'MISSING_TARGET' | 'AMBIGUOUS' | 'NOT_APPLICABLE'
  targetId: string | null
  candidateIds: string[]
}

const equal = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').normalize('NFKC').trim().toLowerCase() ===
  (b ?? '').normalize('NFKC').trim().toLowerCase()

/**
 * Only repair a Fortinet hardware-family (FortiGate) software-platform alias to
 * an exact FortiOS release. Versions, logical versions, variants, images, vendor,
 * and (if both known) train names must agree. Do not accept an ambiguous match.
 */
export function resolveCanonicalFortiosRepair(input: {
  source: CanonicalRepairRelease
  model: CanonicalRepairModel
  candidates: readonly CanonicalRepairRelease[]
  vendorIsFortinet: boolean
}): CanonicalRepairDecision {
  const { source, model } = input
  if (!input.vendorIsFortinet || source.vendorId !== model.vendorId) {
    return { status: 'NOT_APPLICABLE', targetId: null, candidateIds: [] }
  }
  if (equal(source.platform, 'FortiOS')) {
    return { status: 'ALREADY_CORRECT', targetId: source.id, candidateIds: [] }
  }
  if (!equal(source.platform, 'FortiGate')) {
    return { status: 'NOT_APPLICABLE', targetId: null, candidateIds: [] }
  }
  const supported = supportedFirmwarePlatforms(model.platform)
  const preferred = model.preferredPlatform
  // A preferred platform is not proof of compatibility unless in the supported list.
  if (!supported.some((platform) => normalizedFirmwarePlatform(platform) === 'fortios') ||
      (preferred && !supported.some((platform) => equal(platform, preferred)))) {
    return { status: 'UNSUPPORTED_MODEL', targetId: null, candidateIds: [] }
  }
  const matches = input.candidates.filter((candidate) =>
    candidate.isActive &&
    candidate.vendorId === source.vendorId &&
    equal(candidate.platform, 'FortiOS') &&
    normalizedObservedFirmwareVersion(candidate.version) === normalizedObservedFirmwareVersion(source.version) &&
    normalizedObservedFirmwareVersion(candidate.logicalVersion) === normalizedObservedFirmwareVersion(source.logicalVersion) &&
    equal(candidate.variant, source.variant) &&
    equal(candidate.imageCode, source.imageCode) &&
    (!candidate.firmwareTrain ||
      (candidate.firmwareTrain.isActive && equal(candidate.firmwareTrain.platform, 'FortiOS'))) &&
    (!source.firmwareTrain || !candidate.firmwareTrain ||
      equal(source.firmwareTrain.name, candidate.firmwareTrain.name)),
  )
  if (matches.length === 1) {
    return { status: 'MATCHED', targetId: matches[0].id, candidateIds: [matches[0].id] }
  }
  return {
    status: matches.length > 1 ? 'AMBIGUOUS' : 'MISSING_TARGET',
    targetId: null,
    candidateIds: matches.map((item) => item.id),
  }
}
