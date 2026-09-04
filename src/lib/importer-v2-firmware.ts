import { createHash } from 'node:crypto'

export const IMPORTER_V2_FIRMWARE_INTERPRETER_ID =
  'importer-v2-firmware-interpreter'
export const IMPORTER_V2_FIRMWARE_INTERPRETER_VERSION = '1.0.0'

export type ImporterV2FirmwareConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type ImporterV2FirmwareCompatibilityStatus =
  | 'COMPATIBLE'
  | 'INCOMPATIBLE'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE'

export type ImporterV2FirmwareWarningCode =
  | 'BOOT_FIRMWARE_IGNORED'
  | 'PLACEHOLDER_FIRMWARE_IGNORED'
  | 'FIRMWARE_EVIDENCE_CONFLICT'
  | 'PLATFORM_EVIDENCE_CONFLICT'
  | 'PLATFORM_INCOMPATIBLE'
  | 'UNKNOWN_RUNNING_FIRMWARE'
  | 'UNPARSEABLE_VERSION'

export type ImporterV2FirmwareWarning = {
  code: ImporterV2FirmwareWarningCode
  message: string
}

export type ImporterV2FirmwareEvidence = {
  provider?: string | null
  vendor?: string | null
  model?: string | null
  productFamily?: string | null
  softwarePlatform?: string | null
  sourceDeviceType?: string | null
  firmwareVersion?: string | null
  softwareVersion?: string | null
  providerMetadata?: Readonly<Record<string, unknown>> | null
}

export type ImporterV2FirmwareCompatibilityRule = {
  id: string
  vendor?: string | null
  model: string
  platforms: readonly string[]
}

export type ImporterV2FirmwareInterpretationContext = {
  compatibilityVersion: string
  compatibilityRules: readonly ImporterV2FirmwareCompatibilityRule[]
  placeholderFirmwareValues?: readonly string[]
}

export type ImporterV2FirmwareCompatibility = {
  status: ImporterV2FirmwareCompatibilityStatus
  ruleId: string | null
  allowedPlatforms: readonly string[]
  explanation: string
}

export type ImporterV2FirmwarePlatformEvidence =
  | 'RAW_SOURCE_PLATFORM'
  | 'VERSION_EVIDENCE'
  | 'SOURCE_DEVICE_TYPE'
  | 'NONE'

export type ImporterV2FirmwareInterpretation = {
  interpreterId: typeof IMPORTER_V2_FIRMWARE_INTERPRETER_ID
  interpreterVersion: typeof IMPORTER_V2_FIRMWARE_INTERPRETER_VERSION
  decisionId: string
  confidence: ImporterV2FirmwareConfidence
  rawEvidence: Readonly<
    Required<Omit<ImporterV2FirmwareEvidence, 'providerMetadata'>>
  > & {
    providerMetadata: Readonly<Record<string, unknown>> | null
  }
  normalizedEvidence: {
    vendor: string | null
    model: string | null
    softwarePlatform: string | null
    firmwareVersion: string | null
    softwareVersion: string | null
  }
  runningVersion: string | null
  proposedSoftwarePlatform: string | null
  platformEvidence: ImporterV2FirmwarePlatformEvidence
  explanation: string
  compatibility: ImporterV2FirmwareCompatibility
  warnings: readonly ImporterV2FirmwareWarning[]
  requiresConfirmation: true
}

export type ImporterV2FirmwareProofRow = {
  rowNumber: number
  rowFingerprint: string
  customer?: string | null
  model?: string | null
  deviceName?: string | null
  interpretation: ImporterV2FirmwareInterpretation
}

export type ImporterV2FirmwareProofGroup = {
  key: string
  count: number
  rowNumbers: readonly number[]
  customers: readonly string[]
  models: readonly string[]
  sampleDevices: readonly {
    rowNumber: number
    deviceName: string | null
    customer: string | null
    model: string | null
  }[]
  interpretation: ImporterV2FirmwareInterpretation
  requiresConfirmation: true
}

export type ImporterV2FirmwareProofDecision =
  | {
      id: string
      groupKey: string
      action: 'APPROVE'
      explanation?: string | null
    }
  | {
      id: string
      groupKey: string
      action: 'CORRECT'
      runningVersion: string | null
      softwarePlatform: string | null
      explanation: string
    }

