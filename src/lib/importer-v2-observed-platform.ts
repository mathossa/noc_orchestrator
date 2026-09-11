export type ImporterV2ObservedPlatformEvidence = {
  vendor?: string | null
  model?: string | null
  productFamily?: string | null
  softwarePlatform?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
}

export type ImporterV2ObservedPlatformInference = {
  platform: string
  evidence: 'MERAKI_FIRMWARE_FAMILY' | 'CISCO_CLASSIC_IOS_VERSION'
  firmwareFamily: string
  explanation: string
}

function clean(value: string | null | undefined) {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function key(value: string | null | undefined) {
  return clean(value)?.toLocaleLowerCase('en-US') ?? null
}

function merakiFirmwareFamily(value: string | null | undefined) {
  const normalized = clean(value)
  if (!normalized) return null
  const match = /^(?:Cisco\s+Meraki\s+|Meraki\s+)?(MR|MS|MX|MV|MG|MT)\s+(?=\d)/i.exec(normalized)
  return match?.[1]?.toUpperCase() ?? null
}

function hasCiscoClassicIosVersion(value: string | null | undefined) {
  const normalized = clean(value)
  if (!normalized) return false
  return /\b\d+\.\d+\(\d+[A-Za-z]?\)[A-Za-z0-9._-]+\b/.test(normalized)
}

/**
 * Infer only high-signal observed platforms that are encoded in the source
 * firmware value itself. This does not infer a platform from a model name alone.
 *
 * Meraki exports running software as e.g. "MR 32.2.4", "MS 17.2.1" and
 * "MX 19.1.4". Classic Cisco IOS releases use the long-lived
 * "15.2(7)E2"-style train syntax. Both are sufficiently distinctive when the
 * row also carries matching vendor/model context.
 */
export function inferImporterV2ObservedPlatform(
  input: ImporterV2ObservedPlatformEvidence,
): ImporterV2ObservedPlatformInference | null {
  if (clean(input.softwarePlatform)) return null

  const context = [input.vendor, input.model, input.productFamily]
    .map(key)
    .filter((value): value is string => Boolean(value))
    .join(' ')
  const merakiContext = context.includes('meraki')
  const ciscoContext = context.includes('cisco')

  const firmwareFamily =
    merakiFirmwareFamily(input.softwareVersion) ??
    merakiFirmwareFamily(input.firmwareVersion)
  if (firmwareFamily && (merakiContext || ciscoContext)) {
    return {
      platform: `Meraki ${firmwareFamily}`,
      evidence: 'MERAKI_FIRMWARE_FAMILY',
      firmwareFamily,
      explanation: `Meraki firmware family ${firmwareFamily} was read directly from the observed version prefix and mapped to Meraki ${firmwareFamily}.`,
    }
  }

  const classicIos =
    hasCiscoClassicIosVersion(input.softwareVersion) ||
    hasCiscoClassicIosVersion(input.firmwareVersion)
  if (classicIos && ciscoContext && !merakiContext) {
    return {
      platform: 'IOS',
      evidence: 'CISCO_CLASSIC_IOS_VERSION',
      firmwareFamily: 'IOS',
      explanation:
        'Classic Cisco IOS train syntax was read directly from the observed version and mapped to IOS.',
    }
  }

  return null
}

export function importerV2ObservedCompatibilityRule(input: {
  vendor: string | null
  model: string | null
  inference: ImporterV2ObservedPlatformInference | null
  existingRules: readonly { vendor?: string | null; model: string; platforms: readonly string[] }[]
}) {
  if (!input.inference || !clean(input.model)) return null
  const modelKey = key(input.model)
  const vendorKey = key(input.vendor)
  const hasCanonicalRule = input.existingRules.some((rule) => {
    if (key(rule.model) !== modelKey) return false
    const ruleVendorKey = key(rule.vendor)
    return !ruleVendorKey || !vendorKey || ruleVendorKey === vendorKey
  })
  if (hasCanonicalRule) return null

  return {
    id: `observed-source:${input.inference.firmwareFamily.toLocaleLowerCase('en-US')}:${modelKey}`,
    vendor: clean(input.vendor),
    model: clean(input.model)!,
    platforms: [input.inference.platform],
  }
}
