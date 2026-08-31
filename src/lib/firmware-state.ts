export type TechnicalFirmwareState = 'CURRENT' | 'ACTION_REQUIRED' | 'UNKNOWN' | 'NO_POLICY'

export type FirmwareStateInput = {
  currentFirmwareReleaseId: string | null | undefined
  desiredFirmwareReleaseId: string | null | undefined
}

export function resolveTechnicalFirmwareState({
  currentFirmwareReleaseId,
  desiredFirmwareReleaseId,
}: FirmwareStateInput): TechnicalFirmwareState {
  if (!desiredFirmwareReleaseId) return 'NO_POLICY'
  if (!currentFirmwareReleaseId) return 'UNKNOWN'
  return currentFirmwareReleaseId === desiredFirmwareReleaseId ? 'CURRENT' : 'ACTION_REQUIRED'
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
