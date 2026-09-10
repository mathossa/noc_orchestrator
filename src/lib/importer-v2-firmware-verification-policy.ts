export const IMPORTER_V2_FIRMWARE_VERIFICATION_ACTION =
  'VERIFY_OBSERVED_FIRMWARE' as const

export type ImporterV2ObservedFirmwareVerificationValue = {
  runningVersion: string
  softwarePlatform: string
  originalCompatibilityStatus: string | null
  verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY'
}

export type ImporterV2ObservedFirmwareSnapshot = {
  proposedCanonicalValues?: Record<
    string,
    { id?: string | null; label?: string } | null
  >
  firmware?: {
    runningVersion?: string | null
    proposedSoftwarePlatform?: string | null
    compatibility?: { status?: string | null }
    warnings?: Array<{ code?: string | null; message?: string | null }>
  }
}

export type ImporterV2ObservedFirmwareVerificationDecision =
  | {
      status: 'VERIFY'
      value: ImporterV2ObservedFirmwareVerificationValue
    }
  | {
      status: 'ALREADY_TRUSTED'
      runningVersion: string
      softwarePlatform: string
    }
  | {
      status: 'MANUAL_REVIEW'
      reason: string
    }

const BULK_BLOCKING_WARNING_CODES = new Set([
  'FIRMWARE_EVIDENCE_CONFLICT',
  'PLATFORM_EVIDENCE_CONFLICT',
  'PLATFORM_INCOMPATIBLE',
  'UNKNOWN_RUNNING_FIRMWARE',
  'UNPARSEABLE_VERSION',
])

function text(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function targetLabel(
  snapshot: ImporterV2ObservedFirmwareSnapshot,
  field: 'currentFirmware' | 'softwarePlatform',
) {
  return text(snapshot.proposedCanonicalValues?.[field]?.label)
}

/**
 * Decide whether a staged observed firmware value is safe for one-click
 * engineer verification.
 *
 * Verification means only: "this is the firmware this device is currently
 * observed running". It deliberately does not make the release preferred,
 * recommended, policy-eligible, or globally compatible with the model.
 */
export function importerV2ObservedFirmwareVerificationDecision(
  snapshot: ImporterV2ObservedFirmwareSnapshot,
): ImporterV2ObservedFirmwareVerificationDecision {
  const runningVersion =
    targetLabel(snapshot, 'currentFirmware') ?? text(snapshot.firmware?.runningVersion)
  const softwarePlatform =
    targetLabel(snapshot, 'softwarePlatform') ??
    text(snapshot.firmware?.proposedSoftwarePlatform)
  const compatibilityStatus = text(snapshot.firmware?.compatibility?.status)

  if (!runningVersion) {
    return {
      status: 'MANUAL_REVIEW',
      reason:
        'No deterministic running firmware is available. Correct the firmware evidence before verification.',
    }
  }
  if (!softwarePlatform) {
    return {
      status: 'MANUAL_REVIEW',
      reason:
        `Running firmware “${runningVersion}” has no software platform. Resolve the platform before verification.`,
    }
  }

  const blockingWarning = snapshot.firmware?.warnings?.find((warning) =>
    BULK_BLOCKING_WARNING_CODES.has(warning.code ?? ''),
  )
  if (blockingWarning) {
    return {
      status: 'MANUAL_REVIEW',
      reason:
        text(blockingWarning.message) ??
        `Firmware evidence has unresolved warning ${blockingWarning.code}.`,
    }
  }

  if (compatibilityStatus === 'INCOMPATIBLE') {
    return {
      status: 'MANUAL_REVIEW',
      reason:
        `Observed firmware “${runningVersion}” is staged as incompatible with ${softwarePlatform}. Correct or explicitly override the evidence instead of bulk verifying it.`,
    }
  }

  if (compatibilityStatus === 'COMPATIBLE') {
    return {
      status: 'ALREADY_TRUSTED',
      runningVersion,
      softwarePlatform,
    }
  }

  return {
    status: 'VERIFY',
    value: {
      runningVersion,
      softwarePlatform,
      originalCompatibilityStatus: compatibilityStatus,
      verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
    },
  }
}

export function importerV2ObservedFirmwareWasVerified(
  decisions: readonly { action: string; value?: unknown }[],
) {
  return decisions.some((decision) => {
    if (decision.action !== IMPORTER_V2_FIRMWARE_VERIFICATION_ACTION) return false
    const value = decision.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidate = value as Partial<ImporterV2ObservedFirmwareVerificationValue>
    return (
      text(candidate.runningVersion) !== null &&
      text(candidate.softwarePlatform) !== null &&
      candidate.verificationScope === 'OBSERVED_CURRENT_FIRMWARE_ONLY'
    )
  })
}