export type ImporterV2ReviewedFirmwareRow = ImporterV2FirmwareProofRow & {
  review:
    | { status: 'PENDING'; decisionId: null; explanation: null }
    | {
        status: 'APPROVED' | 'CORRECTED'
        decisionId: string
        explanation: string | null
      }
}

export type ImporterV2FirmwarePublicationProposal = {
  rowNumber: number
  rowFingerprint: string
  observedRunningVersion: string | null
  proposedSoftwarePlatform: string | null
  canonicalReleaseId: null
  canonicalPlatformId: null
  observedReleaseState: 'OBSERVED_AVAILABLE'
  proofDecisionId: string
}

const DEFAULT_PLACEHOLDER_FIRMWARE_VALUES = [
  '-',
  '--',
  'n/a',
  'na',
  'none',
  'null',
  'unknown',
  'not available',
  'not reported',
  '0.1',
] as const

function normalizeText(value: string | null | undefined) {
  if (value === null || value === undefined) return null
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized || null
}

function key(value: string | null | undefined) {
  return normalizeText(value)?.toLocaleLowerCase('en-US') ?? null
}

function canonicalPlatform(value: string | null | undefined) {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const compact = normalized
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]/g, '')

  const known: Record<string, string> = {
    iosxe: 'IOS-XE',
    ciscoiosxe: 'IOS-XE',
    ios: 'IOS',
    ciscoios: 'IOS',
    aoss: 'AOS-S',
    arubaoss: 'AOS-S',
    arubaosswitch: 'AOS-S',
    arubaosswitching: 'AOS-S',
    aoscx: 'AOS-CX',
    arubaaoscx: 'AOS-CX',
    aos8: 'AOS-8',
    arubaos8: 'AOS-8',
    aos10: 'AOS-10',
    arubaos10: 'AOS-10',
    fortigate: 'FortiGate',
    fortios: 'FortiGate',
    fortiswitch: 'FortiSwitch',
    fortiswitchos: 'FortiSwitch',
    fortiap: 'FortiAP',
  }
  return known[compact] ?? normalized
}

function completeRawEvidence(
  evidence: ImporterV2FirmwareEvidence,
): ImporterV2FirmwareInterpretation['rawEvidence'] {
  return {
    provider: evidence.provider ?? null,
    vendor: evidence.vendor ?? null,
    model: evidence.model ?? null,
    productFamily: evidence.productFamily ?? null,
    softwarePlatform: evidence.softwarePlatform ?? null,
    sourceDeviceType: evidence.sourceDeviceType ?? null,
    firmwareVersion: evidence.firmwareVersion ?? null,
    softwareVersion: evidence.softwareVersion ?? null,
    providerMetadata: evidence.providerMetadata ?? null,
  }
}

function isPlaceholder(
  value: string | null,
  context: ImporterV2FirmwareInterpretationContext,
) {
  const valueKey = key(value)
  if (!valueKey) return true
  const placeholders = [
    ...DEFAULT_PLACEHOLDER_FIRMWARE_VALUES,
    ...(context.placeholderFirmwareValues ?? []),
  ]
  return placeholders.some((placeholder) => key(placeholder) === valueKey)
}

function extractVersion(value: string | null) {
  if (!value) return null

  const arubaCode = value.match(/\b([A-Z]{2}\.\d{2}\.\d{2}\.\d{4})\b/i)
  if (arubaCode?.[1]) return arubaCode[1].toUpperCase()

  const ciscoClassic = value.match(
    /\b(\d+\.\d+\(\d+[A-Za-z]?\)[A-Za-z0-9._-]+)\b/,
  )
  if (ciscoClassic?.[1]) return ciscoClassic[1]

  const ciscoRommon = value.match(/\b(\d+\.\d+\(\d+[A-Za-z]?r\))/i)
  if (ciscoRommon?.[1]) return ciscoRommon[1]

  const fortinet = value.match(/\bv(\d+\.\d+(?:\.\d+){1,2})\b/i)
  if (fortinet?.[1]) return fortinet[1]

  const generic = value.match(
    /\b(\d+\.\d+(?:\.\d+){0,2}(?:_[0-9]+)?(?:[A-Za-z][A-Za-z0-9._-]*)?)\b/,
  )
  return generic?.[1] ?? null
}

