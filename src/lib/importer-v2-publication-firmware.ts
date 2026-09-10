export type ImporterV2FirmwarePublicationDecision = {
  field?: string | null
  action: string
}

function clean(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
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
