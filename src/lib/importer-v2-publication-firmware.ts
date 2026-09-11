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

/**
 * Decide whether an observed release may become Device.currentFirmwareReleaseId.
 *
 * Canonical release identity and model compatibility are deliberately separate.
 * When vendor/platform/version resolve to a canonical FirmwareRelease, that
 * release is the device's observed current release even when compatibility is
 * UNKNOWN or INCOMPATIBLE. Compatibility then controls technical status and
 * recommendations; it must never erase what the source actually reports as
 * running.
 *
 * If no canonical release identity was resolved, publication still persists the
 * raw/normalized observation and leaves currentFirmwareReleaseId null. Inventory
 * must show that observation instead of calling the running firmware Unknown.
 */
export function importerV2CurrentFirmwareReleaseId(input: {
  releaseId: string | null
  runningVersion: unknown
  softwarePlatform: unknown
  compatibilityStatus: unknown
  decisions: readonly ImporterV2FirmwarePublicationDecision[]
}) {
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