function isCiscoRommon(value: string | null) {
  return Boolean(value && /^\d+\.\d+\(\d+[A-Za-z]?r\)$/i.test(value))
}

function sameVersion(left: string | null, right: string | null) {
  return Boolean(left && right && key(left) === key(right))
}

function isVendor(evidence: ImporterV2FirmwareEvidence, needle: string) {
  return [evidence.vendor, evidence.provider]
    .map(key)
    .some((value) => value?.includes(needle))
}

function evidenceText(evidence: ImporterV2FirmwareEvidence) {
  return [
    evidence.vendor,
    evidence.softwarePlatform,
    evidence.sourceDeviceType,
    evidence.firmwareVersion,
    evidence.softwareVersion,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('en-US')
}

function explicitPlatformFromEvidence(
  evidence: ImporterV2FirmwareEvidence,
  runningVersion: string | null,
): {
  platform: string | null
  source: ImporterV2FirmwarePlatformEvidence
  conflict?: string | null
} {
  const rawPlatform = canonicalPlatform(evidence.softwarePlatform)
  const text = evidenceText(evidence)
  let inferred: string | null = null
  let source: ImporterV2FirmwarePlatformEvidence = 'NONE'

  if (/\bios[ -]?xe\b/.test(text)) {
    inferred = 'IOS-XE'
    source = 'VERSION_EVIDENCE'
  } else if (/\b(?:cisco )?ios(?: software)?\b/.test(text)) {
    inferred = 'IOS'
    source = 'VERSION_EVIDENCE'
  } else if (/\bfortigate\b|\bfortios\b/.test(text)) {
    inferred = 'FortiGate'
    source = 'SOURCE_DEVICE_TYPE'
  } else if (/\bfortiswitch(?:os)?\b/.test(text)) {
    inferred = 'FortiSwitch'
    source = 'SOURCE_DEVICE_TYPE'
  } else if (/\bfortiap\b/.test(text)) {
    inferred = 'FortiAP'
    source = 'SOURCE_DEVICE_TYPE'
  } else if (/\baos[- ]?cx\b/.test(text)) {
    inferred = 'AOS-CX'
    source = 'VERSION_EVIDENCE'
  } else if (/\baos[- ]?s\b|\barubaos[- ]switch\b/.test(text)) {
    inferred = 'AOS-S'
    source = 'VERSION_EVIDENCE'
  }

  const arubaVendor =
    isVendor(evidence, 'aruba') || isVendor(evidence, 'hewlett packard')
  const sourceType = key(evidence.sourceDeviceType)
  const wlanLike =
    sourceType?.includes('wireless') ||
    sourceType?.includes('access point') ||
    sourceType === 'ap' ||
    text.includes('controller') ||
    text.includes('instant')
  const runningMajor = runningVersion?.match(/^(\d+)\./)?.[1]
  if (
    arubaVendor &&
    runningVersion &&
    /^[A-Z]{2}\.16\./i.test(runningVersion)
  ) {
    inferred = 'AOS-S'
    source = 'VERSION_EVIDENCE'
  }
  if (arubaVendor && wlanLike && (runningMajor === '8' || runningMajor === '10')) {
    inferred = runningMajor === '8' ? 'AOS-8' : 'AOS-10'
    source = 'VERSION_EVIDENCE'
  }

  if (rawPlatform && inferred && key(rawPlatform) !== key(inferred)) {
    return {
      platform: inferred,
      source,
      conflict: `Source platform “${rawPlatform}” conflicts with deployment/version evidence for “${inferred}”.`,
    }
  }
  if (inferred) return { platform: inferred, source }
  if (rawPlatform) {
    return { platform: rawPlatform, source: 'RAW_SOURCE_PLATFORM' }
  }

  const sourceTypePlatform = canonicalPlatform(evidence.sourceDeviceType)
  if (
    sourceTypePlatform &&
    ['FortiGate', 'FortiSwitch', 'FortiAP'].includes(sourceTypePlatform)
  ) {
    return {
      platform: sourceTypePlatform,
      source: 'SOURCE_DEVICE_TYPE',
    }
  }
  return { platform: null, source: 'NONE' }
}

function compatibilityFor(
  evidence: ImporterV2FirmwareEvidence,
  platform: string | null,
  context: ImporterV2FirmwareInterpretationContext,
): ImporterV2FirmwareCompatibility {
  if (!platform) {
    return {
      status: 'NOT_APPLICABLE',
      ruleId: null,
      allowedPlatforms: [],
      explanation:
        'No software platform was proposed, so compatibility is not applicable.',
    }
  }

  const modelKey = key(evidence.model)
  if (!modelKey) {
    return {
      status: 'UNKNOWN',
      ruleId: null,
      allowedPlatforms: [],
      explanation:
        'No model was available for model-platform compatibility checking.',
    }
  }

  const vendorKey = key(evidence.vendor)
  const matches = context.compatibilityRules.filter((rule) => {
    if (key(rule.model) !== modelKey) return false
    const ruleVendor = key(rule.vendor)
    return !ruleVendor || !vendorKey || ruleVendor === vendorKey
  })

  if (matches.length === 0) {
    return {
      status: 'UNKNOWN',
      ruleId: null,
      allowedPlatforms: [],
      explanation:
        'No model-platform compatibility rule exists for this model. Model name was not used to infer a platform.',
    }
  }

  const allowedPlatforms = [
    ...new Set(matches.flatMap((rule) => rule.platforms.map(canonicalPlatform))),
  ].filter((value): value is string => Boolean(value))
  const compatible = allowedPlatforms.some(
    (allowed) => key(allowed) === key(platform),
  )
  return {
    status: compatible ? 'COMPATIBLE' : 'INCOMPATIBLE',
    ruleId: matches.map((rule) => rule.id).sort().join(','),
    allowedPlatforms,
    explanation: compatible
      ? `The proposed platform “${platform}” is compatible with the model according to ${context.compatibilityVersion}.`
      : `The proposed platform “${platform}” is not listed as compatible with this model according to ${context.compatibilityVersion}.`,
  }
}

function result(
  evidence: ImporterV2FirmwareEvidence,
  context: ImporterV2FirmwareInterpretationContext,
  decision: {
    decisionId: string
    confidence: ImporterV2FirmwareConfidence
    runningVersion: string | null
    explanation: string
    warnings?: ImporterV2FirmwareWarning[]
  },
): ImporterV2FirmwareInterpretation {
  const platformDecision = explicitPlatformFromEvidence(
    evidence,
    decision.runningVersion,
  )
  const warnings = [...(decision.warnings ?? [])]
  if (platformDecision.conflict) {
    warnings.push({
      code: 'PLATFORM_EVIDENCE_CONFLICT',
      message: platformDecision.conflict,
    })
  }
  const compatibility = compatibilityFor(
    evidence,
    platformDecision.platform,
    context,
  )
  if (compatibility.status === 'INCOMPATIBLE') {
    warnings.push({
      code: 'PLATFORM_INCOMPATIBLE',
      message: compatibility.explanation,
    })
  }
  if (!decision.runningVersion) {
    warnings.push({
      code: 'UNKNOWN_RUNNING_FIRMWARE',
      message:
        'Running firmware could not be determined deterministically. The device remains importable and requires review.',
    })
  }

  const confidence: ImporterV2FirmwareConfidence =
    compatibility.status === 'INCOMPATIBLE' || platformDecision.conflict
      ? 'LOW'
      : decision.confidence

  return {
    interpreterId: IMPORTER_V2_FIRMWARE_INTERPRETER_ID,
    interpreterVersion: IMPORTER_V2_FIRMWARE_INTERPRETER_VERSION,
    decisionId: decision.decisionId,
    confidence,
    rawEvidence: completeRawEvidence(evidence),
    normalizedEvidence: {
      vendor: normalizeText(evidence.vendor),
      model: normalizeText(evidence.model),
      softwarePlatform: canonicalPlatform(evidence.softwarePlatform),
      firmwareVersion: normalizeText(evidence.firmwareVersion),
      softwareVersion: normalizeText(evidence.softwareVersion),
    },
    runningVersion: decision.runningVersion,
    proposedSoftwarePlatform: platformDecision.platform,
    platformEvidence: platformDecision.source,
    explanation: `${decision.explanation} ${compatibility.explanation}`,
    compatibility,
    warnings,
    requiresConfirmation: true,
  }
}

export function interpretImporterV2Firmware(
  evidence: ImporterV2FirmwareEvidence,
  context: ImporterV2FirmwareInterpretationContext,
): ImporterV2FirmwareInterpretation {
  const rawFirmware = normalizeText(evidence.firmwareVersion)
  const rawSoftware = normalizeText(evidence.softwareVersion)
  const firmwarePlaceholder = Boolean(
    rawFirmware && isPlaceholder(rawFirmware, context),
  )
  const softwarePlaceholder = Boolean(
    rawSoftware && isPlaceholder(rawSoftware, context),
  )
  const firmwareVersion = firmwarePlaceholder ? null : extractVersion(rawFirmware)
  const softwareVersion = softwarePlaceholder ? null : extractVersion(rawSoftware)
  const warnings: ImporterV2FirmwareWarning[] = []

  if (rawFirmware && firmwarePlaceholder) {
    warnings.push({
      code: 'PLACEHOLDER_FIRMWARE_IGNORED',
      message: `Firmware Version “${rawFirmware}” is a placeholder and was retained only as raw evidence.`,
    })
  }

  const ciscoEvidence =
    isVendor(evidence, 'cisco') || /\bcisco\b/.test(evidenceText(evidence))
  if (ciscoEvidence && isCiscoRommon(firmwareVersion)) {
    warnings.push({
      code: 'BOOT_FIRMWARE_IGNORED',
      message: `Firmware Version “${firmwareVersion}” matches Cisco ROMMON/bootstrap syntax and is not treated as the running IOS/IOS-XE release.`,
    })
    if (softwareVersion) {
      return result(evidence, context, {
        decisionId: 'cisco-rommon-software-running',
        confidence: 'HIGH',
        runningVersion: softwareVersion,
        explanation:
          'Cisco ROMMON/bootstrap evidence was separated from the populated Software Version, which was selected as the running release.',
        warnings,
      })
    }
    return result(evidence, context, {
      decisionId: 'cisco-rommon-without-running-software',
      confidence: 'LOW',
      runningVersion: null,
      explanation:
        'Only Cisco ROMMON/bootstrap evidence was available, so no running IOS/IOS-XE release was inferred.',
      warnings,
    })
  }

  const arubaEvidence =
    isVendor(evidence, 'aruba') ||
    isVendor(evidence, 'hewlett packard') ||
    /\baruba\b/.test(evidenceText(evidence))
  const firmwareIsArubaCode = Boolean(
    firmwareVersion &&
      /^[A-Z]{2}\.\d{2}\.\d{2}\.\d{4}$/i.test(firmwareVersion),
  )
  const softwareIsArubaCode = Boolean(
    softwareVersion &&
      /^[A-Z]{2}\.\d{2}\.\d{2}\.\d{4}$/i.test(softwareVersion),
  )
  if (
    arubaEvidence &&
    firmwareIsArubaCode &&
    softwareIsArubaCode &&
    !sameVersion(firmwareVersion, softwareVersion)
  ) {
    warnings.push({
      code: 'BOOT_FIRMWARE_IGNORED',
      message: `Firmware Version “${firmwareVersion}” was retained as boot/firmware evidence while Software Version “${softwareVersion}” was treated as the running AOS-S software release.`,
    })
    return result(evidence, context, {
      decisionId: 'aruba-aos-s-software-running',
      confidence: 'HIGH',
      runningVersion: softwareVersion,
      explanation:
        'Aruba AOS-S-style boot firmware and running software values differed, so the Software Version was selected as the observed running release.',
      warnings,
    })
  }

  if (
    firmwareVersion &&
    softwareVersion &&
    sameVersion(firmwareVersion, softwareVersion)
  ) {
    return result(evidence, context, {
      decisionId: 'same-release-both-columns',
      confidence: 'HIGH',
      runningVersion: softwareVersion,
      explanation:
        'Firmware Version and Software Version resolve to the same release after deterministic vendor-text extraction.',
      warnings,
    })
  }

  if (!firmwareVersion && softwareVersion) {
    return result(evidence, context, {
      decisionId: rawFirmware
        ? 'placeholder-firmware-software-running'
        : 'blank-firmware-software-running',
      confidence: 'MEDIUM',
      runningVersion: softwareVersion,
      explanation: rawFirmware
        ? 'Firmware Version was a known placeholder, so the structured Software Version was selected as the running release.'
        : 'Firmware Version was blank and the structured Software Version was selected as the running release.',
      warnings,
    })
  }

  if (firmwareVersion && !softwareVersion) {
    if (rawSoftware && !softwarePlaceholder) {
      warnings.push({
        code: 'UNPARSEABLE_VERSION',
        message: `Software Version “${rawSoftware}” did not contain a deterministic version token.`,
      })
    }
    return result(evidence, context, {
      decisionId: 'firmware-only-running',
      confidence: 'MEDIUM',
      runningVersion: firmwareVersion,
      explanation:
        'Only Firmware Version contained a deterministic running-version candidate.',
      warnings,
    })
  }

  if (
    firmwareVersion &&
    softwareVersion &&
    !sameVersion(firmwareVersion, softwareVersion)
  ) {
    warnings.push({
      code: 'FIRMWARE_EVIDENCE_CONFLICT',
      message: `Firmware Version resolves to “${firmwareVersion}” while Software Version resolves to “${softwareVersion}”; no generic winner was chosen.`,
    })
    return result(evidence, context, {
      decisionId: 'conflicting-firmware-evidence',
      confidence: 'LOW',
      runningVersion: null,
      explanation:
        'The two populated source columns point to different releases and no vendor-specific deterministic rule applies.',
      warnings,
    })
  }

  if (rawFirmware && !firmwarePlaceholder && !firmwareVersion) {
    warnings.push({
      code: 'UNPARSEABLE_VERSION',
      message: `Firmware Version “${rawFirmware}” did not contain a deterministic version token.`,
    })
  }
  if (rawSoftware && !softwarePlaceholder && !softwareVersion) {
    warnings.push({
      code: 'UNPARSEABLE_VERSION',
      message: `Software Version “${rawSoftware}” did not contain a deterministic version token.`,
    })
  }
  return result(evidence, context, {
    decisionId: 'unknown-running-firmware',
    confidence: 'LOW',
    runningVersion: null,
    explanation:
      'No deterministic running firmware could be extracted from the supplied source evidence.',
    warnings,
  })
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, nested]) => [name, stableValue(nested)]),
    )
  }
  return value
}

