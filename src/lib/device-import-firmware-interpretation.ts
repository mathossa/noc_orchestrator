import { inferImportPlatform, normalizeImportText } from '@/lib/device-import'
import {
  classifyImportedDeviceModel,
  softwarePlatformLegacyValue,
} from '@/lib/device-import-normalization'
import type { DeviceImportFirmwareSource } from '@/lib/device-import-profile-predictions'
import {
  isCiscoRommonVersion,
  selectImportedRunningFirmware,
  type ImportedRunningFirmwareSelection,
} from '@/lib/device-import-running-firmware'

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
}

type BuiltInFirmwareInput = {
  modelName: string
  platformName?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
  currentFirmware?: string | null
  vendor?: string | null
}

function clean(value: string | null | undefined) {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

function platformKey(value: string | null | undefined) {
  return normalizeImportText(value).replace(/[^a-z0-9]+/g, '')
}

function sourceForSelection(
  selection: ImportedRunningFirmwareSelection,
): DeviceImportFirmwareSource | null {
  if (selection.source === 'SOFTWARE_VERSION') return 'SOFTWARE_VERSION'
  if (selection.source === 'FIRMWARE_VERSION') return 'FIRMWARE_VERSION'
  if (selection.source === 'CURRENT_FIRMWARE') return 'EFFECTIVE'
  return null
}

function interpretationReason(selection: ImportedRunningFirmwareSelection) {
  if (selection.reason === 'CISCO_ROMMON')
    return 'Cisco ROMMON/bootstrap firmware is raw hardware evidence; use Software Version as the canonical running release.'
  if (selection.reason === 'AOS_S_BOOT_FIRMWARE')
    return 'AOS-S boot firmware differs from the running software; use Software Version as the canonical running release.'
  if (selection.reason === 'PLACEHOLDER_FIRMWARE')
    return 'Firmware Version is a placeholder; use Software Version as the canonical running release.'
  if (selection.reason === 'SOFTWARE_FALLBACK')
    return 'Firmware Version is empty or unusable; use Software Version as the canonical running release.'
  return null
}

export { isCiscoRommonVersion } from '@/lib/device-import-running-firmware'

export function builtInPreferredModelPlatform(modelName: string) {
  const classification = classifyImportedDeviceModel(modelName)
  if (classification?.preferredSoftwarePlatformCode) {
    const preferred = classification.softwarePlatforms.find(
      (candidate) => candidate.code === classification.preferredSoftwarePlatformCode,
    )
    if (preferred) return softwarePlatformLegacyValue(preferred)
  }

  // Conservative fallbacks for common source-of-truth model strings that have
  // not yet reached the model classifier. They only provide platform context;
  // running-firmware selection is still delegated to device-import-running-firmware.
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

export function builtInFirmwareInterpretation(
  modelName: string,
  platformName?: string | null,
): BuiltInFirmwareInterpretation
export function builtInFirmwareInterpretation(
  input: BuiltInFirmwareInput,
): BuiltInFirmwareInterpretation
export function builtInFirmwareInterpretation(
  inputOrModel: string | BuiltInFirmwareInput,
  legacyPlatformName = '',
): BuiltInFirmwareInterpretation {
  const input: BuiltInFirmwareInput =
    typeof inputOrModel === 'string'
      ? { modelName: inputOrModel, platformName: legacyPlatformName }
      : inputOrModel
  const platformName =
    clean(input.platformName) || builtInPreferredModelPlatform(input.modelName)
  const classification = classifyImportedDeviceModel(input.modelName)

  // Sx350 is the one platform with an explicit built-in source rule even when
  // raw evidence is not supplied to this helper. This preserves the established
  // Auvik SG350 behavior and the public helper contract used by tests/UI.
  if (
    classification?.classificationKey === 'CISCO_SX350' ||
    platformKey(platformName) === 'sx350'
  ) {
    return {
      firmwareSource: 'SOFTWARE_VERSION',
      reason:
        'Cisco Sx350: use Software Version as the canonical running release; keep Firmware Version as raw source evidence.',
    }
  }

  const selection = selectImportedRunningFirmware({
    currentFirmware: input.currentFirmware,
    firmwareVersion: input.firmwareVersion,
    softwareVersion: input.softwareVersion,
    vendor: input.vendor,
    model: input.modelName,
    platform: platformName,
  })
  const reason = interpretationReason(selection)
  if (!reason) return { firmwareSource: null, reason: null }
  return { firmwareSource: sourceForSelection(selection), reason }
}

/**
 * Convert raw source evidence into the single canonical running-firmware value
 * used by staging. Raw firmwareVersion/softwareVersion fields remain untouched
 * and are retained for deep-dive/audit/rule evaluation.
 *
 * The actual source decision is intentionally centralized in
 * device-import-running-firmware. This wrapper only adds canonical platform
 * context and translates the decision into the staged-import vocabulary.
 */
export function interpretDeviceImportFirmwareEvidence(
  values: DeviceImportFirmwareEvidence,
): DeviceImportFirmwareInterpretation {
  const modelName = clean(values.model) ?? ''
  const platform =
    clean(values.platform) ||
    clean(builtInPreferredModelPlatform(modelName)) ||
    clean(inferImportPlatform(values))

  const builtIn = builtInFirmwareInterpretation({
    modelName,
    platformName: platform,
    currentFirmware: values.currentFirmware,
    firmwareVersion: values.firmwareVersion,
    softwareVersion: values.softwareVersion,
    vendor: values.vendor,
  })
  const selection = selectImportedRunningFirmware({
    currentFirmware: values.currentFirmware,
    firmwareVersion: values.firmwareVersion,
    softwareVersion: values.softwareVersion,
    vendor: values.vendor,
    model: modelName,
    platform,
  })

  // A built-in rule is allowed to override the generic source selector only
  // when that source actually contains a usable version (currently Sx350).
  const source = builtIn.firmwareSource ?? sourceForSelection(selection) ?? 'EFFECTIVE'
  const selected =
    source === 'SOFTWARE_VERSION'
      ? selectImportedRunningFirmware({
          currentFirmware: null,
          firmwareVersion: null,
          softwareVersion: values.softwareVersion,
          vendor: values.vendor,
          model: modelName,
          platform,
        })
      : selection
  const currentFirmware = selected.version ?? selection.version

  return {
    currentFirmware,
    platform,
    firmwareSource: currentFirmware ? source : 'EFFECTIVE',
    reason: builtIn.reason ?? interpretationReason(selection),
    firmwareVersionKind: isCiscoRommonVersion(values.firmwareVersion)
      ? 'ROMMON'
      : null,
  }
}
