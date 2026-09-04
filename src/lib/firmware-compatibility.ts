export const FIRMWARE_COMPATIBILITY_DECISIONS = ['ALLOW', 'DENY'] as const
export type FirmwareCompatibilityDecision = (typeof FIRMWARE_COMPATIBILITY_DECISIONS)[number]

export const FIRMWARE_COMPATIBILITY_SOURCE_TYPES = ['CATALOG', 'CONFIGURED_RULE'] as const
export type FirmwareCompatibilitySourceType = (typeof FIRMWARE_COMPATIBILITY_SOURCE_TYPES)[number]

export type FirmwareCompatibilityModel = {
  id: string
  vendorId: string
  familyId: string | null
  model?: string
}

export type FirmwareCompatibilityRelease = {
  id: string
  vendorId: string
  platform: string
  firmwareTrainId: string | null
  logicalVersion: string
  version: string
  imageCode: string | null
  variant: string | null
  isActive?: boolean
}

export type FirmwareCompatibilityRule = {
  id: string
  vendorId: string
  deviceModelFamilyId: string | null
  deviceModelId: string | null
  platform: string
  firmwareTrainId: string | null
  logicalVersion: string | null
  firmwareReleaseId: string | null
  imageCode: string | null
  decision: FirmwareCompatibilityDecision
  sourceType: FirmwareCompatibilitySourceType
  explanation: string
  isActive: boolean
  validFrom: Date | null
  validUntil: Date | null
}

export type FirmwareCompatibilityOverride = {
  id: string
  deviceModelId: string
  firmwareReleaseId: string
  decision: FirmwareCompatibilityDecision
  reason: string
  version: number
  isActive: boolean
  createdAt: Date
  createdByUserId?: string | null
}

export type FirmwareCompatibilityProvenance = {
  kind: 'MANUAL_OVERRIDE' | 'MODEL_RULE' | 'FAMILY_RULE' | 'VENDOR_MISMATCH' | 'NO_EVIDENCE'
  id: string | null
  sourceType: FirmwareCompatibilitySourceType | 'MANUAL_OVERRIDE' | 'SYSTEM'
  explanation: string
  inherited: boolean
}

export type FirmwareCompatibilityResult = {
  status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN'
  decision: FirmwareCompatibilityDecision | null
  provenance: FirmwareCompatibilityProvenance
  matchedRuleIds: string[]
}

export type FirmwareImageResolution = {
  status: 'RESOLVED' | 'AMBIGUOUS' | 'INCOMPATIBLE' | 'UNKNOWN'
  release: FirmwareCompatibilityRelease | null
  compatibleCandidates: FirmwareCompatibilityRelease[]
  unknownCandidates: FirmwareCompatibilityRelease[]
  incompatibleCandidates: FirmwareCompatibilityRelease[]
  explanation: string
}

function normalize(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function ruleActiveAt(rule: FirmwareCompatibilityRule, at: Date) {
  if (!rule.isActive) return false
  if (rule.validFrom && rule.validFrom.getTime() > at.getTime()) return false
  if (rule.validUntil && rule.validUntil.getTime() <= at.getTime()) return false
  return true
}

function ruleMatchesTarget(rule: FirmwareCompatibilityRule, release: FirmwareCompatibilityRelease) {
  if (rule.vendorId !== release.vendorId) return false
  if (normalize(rule.platform) !== normalize(release.platform)) return false
  if (rule.firmwareTrainId && rule.firmwareTrainId !== release.firmwareTrainId) return false
  if (rule.logicalVersion && normalize(rule.logicalVersion) !== normalize(release.logicalVersion)) return false
  if (rule.firmwareReleaseId && rule.firmwareReleaseId !== release.id) return false
  if (rule.imageCode && normalize(rule.imageCode) !== normalize(release.imageCode)) return false
  return true
}

function targetSpecificity(rule: FirmwareCompatibilityRule) {
  let score = 1 // platform is always explicit
  if (rule.firmwareTrainId) score += 10
  if (rule.logicalVersion) score += 20
  if (rule.imageCode) score += 30
  if (rule.firmwareReleaseId) score += 40
  return score
}

function newestOverride(overrides: FirmwareCompatibilityOverride[]) {
  return [...overrides].sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version
    const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime()
    if (byCreatedAt !== 0) return byCreatedAt
    return b.id.localeCompare(a.id)
  })[0] ?? null
}