function proofKey(row: ImporterV2FirmwareProofRow) {
  const proof = row.interpretation
  return createHash('sha256')
    .update(
      JSON.stringify(
        stableValue({
          provider: key(proof.rawEvidence.provider),
          vendor: proof.normalizedEvidence.vendor,
          model: proof.normalizedEvidence.model,
          sourceDeviceType: key(proof.rawEvidence.sourceDeviceType),
          softwarePlatform: proof.normalizedEvidence.softwarePlatform,
          firmwareVersion: proof.normalizedEvidence.firmwareVersion,
          softwareVersion: proof.normalizedEvidence.softwareVersion,
          runningVersion: proof.runningVersion,
          proposedSoftwarePlatform: proof.proposedSoftwarePlatform,
          decisionId: proof.decisionId,
          interpreterVersion: proof.interpreterVersion,
          compatibilityStatus: proof.compatibility.status,
          compatibilityRuleId: proof.compatibility.ruleId,
        }),
      ),
    )
    .digest('hex')
}

function sortedDistinct(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((left, right) => left.localeCompare(right))
}

export function groupImporterV2FirmwareProofs(
  rows: readonly ImporterV2FirmwareProofRow[],
  sampleLimit = 5,
): ImporterV2FirmwareProofGroup[] {
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(sampleLimit)))
  const grouped = new Map<string, ImporterV2FirmwareProofRow[]>()
  for (const row of rows) {
    const groupKey = proofKey(row)
    const existing = grouped.get(groupKey) ?? []
    existing.push(row)
    grouped.set(groupKey, existing)
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupKey, members]) => ({
      key: groupKey,
      count: members.length,
      rowNumbers: members
        .map((member) => member.rowNumber)
        .sort((a, b) => a - b),
      customers: sortedDistinct(members.map((member) => member.customer)),
      models: sortedDistinct(members.map((member) => member.model)),
      sampleDevices: members
        .toSorted((left, right) => left.rowNumber - right.rowNumber)
        .slice(0, boundedLimit)
        .map((member) => ({
          rowNumber: member.rowNumber,
          deviceName: member.deviceName ?? null,
          customer: member.customer ?? null,
          model: member.model ?? null,
        })),
      interpretation: members[0].interpretation,
      requiresConfirmation: true as const,
    }))
}

