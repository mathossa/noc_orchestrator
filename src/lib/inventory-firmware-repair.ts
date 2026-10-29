import { normalizedFirmwarePlatform } from '@/lib/firmware-releases'
import { normalizedObservedFirmwareVersion, supportedFirmwarePlatforms } from '@/lib/firmware-observation'

export type FirmwareLinkRelease = {
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

export type FirmwareLinkModel = {
  vendorId: string
  platform: string | null
  preferredPlatform: string | null
}

export type FirmwareLinkDecision = {
  status: 'MATCHED' | 'CORRECT' | 'UNSUPPORTED_MODEL' | 'NO_OBSERVATION' |
    'MISSING_TARGET' | 'AMBIGUOUS' | 'EVIDENCE_CONFLICT'
  targetId: string | null
  candidateIds: string[]
}

const same = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US') ===
  (right ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')

/**
 * Cross-vendor safe canonical current-firmware repair. The model's existing
 * supported platform mapping is authoritative, not a hardcoded vendor alias.
 * No release/version/evidence is created or rewritten here.
 */
export function resolveInventoryFirmwareLink(input: {
  model: FirmwareLinkModel
  current: FirmwareLinkRelease | null
  observedVersion: string | null
  releases: readonly FirmwareLinkRelease[]
}): FirmwareLinkDecision {
  const { current, model, releases } = input
  const observed = normalizedObservedFirmwareVersion(input.observedVersion)
  if (!observed) return { status: 'NO_OBSERVATION', targetId: null, candidateIds: [] }
  if (current && current.vendorId !== model.vendorId) {
    return { status: 'EVIDENCE_CONFLICT', targetId: null, candidateIds: [] }
  }
  // The operator must reconcile disagreements between persisted observed
  // version and linked canonical version before attempting an alias-only relink.
  if (current && normalizedObservedFirmwareVersion(current.version) !== observed) {
    return { status: 'EVIDENCE_CONFLICT', targetId: null, candidateIds: [] }
  }
  const supported = new Set(supportedFirmwarePlatforms(model.platform).map(normalizedFirmwarePlatform))
  if (!supported.size) return { status: 'UNSUPPORTED_MODEL', targetId: null, candidateIds: [] }

  const candidates = releases.filter((release) =>
    release.isActive &&
    release.vendorId === model.vendorId &&
    normalizedObservedFirmwareVersion(release.version) === observed &&
    supported.has(normalizedFirmwarePlatform(release.platform)) &&
    // A conflicting image/variant is not the same firmware artifact.
    (!current || (same(release.variant, current.variant) && same(release.imageCode, current.imageCode))) &&
    (!release.firmwareTrain ||
      (release.firmwareTrain.isActive && same(release.firmwareTrain.platform, release.platform))) &&
    (!current?.firmwareTrain || !release.firmwareTrain ||
      same(current.firmwareTrain.name, release.firmwareTrain.name)),
  )
  if (current && candidates.some((candidate) => candidate.id === current.id)) {
    return { status: 'CORRECT', targetId: current.id, candidateIds: [current.id] }
  }
  if (candidates.length === 1) {
    return { status: 'MATCHED', targetId: candidates[0].id, candidateIds: [candidates[0].id] }
  }
  return {
    status: candidates.length > 1 ? 'AMBIGUOUS' : 'MISSING_TARGET',
    targetId: null,
    candidateIds: candidates.map((candidate) => candidate.id),
  }
}

/**
 * Engineer-reviewed manual target options for a recorded observation.
 * A correction may change the canonical release link, NOT the observed version.
 * The model-supported software platforms and exact image/variant evidence limit
 * the choices; operators may deliberately resolve an ambiguous safe candidate.
 */
export function manualInventoryFirmwareTargets(input: {
  model: FirmwareLinkModel
  current: FirmwareLinkRelease | null
  observedVersion: string | null
  releases: readonly FirmwareLinkRelease[]
}): FirmwareLinkRelease[] {
  const { current, model } = input
  const version = normalizedObservedFirmwareVersion(input.observedVersion)
  if (!version || (current && (current.vendorId !== model.vendorId ||
    normalizedObservedFirmwareVersion(current.version) !== version))) return []
  const supported = new Set(supportedFirmwarePlatforms(model.platform).map(normalizedFirmwarePlatform))
  if (supported.size === 0) return []
  return input.releases.filter((release) =>
    release.isActive && release.id !== current?.id &&
    release.vendorId === model.vendorId &&
    supported.has(normalizedFirmwarePlatform(release.platform)) &&
    normalizedObservedFirmwareVersion(release.version) === version &&
    (!current || (same(current.variant, release.variant) && same(current.imageCode, release.imageCode))) &&
    (!release.firmwareTrain ||
      (release.firmwareTrain.isActive && same(release.firmwareTrain.platform, release.platform))) &&
    (!current?.firmwareTrain || !release.firmwareTrain ||
      same(current.firmwareTrain.name, release.firmwareTrain.name)),
  )
}