export function evaluateFirmwareCompatibility(input: {
  model: FirmwareCompatibilityModel
  release: FirmwareCompatibilityRelease
  rules: FirmwareCompatibilityRule[]
  overrides?: FirmwareCompatibilityOverride[]
  at?: Date
}): FirmwareCompatibilityResult {
  const { model, release, rules } = input
  const at = input.at ?? new Date()

  if (model.vendorId !== release.vendorId) {
    return {
      status: 'INCOMPATIBLE',
      decision: 'DENY',
      provenance: {
        kind: 'VENDOR_MISMATCH',
        id: null,
        sourceType: 'SYSTEM',
        explanation: 'Firmware and device model belong to different vendors.',
        inherited: false,
      },
      matchedRuleIds: [],
    }
  }

  const activeOverrides = (input.overrides ?? []).filter(
    (override) => override.isActive && override.deviceModelId === model.id && override.firmwareReleaseId === release.id,
  )
  const override = newestOverride(activeOverrides)
  if (override) {
    return {
      status: override.decision === 'ALLOW' ? 'COMPATIBLE' : 'INCOMPATIBLE',
      decision: override.decision,
      provenance: {
        kind: 'MANUAL_OVERRIDE',
        id: override.id,
        sourceType: 'MANUAL_OVERRIDE',
        explanation: override.reason,
        inherited: false,
      },
      matchedRuleIds: [],
    }
  }

  const candidates = rules
    .filter((rule) => ruleActiveAt(rule, at))
    .filter((rule) => rule.deviceModelId === model.id || (!!model.familyId && rule.deviceModelFamilyId === model.familyId))
    .filter((rule) => ruleMatchesTarget(rule, release))
    .map((rule) => ({
      rule,
      subjectSpecificity: rule.deviceModelId === model.id ? 1 : 0,
      targetSpecificity: targetSpecificity(rule),
    }))

  if (candidates.length === 0) {
    return {
      status: 'UNKNOWN',
      decision: null,
      provenance: {
        kind: 'NO_EVIDENCE',
        id: null,
        sourceType: 'SYSTEM',
        explanation: 'No compatibility rule or manual override matches this model and release.',
        inherited: false,
      },
      matchedRuleIds: [],
    }
  }

  const bestSubject = Math.max(...candidates.map((candidate) => candidate.subjectSpecificity))
  const subjectCandidates = candidates.filter((candidate) => candidate.subjectSpecificity === bestSubject)
  const bestTarget = Math.max(...subjectCandidates.map((candidate) => candidate.targetSpecificity))
  const best = subjectCandidates.filter((candidate) => candidate.targetSpecificity === bestTarget)
  const selected = best.find((candidate) => candidate.rule.decision === 'DENY') ?? best
    .slice()
    .sort((a, b) => a.rule.id.localeCompare(b.rule.id))[0]
  const rule = selected.rule
  const modelRule = rule.deviceModelId === model.id

  return {
    status: rule.decision === 'ALLOW' ? 'COMPATIBLE' : 'INCOMPATIBLE',
    decision: rule.decision,
    provenance: {
      kind: modelRule ? 'MODEL_RULE' : 'FAMILY_RULE',
      id: rule.id,
      sourceType: rule.sourceType,
      explanation: rule.explanation,
      inherited: !modelRule,
    },
    matchedRuleIds: best.map((candidate) => candidate.rule.id).sort(),
  }
}

export function resolveCompatibleFirmwareImage(input: {
  model: FirmwareCompatibilityModel
  logicalTarget: FirmwareCompatibilityRelease
  candidateReleases: FirmwareCompatibilityRelease[]
  rules: FirmwareCompatibilityRule[]
  overrides?: FirmwareCompatibilityOverride[]
  at?: Date
}): FirmwareImageResolution {
  const { logicalTarget } = input
  const candidates = input.candidateReleases
    .filter((release) => release.isActive !== false)
    .filter((release) => release.vendorId === logicalTarget.vendorId)
    .filter((release) => normalize(release.platform) === normalize(logicalTarget.platform))
    .filter((release) => normalize(release.logicalVersion) === normalize(logicalTarget.logicalVersion))
    .filter((release) => !logicalTarget.firmwareTrainId || release.firmwareTrainId === logicalTarget.firmwareTrainId)
    .sort((a, b) => a.version.localeCompare(b.version, 'en', { numeric: true }))

  const compatibleCandidates: FirmwareCompatibilityRelease[] = []
  const unknownCandidates: FirmwareCompatibilityRelease[] = []
  const incompatibleCandidates: FirmwareCompatibilityRelease[] = []

  for (const release of candidates) {
    const result = evaluateFirmwareCompatibility({
      model: input.model,
      release,
      rules: input.rules,
      overrides: input.overrides,
      at: input.at,
    })
    if (result.status === 'COMPATIBLE') compatibleCandidates.push(release)
    else if (result.status === 'UNKNOWN') unknownCandidates.push(release)
    else incompatibleCandidates.push(release)
  }

  if (compatibleCandidates.length === 1) {
    return {
      status: 'RESOLVED',
      release: compatibleCandidates[0],
      compatibleCandidates,
      unknownCandidates,
      incompatibleCandidates,
      explanation: `Resolved one compatible exact release for logical version ${logicalTarget.logicalVersion}.`,
    }
  }
  if (compatibleCandidates.length > 1) {
    return {
      status: 'AMBIGUOUS',
      release: null,
      compatibleCandidates,
      unknownCandidates,
      incompatibleCandidates,
      explanation: `${compatibleCandidates.length} compatible exact releases match logical version ${logicalTarget.logicalVersion}; review is required.`,
    }
  }
  if (unknownCandidates.length > 0) {
    return {
      status: 'UNKNOWN',
      release: null,
      compatibleCandidates,
      unknownCandidates,
      incompatibleCandidates,
      explanation: `No compatible exact release is proven and ${unknownCandidates.length} candidate(s) have no compatibility evidence.`,
    }
  }
  return {
    status: 'INCOMPATIBLE',
    release: null,
    compatibleCandidates,
    unknownCandidates,
    incompatibleCandidates,
    explanation: candidates.length === 0
      ? `No canonical release candidates exist for logical version ${logicalTarget.logicalVersion}.`
      : `All canonical candidates for logical version ${logicalTarget.logicalVersion} are incompatible with this model.`,
  }
}
