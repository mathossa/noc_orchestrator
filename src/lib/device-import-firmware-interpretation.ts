import {
  extractFirmwareVersion,
  inferImportPlatform,
  isPlaceholderFirmwareVersion,
  normalizeImportText,
} from '@/lib/device-import'
import {
  classifyImportedDeviceModel,
  softwarePlatformLegacyValue,
} from '@/lib/device-import-normalization'
import type { DeviceImportFirmwareSource } from '@/lib/device-import-profile-predictions'

export type DeviceImportFirmwareEvidence = {
  vendor?: string | null
  model?: string | null
  platform?: string | null
  currentFirmware?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
  externalProvider?: string | null
}

export type DeviceImportFirmwareInterpretation = {
  currentFirmware: string | null
  platform: string | null
  firmwareSource: DeviceImportFirmwareSource
  reason: string | null
  firmwareVersionKind: 'ROMMON' | null
}

export type BuiltInFirmwareInterpretation = {
  firmwareSource: DeviceImportFirmwareSource | null
  reason: string | null
  firmwareVersionKind: 'ROMMON' | null
}

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

function meaningfulFirmware(value: string | null | undefined) {
  const version = extractFirmwareVersion(clean(value))
  if (!version || isPlaceholderFirmwareVersion(version) || !/\d/.test(version))
    return null
  return version
}

function platformKey(value: string | null | undefined) {
  return normalizeImportText(value).replace(/[^a-z0-9]+/g, '')
}

/**
 * Cisco publishes ROMMON/bootstrap versions with the `(<number>r)` suffix,
 * for example 16.12(3r) and 17.5(1r). They are useful raw evidence, but they
 * are not the running IOS/IOS-XE release we want as Device.currentFirmware.
 */
export function isCiscoRommonVersion(value: string | null | undefined) {
  const version = extractFirmwareVersion(clean(value))
  return Boolean(
    version && /^\d+\.\d+(?:\.\d+)?\(\d+r\)(?:[a-z0-9._-]*)?$/i.test(version),
  )
}

export function builtInPreferredModelPlatform(modelName: string) {
  const classification = classifyImportedDeviceModel(modelName)
  if (classification?.preferredSoftwarePlatformCode) {
    const preferred = classification.softwarePlatforms.find(
      (candidate) => candidate.code === classification.preferredSoftwarePlatformCode,
    )
    if (preferred) return softwarePlatformLegacyValue(preferred)
  }

  // Keep source interpretation conservative. These fallbacks cover product
  // families for which Auvik commonly reports boot firmware separately from
  // the running software, even when the model classifier has no entry yet.
  const model = normalizeImportText(modelName)
  if (/(?:^|\s)c(?:9800|11\d{2})(?:[\s._/-]|$)/i.test(model)) return 'IOS XE'
  if (
    /(?:^|\s)(?:2530|2540|2920|2930f|2930m|3810m|5400r)(?:[\s._/-]|$)/i.test(
      model,
    )
  )
    return 'AOS-S'
  return ''
}

export function builtInFirmwareInterpretation(input: {
  modelName: string
  platformName?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
}): BuiltInFirmwareInterpretation {
  const firmwareVersionKind = isCiscoRommonVersion(input.firmwareVersion)
    ? ('ROMMON' as const)
    : null
  const softwareVersion = meaningfulFirmware(input.softwareVersion)

  if (!softwareVersion) {
    return {
      firmwareSource: null,
      reason: firmwareVersionKind
        ? 'Cisco ROMMON/bootstrap firmware detected, but no usable Software Version was supplied.'
        : null,
      firmwareVersionKind,
    }
  }

  if (firmwareVersionKind) {
    return {
      firmwareSource: 'SOFTWARE_VERSION',
      reason:
        'Cisco ROMMON/bootstrap firmware is raw hardware evidence; use Software Version as the canonical running release.',
      firmwareVersionKind,
    }
  }

  const platform = platformKey(
    input.platformName || builtInPreferredModelPlatform(input.modelName),
  )
  if (['iosxe', 'ios', 'aoss', 'sx350'].includes(platform)) {
    return {
      firmwareSource: 'SOFTWARE_VERSION',
      reason: `${input.platformName || builtInPreferredModelPlatform(input.modelName)} reports its running release in Software Version when that evidence is available.`,
      firmwareVersionKind,
    }
  }

  return { firmwareSource: null, reason: null, firmwareVersionKind }
}

/**
 * Convert raw source evidence into the single canonical running-firmware value
 * used by staging. Raw firmwareVersion/softwareVersion fields remain untouched
 * and are retained for deep-dive/audit/rule evaluation.
 */
export function interpretDeviceImportFirmwareEvidence(
  values: DeviceImportFirmwareEvidence,
): DeviceImportFirmwareInterpretation {
  const modelName = clean(values.model) ?? ''
  const preferredModelPlatform = builtInPreferredModelPlatform(modelName)
  const platform =
    clean(values.platform) ||
    clean(preferredModelPlatform) ||
    clean(inferImportPlatform(values))

  const builtIn = builtInFirmwareInterpretation({
    modelName,
    platformName: platform,
    firmwareVersion: values.firmwareVersion,
    softwareVersion: values.softwareVersion,
  })

  const rawFirmware = meaningfulFirmware(values.firmwareVersion)
  const effectiveFirmware = meaningfulFirmware(values.currentFirmware)
  const softwareFirmware = meaningfulFirmware(values.softwareVersion)

  if (builtIn.firmwareSource === 'SOFTWARE_VERSION' && softwareFirmware) {
    return {
      currentFirmware: softwareFirmware,
      platform,
      firmwareSource: 'SOFTWARE_VERSION',
      reason: builtIn.reason,
      firmwareVersionKind: builtIn.firmwareVersionKind,
    }
  }

  if (rawFirmware) {
    return {
      currentFirmware: rawFirmware,
      platform,
      firmwareSource: 'FIRMWARE_VERSION',
      reason: null,
      firmwareVersionKind: builtIn.firmwareVersionKind,
    }
  }

  if (effectiveFirmware) {
    return {
      currentFirmware: effectiveFirmware,
      platform,
      firmwareSource: 'EFFECTIVE',
      reason: null,
      firmwareVersionKind: builtIn.firmwareVersionKind,
    }
  }

  if (softwareFirmware) {
    return {
      currentFirmware: softwareFirmware,
      platform,
      firmwareSource: 'SOFTWARE_VERSION',
      reason: 'Firmware Version is empty or a placeholder; use Software Version.',
      firmwareVersionKind: builtIn.firmwareVersionKind,
    }
  }

  return {
    currentFirmware: null,
    platform,
    firmwareSource: 'EFFECTIVE',
    reason: builtIn.reason,
    firmwareVersionKind: builtIn.firmwareVersionKind,
  }
}
