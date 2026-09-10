import { importerV2ObservedFirmwareVerificationValue } from '@/lib/importer-v2-firmware-verification-policy'

export type ImporterV2FirmwarePublicationDecision = {
  field?: string | null
  action: string
  value?: unknown
}

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function sameText(left: unknown, right: unknown) {
  const normalizedLeft = clean(left)?.toLocaleLowerCase('en-US') ?? null
  const normalizedRight = clean(right)?.toLocaleLowerCase('en-US') ?? null
  return normalizedLeft !== null && normalizedLeft === normalizedRight
}

/**
 * Decide whether an observed release may become Device.currentFirmwareReleaseId.
 *
 * COMPATIBLE observations can link automatically. UNKNOWN/NOT_EVALUATED
 * compatibility can link only when an engineer explicitly verified this exact
 * running version + platform as OBSERVED_CURRENT_FIRMWARE_ONLY. An explicit
 * INCOMPATIBLE result is never bypassed by this observation-only verification.
 *
 * Important invariant: when the evidence says a canonical link is required,
 * releaseId must exist. Publication must fail instead of silently persisting a
 * raw current-firmware observation with Device.currentFirmwareReleaseId = null.
 */
export function importerV2CurrentFirmwareReleaseId(input: {
  releaseId: string | null
  runningVersion: unknown
  softwarePlatform: unknown
  compatibilityStatus: unknown
  decisions: readonly ImporterV2FirmwarePublicationDecision[]
}) {
  const compatibilityStatus = clean(input.compatibilityStatus)?.toLocaleUpperCase('en-US')
  if (compatibilityStatus === 'INCOMPATIBLE') return null

  const compatible = compatibilityStatus === 'COMPATIBLE'
  const verified = importerV2ObservedFirmwareVerificationValue(input.decisions)
  const exactVerifiedObservation = Boolean(
    verified &&
      sameText(verified.runningVersion, input.runningVersion) &&
      sameText(verified.softwarePlatform, input.softwarePlatform),
  )

  if (!compatible && !exactVerifiedObservation) return null

  if (!input.releaseId) {
    const version = clean(input.runningVersion) ?? 'unknown version'
    const platform = clean(input.softwarePlatform) ?? 'unknown platform'
    throw new Error(
      `Importer publication invariant failed: observed current firmware “${version}” on “${platform}” is ${compatible ? 'compatible' : 'explicitly verified'} but no canonical firmware release was resolved. Publication was stopped to prevent Current firmware from becoming Unknown.`,
    )
  }

  return input.releaseId
}

/**
 * A blank/placeholder source firmware value is absence of evidence, not evidence
 * that a previously known canonical current firmware disappeared.
 *
 * Existing Device firmware is replaced only when this staged row has a concrete
 * interpreted running version, or when an operator explicitly cleared the
 * currentFirmware field in the reconciliation workspace.
 */
export function importerV2ShouldReplaceCurrentFirmware(input: {
  runningVersion: unknown
  decisions: readonly ImporterV2FirmwarePublicationDecision[]
}) {
  if (clean(input.runningVersion)) return true
  return input.decisions.some(
    (decision) =>
      decision.field === 'currentFirmware' && decision.action === 'CLEAR_FIELD',
  )
}
