import { describe, expect, it } from 'vitest'
import {
  evaluateFirmwareCompatibility,
  resolveCompatibleFirmwareImage,
  type FirmwareCompatibilityOverride,
  type FirmwareCompatibilityRelease,
  type FirmwareCompatibilityRule,
} from '@/lib/firmware-compatibility'

const model = { id: 'model-1', vendorId: 'vendor-1', familyId: 'family-1', model: 'AP-515' }

function release(overrides: Partial<FirmwareCompatibilityRelease> = {}): FirmwareCompatibilityRelease {
  return {
    id: 'release-ya',
    vendorId: 'vendor-1',
    platform: 'AOS-S',
    firmwareTrainId: 'train-16.11',
    logicalVersion: '16.11.0014',
    version: 'YA.16.11.0014',
    imageCode: 'YA',
    variant: null,
    isActive: true,
    ...overrides,
  }
}

function rule(overrides: Partial<FirmwareCompatibilityRule> = {}): FirmwareCompatibilityRule {
  return {
    id: 'rule-family-platform',
    vendorId: 'vendor-1',
    deviceModelFamilyId: 'family-1',
    deviceModelId: null,
    platform: 'AOS-S',
    firmwareTrainId: null,
    logicalVersion: null,
    firmwareReleaseId: null,
    imageCode: null,
    decision: 'ALLOW',
    sourceType: 'CATALOG',
    explanation: 'Family supports AOS-S.',
    isActive: true,
    validFrom: null,
    validUntil: null,
    ...overrides,
  }
}

function override(overrides: Partial<FirmwareCompatibilityOverride> = {}): FirmwareCompatibilityOverride {
  return {
    id: 'override-1',
    deviceModelId: 'model-1',
    firmwareReleaseId: 'release-ya',
    decision: 'ALLOW',
    reason: 'Vendor bulletin confirms support.',
    version: 1,
    isActive: true,
    createdAt: new Date('2026-09-04T10:00:00Z'),
    createdByUserId: 'user-1',
    ...overrides,
  }
}

describe('generic firmware compatibility evaluator', () => {
  it('inherits broad family platform compatibility', () => {
    const result = evaluateFirmwareCompatibility({ model, release: release(), rules: [rule()] })
    expect(result).toMatchObject({
      status: 'COMPATIBLE',
      provenance: { kind: 'FAMILY_RULE', inherited: true, sourceType: 'CATALOG' },
    })
  })

  it('lets a concrete model rule refine/restrict a family allow', () => {
    const result = evaluateFirmwareCompatibility({
      model,
      release: release(),
      rules: [
        rule(),
        rule({
          id: 'rule-model-deny',
          deviceModelFamilyId: null,
          deviceModelId: 'model-1',
          decision: 'DENY',
          explanation: 'This concrete model is excluded.',
        }),
      ],
    })
    expect(result).toMatchObject({ status: 'INCOMPATIBLE', provenance: { kind: 'MODEL_RULE', id: 'rule-model-deny' } })
  })

  it('prefers a more specific target rule within the same subject scope', () => {
    const result = evaluateFirmwareCompatibility({
      model,
      release: release(),
      rules: [
        rule({ id: 'family-platform-deny', decision: 'DENY' }),
        rule({
          id: 'family-image-allow',
          imageCode: 'YA',
          decision: 'ALLOW',
          explanation: 'YA is explicitly supported.',
        }),
      ],
    })
    expect(result).toMatchObject({ status: 'COMPATIBLE', provenance: { id: 'family-image-allow' } })
  })

  it('uses deny when equally specific rules conflict', () => {
    const result = evaluateFirmwareCompatibility({
      model,
      release: release(),
      rules: [
        rule({ id: 'allow-ya', imageCode: 'YA', decision: 'ALLOW' }),
        rule({ id: 'deny-ya', imageCode: 'YA', decision: 'DENY' }),
      ],
    })
    expect(result).toMatchObject({ status: 'INCOMPATIBLE', provenance: { id: 'deny-ya' } })
    expect(result.matchedRuleIds).toEqual(['allow-ya', 'deny-ya'])
  })

  it('returns UNKNOWN when no evidence matches instead of inferring compatibility', () => {
    const result = evaluateFirmwareCompatibility({ model, release: release({ platform: 'AOS-10' }), rules: [rule()] })
    expect(result).toMatchObject({ status: 'UNKNOWN', decision: null, provenance: { kind: 'NO_EVIDENCE' } })
  })

  it('allows one model to support multiple software platforms through data only', () => {
    const aos8 = evaluateFirmwareCompatibility({ model, release: release({ platform: 'AOS-8' }), rules: [rule({ id: 'aos8', platform: 'AOS-8' }), rule({ id: 'aos10', platform: 'AOS-10' })] })
    const aos10 = evaluateFirmwareCompatibility({ model, release: release({ platform: 'AOS-10' }), rules: [rule({ id: 'aos8', platform: 'AOS-8' }), rule({ id: 'aos10', platform: 'AOS-10' })] })
    expect(aos8.status).toBe('COMPATIBLE')
    expect(aos10.status).toBe('COMPATIBLE')
  })

  it('manual override wins over model and family rules and remains explicit in provenance', () => {
    const result = evaluateFirmwareCompatibility({
      model,
      release: release(),
      rules: [rule({ decision: 'DENY' })],
      overrides: [override()],
    })
    expect(result).toMatchObject({
      status: 'COMPATIBLE',
      provenance: { kind: 'MANUAL_OVERRIDE', sourceType: 'MANUAL_OVERRIDE', id: 'override-1' },
    })
  })

  it('rejects cross-vendor firmware without consulting vendor-specific code', () => {
    const result = evaluateFirmwareCompatibility({ model, release: release({ vendorId: 'vendor-2' }), rules: [] })
    expect(result).toMatchObject({ status: 'INCOMPATIBLE', provenance: { kind: 'VENDOR_MISMATCH' } })
  })
})

