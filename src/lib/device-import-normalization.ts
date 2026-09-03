import { normalizeImportText } from '@/lib/device-import'

export type CanonicalSoftwarePlatform = {
  code: string
  name: string
}

export type DeviceImportModelNormalization = {
  classificationKey: string
  model: string
  productFamilyName: string
  softwarePlatforms: CanonicalSoftwarePlatform[]
  preferredSoftwarePlatformCode: string | null
  deviceTypeName: string
  source: 'BUILT_IN' | 'PROFILE_RULE'
  confidence: number
}

export type StoredDeviceImportNormalizationRule = {
  operator: string
  value: string
  normalizedValue: string
  result: unknown
  priority?: number
}

type StoredResult = {
  classificationKey?: unknown
  model?: unknown
  productFamilyName?: unknown
  softwarePlatforms?: unknown
  preferredSoftwarePlatformCode?: unknown
  deviceTypeName?: unknown
}

const SOFTWARE_PLATFORM_ALIASES: Array<[string[], CanonicalSoftwarePlatform]> =
  [
    [['aos-s', 'aos s', 'arubaos-switch'], { code: 'AOS-S', name: 'AOS-S' }],
    [['aos-cx', 'aos cx', 'arubaos-cx'], { code: 'AOS-CX', name: 'AOS-CX' }],
    [['aos-8', 'aos 8'], { code: 'AOS-8', name: 'AOS 8' }],
    [['aos-10', 'aos 10'], { code: 'AOS-10', name: 'AOS 10' }],
    [['fortios', 'forti os'], { code: 'FORTIOS', name: 'FortiOS' }],
    [
      ['fortiswitch os/firmware', 'fortiswitch os', 'fortiswitch firmware'],
      { code: 'FORTISWITCH-OS', name: 'FortiSwitch OS/firmware' },
    ],
    [
      ['fortiap os/firmware', 'fortiap os', 'fortiap firmware'],
      { code: 'FORTIAP-OS', name: 'FortiAP OS/firmware' },
    ],
    [['ios xe', 'ios-xe'], { code: 'IOS-XE', name: 'IOS XE' }],
    [['ios'], { code: 'IOS', name: 'IOS' }],
    [['sx350', 's x 350', 'cisco sx350'], { code: 'SX350', name: 'Sx350' }],
  ]

export function canonicalSoftwarePlatform(
  value: string,
): CanonicalSoftwarePlatform {
  const normalized = normalizeImportText(value)
  for (const [aliases, platform] of SOFTWARE_PLATFORM_ALIASES) {
    if (aliases.some((alias) => normalizeImportText(alias) === normalized))
      return platform
  }
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return {
    code:
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'PLATFORM',
    name,
  }
}

export function softwarePlatformLegacyValue(value: CanonicalSoftwarePlatform) {
  return value.code.startsWith('AOS-') ? value.code : value.name
}

