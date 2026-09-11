import { normalizedFirmwarePlatform } from '@/lib/firmware-releases'

export type ObservedFirmwareReleaseCandidate = {
  id: string
  vendorId: string
  platform: string
  version: string
}

export type ObservedFirmwareReleaseResolution<
  T extends ObservedFirmwareReleaseCandidate = ObservedFirmwareReleaseCandidate,
> =
  | { status: 'NONE'; release: null; candidates: readonly T[] }
  | { status: 'UNRESOLVED'; release: null; candidates: readonly T[] }
  | { status: 'AMBIGUOUS'; release: null; candidates: readonly T[] }
  | { status: 'MATCHED'; release: T; candidates: readonly T[] }

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

export function normalizedObservedFirmwareVersion(value: string | null | undefined) {
  return clean(value)?.toLocaleLowerCase('en-US') ?? ''
}

export function supportedFirmwarePlatforms(value: string | null | undefined) {
  if (!value) return []
  const platforms = new Map<string, string>()
  for (const raw of value.split(',')) {
    const platform = clean(raw)
    if (!platform) continue
    platforms.set(normalizedFirmwarePlatform(platform), platform)
  }
  return [...platforms.values()]
}

/**
 * Resolve the identity of an observed running release without making any policy
 * or compatibility decision. A release is an identity match when vendor,
 * reported version and (when known) observed/model platform identify exactly one
 * catalog record.
 *
 * Compatibility is deliberately not part of this function. A device can be
 * running an incompatible, blocked, withdrawn or otherwise undesirable release;
 * that does not make the observation unknown.
 */
export function resolveObservedFirmwareRelease<
  T extends ObservedFirmwareReleaseCandidate,
>(input: {
  vendorId: string
  observedVersion: string | null | undefined
  supportedPlatforms?: readonly string[]
  releases: readonly T[]
}): ObservedFirmwareReleaseResolution<T> {
  const version = normalizedObservedFirmwareVersion(input.observedVersion)
  if (!version) return { status: 'NONE', release: null, candidates: [] }

  const platformKeys = new Set(
    (input.supportedPlatforms ?? [])
      .map((platform) => normalizedFirmwarePlatform(platform))
      .filter(Boolean),
  )
  const candidates = input.releases.filter((release) => {
    if (release.vendorId !== input.vendorId) return false
    if (normalizedObservedFirmwareVersion(release.version) !== version) return false
    if (platformKeys.size === 0) return true
    return platformKeys.has(normalizedFirmwarePlatform(release.platform))
  })

  if (candidates.length === 1) {
    return { status: 'MATCHED', release: candidates[0], candidates }
  }
  if (candidates.length > 1) {
    return { status: 'AMBIGUOUS', release: null, candidates }
  }
  return { status: 'UNRESOLVED', release: null, candidates }
}