export function applyImporterV2FirmwareProofDecisions(
  rows: readonly ImporterV2FirmwareProofRow[],
  decisions: readonly ImporterV2FirmwareProofDecision[],
  context: ImporterV2FirmwareInterpretationContext,
): ImporterV2ReviewedFirmwareRow[] {
  const knownGroups = new Set(rows.map(proofKey))
  const decisionByGroup = new Map<string, ImporterV2FirmwareProofDecision>()
  for (const decision of decisions) {
    if (!knownGroups.has(decision.groupKey)) {
      throw new Error(
        `Firmware proof decision ${decision.id} references unknown group ${decision.groupKey}.`,
      )
    }
    if (decisionByGroup.has(decision.groupKey)) {
      throw new Error(
        `Multiple firmware proof decisions were supplied for group ${decision.groupKey}.`,
      )
    }
    decisionByGroup.set(decision.groupKey, decision)
  }

  return rows.map((row) => {
    const groupKey = proofKey(row)
    const decision = decisionByGroup.get(groupKey)
    if (!decision) {
      return {
        ...row,
        review: { status: 'PENDING', decisionId: null, explanation: null },
      }
    }
    if (decision.action === 'APPROVE') {
      return {
        ...row,
        review: {
          status: 'APPROVED',
          decisionId: decision.id,
          explanation: decision.explanation ?? null,
        },
      }
    }

    const correctedPlatform = canonicalPlatform(decision.softwarePlatform)
    const correctedCompatibility = compatibilityFor(
      row.interpretation.rawEvidence,
      correctedPlatform,
      context,
    )
    const correctedInterpretation: ImporterV2FirmwareInterpretation = {
      ...row.interpretation,
      decisionId: 'manual-proof-group-correction',
      confidence: 'HIGH',
      runningVersion: normalizeText(decision.runningVersion),
      proposedSoftwarePlatform: correctedPlatform,
      platformEvidence: correctedPlatform ? 'RAW_SOURCE_PLATFORM' : 'NONE',
      explanation: decision.explanation,
      compatibility: correctedCompatibility,
      warnings: [
        ...row.interpretation.warnings.filter(
          (warning) => warning.code !== 'PLATFORM_INCOMPATIBLE',
        ),
        ...(correctedCompatibility.status === 'INCOMPATIBLE'
          ? [
              {
                code: 'PLATFORM_INCOMPATIBLE' as const,
                message: correctedCompatibility.explanation,
              },
            ]
          : []),
      ],
      requiresConfirmation: true,
    }
    return {
      ...row,
      interpretation: correctedInterpretation,
      review: {
        status: 'CORRECTED',
        decisionId: decision.id,
        explanation: decision.explanation,
      },
    }
  })
}

export function buildImporterV2FirmwarePublicationProposals(
  rows: readonly ImporterV2ReviewedFirmwareRow[],
): ImporterV2FirmwarePublicationProposal[] {
  return rows.flatMap((row) => {
    if (row.review.status === 'PENDING') return []
    return [
      {
        rowNumber: row.rowNumber,
        rowFingerprint: row.rowFingerprint,
        observedRunningVersion: row.interpretation.runningVersion,
        proposedSoftwarePlatform: row.interpretation.proposedSoftwarePlatform,
        canonicalReleaseId: null,
        canonicalPlatformId: null,
        observedReleaseState: 'OBSERVED_AVAILABLE' as const,
        proofDecisionId: row.review.decisionId,
      },
    ]
  })
}
