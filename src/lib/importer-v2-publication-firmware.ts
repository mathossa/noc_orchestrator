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
 */
export function importerV2CurrentFirmwareReleaseId(input: {
  releaseId: string | null
  runningVersion: unknown
  softwarePlatform: unknown
  compatibilityStatus: unknown
  decisions: readonly ImporterV2FirmwarePublicationDecision[]
}) {
  if (!input.releaseId) return null

  const compatibilityStatus = clean(input.compatibilityStatus)?.toLocaleUpperCase('en-US')
  if (compatibilityStatus === 'INCOMPATIBLE') return null
  if (compatibilityStatus === 'COMPATIBLE') return input.releaseId

  const verified = importerV2ObservedFirmwareVerificationValue(input.decisions)
  if (!verified) return null
  if (!sameText(verified.runningVersion, input.runningVersion)) return null
  if (!sameText(verified.softwarePlatform, input.softwarePlatform)) return null

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