describe('automatic exact image/variant resolution', () => {
  const ya = release()
  const yb = release({ id: 'release-yb', version: 'YB.16.11.0014', imageCode: 'YB' })

  it('resolves the only compatible exact image for a logical release', () => {
    const result = resolveCompatibleFirmwareImage({
      model,
      logicalTarget: ya,
      candidateReleases: [ya, yb],
      rules: [
        rule({ id: 'allow-ya', deviceModelFamilyId: null, deviceModelId: 'model-1', imageCode: 'YA' }),
        rule({ id: 'deny-yb', deviceModelFamilyId: null, deviceModelId: 'model-1', imageCode: 'YB', decision: 'DENY' }),
      ],
    })
    expect(result).toMatchObject({ status: 'RESOLVED', release: { id: 'release-ya', imageCode: 'YA' } })
  })

  it('returns AMBIGUOUS instead of guessing when multiple exact images are compatible', () => {
    const result = resolveCompatibleFirmwareImage({
      model,
      logicalTarget: ya,
      candidateReleases: [ya, yb],
      rules: [rule()],
    })
    expect(result.status).toBe('AMBIGUOUS')
    expect(result.compatibleCandidates.map((candidate) => candidate.id)).toEqual(['release-ya', 'release-yb'])
  })

  it('returns UNKNOWN when candidate images exist but compatibility evidence is absent', () => {
    const result = resolveCompatibleFirmwareImage({ model, logicalTarget: ya, candidateReleases: [ya, yb], rules: [] })
    expect(result.status).toBe('UNKNOWN')
    expect(result.unknownCandidates).toHaveLength(2)
  })

  it('returns INCOMPATIBLE when every canonical candidate is denied', () => {
    const result = resolveCompatibleFirmwareImage({
      model,
      logicalTarget: ya,
      candidateReleases: [ya, yb],
      rules: [rule({ decision: 'DENY' })],
    })
    expect(result.status).toBe('INCOMPATIBLE')
    expect(result.incompatibleCandidates).toHaveLength(2)
  })
})
