import {
  extractFirmwareVersion,
  isPlaceholderFirmwareVersion,
  normalizeImportText,
} from '@/lib/device-import'

export type ImportedRunningFirmwareSource =
  | 'CURRENT_FIRMWARE'
  | 'FIRMWARE_VERSION'
  | 'SOFTWARE_VERSION'
  | 'UNKNOWN'

export type ImportedRunningFirmwareReason =
  | 'REPORTED_FIRMWARE'
  | 'CURRENT_FIRMWARE'
  | 'SOFTWARE_FALLBACK'
  | 'PLACEHOLDER_FIRMWARE'
  | 'CISCO_ROMMON'
  | 'AOS_S_BOOT_FIRMWARE'
  | 'UNKNOWN'

export type ImportedRunningFirmwareSelection = {
  version: string | null
  source: ImportedRunningFirmwareSource
  reason: ImportedRunningFirmwareReason
}

type ImportedFirmwareEvidence = {
  currentFirmware?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
}

function meaningfulVersion(value: string | null | undefined) {
  const version = extractFirmwareVersion(value ?? null)
  if (!version || isPlaceholderFirmwareVersion(version) || !/\d/.test(version))
    return null
  return version
}

export function isCiscoRommonVersion(value: string | null | undefined) {
  const version = extractFirmwareVersion(value ?? null)
  if (!version) return false
  // Cisco ROMMON/bootstrap releases use the characteristic "(Nr)" suffix,
  // for example 16.12(3r), 17.5(1r), and 17.12.1(1r). These are not IOS-XE
  // running software releases and must never become Current Firmware when a
  // usable Software Version is present in the source row.
  return /^v?\d+(?:\.\d+){1,3}\(\d+[a-z]?r\)$/i.test(version)
}

function aosSVersion(value: string | null | undefined) {
  const version = extractFirmwareVersion(value ?? null)
  if (!version) return null
  const match = version.match(/^([A-Z]{1,4})[._-](\d+(?:\.\d+){2,5})$/i)
  if (!match) return null
  return { prefix: match[1].toUpperCase(), version }
}

export function isAosSBootFirmwarePair(
  firmwareVersion: string | null | undefined,
  softwareVersion: string | null | undefined,
) {
  const firmware = aosSVersion(firmwareVersion)
  const software = aosSVersion(softwareVersion)
  return Boolean(
    firmware &&
      software &&
      firmware.prefix === software.prefix &&
      normalizeImportText(firmware.version) !== normalizeImportText(software.version),
  )
}

export function selectImportedRunningFirmware(
  evidence: ImportedFirmwareEvidence,
): ImportedRunningFirmwareSelection {
  const firmware = meaningfulVersion(evidence.firmwareVersion)
  const current = meaningfulVersion(evidence.currentFirmware)
  const software = meaningfulVersion(evidence.softwareVersion)
  const reportedRaw = evidence.firmwareVersion ?? evidence.currentFirmware

  if (
    software &&
    reportedRaw &&
    isPlaceholderFirmwareVersion(reportedRaw)
  ) {
    return {
      version: software,
      source: 'SOFTWARE_VERSION',
      reason: 'PLACEHOLDER_FIRMWARE',
    }
  }

  if (software && isCiscoRommonVersion(reportedRaw)) {
    return {
      version: software,
      source: 'SOFTWARE_VERSION',
      reason: 'CISCO_ROMMON',
    }
  }

  if (
    software &&
    isAosSBootFirmwarePair(evidence.firmwareVersion, evidence.softwareVersion)
  ) {
    return {
      version: software,
      source: 'SOFTWARE_VERSION',
      reason: 'AOS_S_BOOT_FIRMWARE',
    }
  }

  if (firmware) {
    return {
      version: firmware,
      source: 'FIRMWARE_VERSION',
      reason: 'REPORTED_FIRMWARE',
    }
  }

  if (current) {
    return {
      version: current,
      source: 'CURRENT_FIRMWARE',
      reason: 'CURRENT_FIRMWARE',
    }
  }

  if (software) {
    return {
      version: software,
      source: 'SOFTWARE_VERSION',
      reason: 'SOFTWARE_FALLBACK',
    }
  }

  return { version: null, source: 'UNKNOWN', reason: 'UNKNOWN' }
}
