import type { FirmwareComplianceResult } from '@/lib/firmware-compliance'

export type TechnicalFirmwareState = 'CURRENT' | 'ACTION_REQUIRED' | 'UNKNOWN' | 'NO_POLICY'

/** Legacy summary vocabulary, projected only from the central technical result. */
export function resolveTechnicalFirmwareState(result: FirmwareComplianceResult): TechnicalFirmwareState {
  if (result.compliance === 'NO_POLICY') return 'NO_POLICY'
  if (result.compliance === 'UNKNOWN_FIRMWARE') return 'UNKNOWN'
  return result.recommendation === 'NO_ACTION' ? 'CURRENT' : 'ACTION_REQUIRED'
}

export function emptyTechnicalFirmwareStateCounts() {
  return {
    current: 0,
    actionRequired: 0,
    unknown: 0,
    noPolicy: 0,
  }
}

export function incrementTechnicalFirmwareStateCount(
  counts: ReturnType<typeof emptyTechnicalFirmwareStateCounts>,
  state: TechnicalFirmwareState,
) {
  switch (state) {
    case 'CURRENT':
      counts.current += 1
      break
    case 'ACTION_REQUIRED':
      counts.actionRequired += 1
      break
    case 'UNKNOWN':
      counts.unknown += 1
      break
    case 'NO_POLICY':
      counts.noPolicy += 1
      break
  }
  return counts
}