function cleanModel(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function stripKnownVendorPrefix(value: string) {
  return cleanModel(value)
    .replace(
      /^(?:hpe\s+aruba|hpe\s+networking|hewlett\s+packard\s+enterprise|fortinet|cisco|aruba)[\s._/-]+/i,
      '',
    )
    .trim()
}

function canonicalFortiModel(
  value: string,
  family: 'FortiGate' | 'FortiSwitch' | 'FortiAP',
) {
  const prefix =
    family === 'FortiGate' ? 'FG' : family === 'FortiSwitch' ? 'FS' : 'FAP'
  const withoutFamily = value.replace(
    new RegExp(`^${family}[\\s._/-]*`, 'i'),
    '',
  )
  const withoutPrefix = withoutFamily.replace(
    new RegExp(`^${prefix}[\\s._/-]*`, 'i'),
    '',
  )
  return `${prefix}-${withoutPrefix}`
    .replace(/-+/g, '-')
    .replace(/-$/, '')
    .toUpperCase()
}

function platform(code: string) {
  return canonicalSoftwarePlatform(code)
}

function builtInClassification(
  sourceValue: string,
): DeviceImportModelNormalization | null {
  const model = stripKnownVendorPrefix(sourceValue)

  if (
    /^(?:fortigate[\s._/-]*)?fg[\s._/-]*[a-z0-9]/i.test(model) ||
    /^fortigate[\s._/-]*[a-z0-9]/i.test(model)
  ) {
    return {
      classificationKey: 'FORTIGATE',
      model: canonicalFortiModel(model, 'FortiGate'),
      productFamilyName: 'FortiGate',
      softwarePlatforms: [platform('FortiOS')],
      preferredSoftwarePlatformCode: 'FORTIOS',
      deviceTypeName: 'Firewall',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (
    /^(?:fortiswitch[\s._/-]*)?fs[\s._/-]*[a-z0-9]/i.test(model) ||
    /^fortiswitch[\s._/-]*[a-z0-9]/i.test(model)
  ) {
    return {
      classificationKey: 'FORTISWITCH',
      model: canonicalFortiModel(model, 'FortiSwitch'),
      productFamilyName: 'FortiSwitch',
      softwarePlatforms: [platform('FortiSwitch OS/firmware')],
      preferredSoftwarePlatformCode: 'FORTISWITCH-OS',
      deviceTypeName: 'Switch',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (
    /^(?:fortiap[\s._/-]*)?fap[\s._/-]*[a-z0-9]/i.test(model) ||
    /^fortiap[\s._/-]*[a-z0-9]/i.test(model)
  ) {
    return {
      classificationKey: 'FORTIAP',
      model: canonicalFortiModel(model, 'FortiAP'),
      productFamilyName: 'FortiAP',
      softwarePlatforms: [platform('FortiAP OS/firmware')],
      preferredSoftwarePlatformCode: 'FORTIAP-OS',
      deviceTypeName: 'Access Point',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^(?:sg350(?:x|xg)?|sf350(?:x)?|sx350x)(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: 'CISCO_SX350',
      model: model.toUpperCase(),
      productFamilyName: 'Cisco 350 Series',
      softwarePlatforms: [platform('Sx350')],
      preferredSoftwarePlatformCode: 'SX350',
      deviceTypeName: 'Switch',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^c9120[a-z0-9]*(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: 'CISCO_C9120',
      model: model.toUpperCase(),
      productFamilyName: 'Catalyst',
      softwarePlatforms: [platform('IOS XE')],
      preferredSoftwarePlatformCode: 'IOS-XE',
      deviceTypeName: 'Access Point',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^c(?:9200(?:l|cx)?|9300(?:l|x|cx)?)(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: /^c9200/i.test(model) ? 'CISCO_C9200' : 'CISCO_C9300',
      model: model.toUpperCase(),
      productFamilyName: 'Catalyst',
      softwarePlatforms: [platform('IOS XE')],
      preferredSoftwarePlatformCode: 'IOS-XE',
      deviceTypeName: 'Switch',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^ws[\s._/-]*c2960x(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: 'CISCO_C2960X',
      model: model.toUpperCase().replace(/^WS[\s._/-]*C/i, 'WS-C'),
      productFamilyName: 'Catalyst',
      softwarePlatforms: [platform('IOS')],
      preferredSoftwarePlatformCode: 'IOS',
      deviceTypeName: 'Switch',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^2530(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: 'ARUBA_2530',
      model,
      productFamilyName: 'Aruba Switch',
      softwarePlatforms: [platform('AOS-S')],
      preferredSoftwarePlatformCode: 'AOS-S',
      deviceTypeName: 'Switch',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^cx[\s._/-]*6200/i.test(model)) {
    return {
      classificationKey: 'ARUBA_CX_6200',
      model: model.replace(/^cx[\s._/-]*/i, 'CX '),
      productFamilyName: 'Aruba CX',
      softwarePlatforms: [platform('AOS-CX')],
      preferredSoftwarePlatformCode: 'AOS-CX',
      deviceTypeName: 'Switch',
      source: 'BUILT_IN',
      confidence: 0.99,
    }
  }
  if (/^ap[\s._/-]*315(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: 'ARUBA_AP_315',
      model: model.toUpperCase().replace(/^AP[\s._/-]*/i, 'AP-'),
      productFamilyName: 'Aruba WLAN',
      softwarePlatforms: [platform('AOS 8'), platform('AOS 10')],
      preferredSoftwarePlatformCode: null,
      deviceTypeName: 'Access Point',
      source: 'BUILT_IN',
      confidence: 0.98,
    }
  }
  if (/^ap[\s._/-]*515(?:[\s._/-]|$)/i.test(model)) {
    return {
      classificationKey: 'ARUBA_AP_515',
      model: model.toUpperCase().replace(/^AP[\s._/-]*/i, 'AP-'),
      productFamilyName: 'Aruba WLAN',
      softwarePlatforms: [platform('AOS 10')],
      preferredSoftwarePlatformCode: 'AOS-10',
      deviceTypeName: 'Access Point',
      source: 'BUILT_IN',
      confidence: 0.98,
    }
  }
  return null
}

function storedClassification(
  sourceValue: string,
  rule: StoredDeviceImportNormalizationRule,
): DeviceImportModelNormalization | null {
  const source = normalizeImportText(sourceValue)
  const matches =
    rule.operator === 'PREFIX'
      ? source.startsWith(rule.normalizedValue)
      : source === rule.normalizedValue
  if (!matches || typeof rule.result !== 'object' || rule.result === null)
    return null
  const result = rule.result as StoredResult
  if (
    typeof result.model !== 'string' ||
    typeof result.productFamilyName !== 'string' ||
    typeof result.deviceTypeName !== 'string'
  )
    return null
  const softwarePlatforms = Array.isArray(result.softwarePlatforms)
    ? result.softwarePlatforms.flatMap((entry) => {
        if (typeof entry === 'string') return [canonicalSoftwarePlatform(entry)]
        if (typeof entry !== 'object' || entry === null) return []
        const candidate = entry as Record<string, unknown>
        return typeof candidate.code === 'string' &&
          typeof candidate.name === 'string'
          ? [{ code: candidate.code, name: candidate.name }]
          : []
      })
    : []
  if (!softwarePlatforms.length) return null
  return {
    classificationKey:
      typeof result.classificationKey === 'string'
        ? result.classificationKey
        : 'PROFILE_EXACT',
    model: cleanModel(result.model),
    productFamilyName: cleanModel(result.productFamilyName),
    softwarePlatforms,
    preferredSoftwarePlatformCode:
      typeof result.preferredSoftwarePlatformCode === 'string'
        ? result.preferredSoftwarePlatformCode
        : null,
    deviceTypeName: cleanModel(result.deviceTypeName),
    source: 'PROFILE_RULE',
    confidence: 1,
  }
}

export function classifyImportedDeviceModel(
  sourceValue: string,
  rules: StoredDeviceImportNormalizationRule[] = [],
) {
  const ordered = [...rules].sort(
    (left, right) => (right.priority ?? 100) - (left.priority ?? 100),
  )
  for (const rule of ordered) {
    const classification = storedClassification(sourceValue, rule)
    if (classification) return classification
  }
  return builtInClassification(sourceValue)
}

export function splitFirmwareVersionVariant(
  softwarePlatform: string,
  version: string,
) {
  const cleaned = version.normalize('NFKC').trim().replace(/^v/i, '')
  if (canonicalSoftwarePlatform(softwarePlatform).code !== 'AOS-S') {
    return { version: cleaned, variant: null as string | null }
  }
  const prefixed = cleaned.match(/^([A-Z]{1,4})[._-](\d+(?:\.\d+)+)$/i)
  if (!prefixed) return { version: cleaned, variant: null as string | null }
  return { version: prefixed[2], variant: prefixed[1].toUpperCase() }
}

export function inferFirmwareTrainName(
  softwarePlatform: string,
  version: string,
) {
  const { version: canonicalVersion } = splitFirmwareVersionVariant(softwarePlatform, version)
  const numeric = canonicalVersion.match(/^(\d+)\.(\d+)/)
  return numeric ? `${numeric[1]}.${numeric[2]}` : canonicalVersion
}
