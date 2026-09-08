import { describe, expect, it } from 'vitest'
import {
  firmwareComplianceLabel,
  resolveFirmwareCompliance,
} from './firmware-compliance'
import { input, policy, release } from './test-fixtures/firmware-compliance'
import { resolveLatestApprovedInTrain } from './firmware-policies'

describe('central firmware compliance', () => {
  it.each([
    ['17.9.4', 'BELOW_MINIMUM', 'BELOW_MINIMUM', 'UPDATE_REQUIRED'],
    ['17.12.5', 'ACCEPTED', 'AT_MINIMUM', 'UPDATE_RECOMMENDED'],
    ['17.12.6', 'ACCEPTED', 'BELOW_PREFERRED', 'UPDATE_RECOMMENDED'],
    ['17.15.5', 'PREFERRED', 'AT_PREFERRED', 'NO_ACTION'],
    ['17.15.6', 'ACCEPTED', 'ABOVE_PREFERRED', 'NO_ACTION'],
  ])(
    'MINIMUM %s -> %s, %s, %s',
    (version, compliance, relationToPreferred, recommendation) => {
      expect(resolveFirmwareCompliance(input(version))).toMatchObject({
        compliance,
        relationToPreferred,
        recommendation,
      })
    },
  )
  it.each([
    ['17.9.4', true, true, 'BELOW_MINIMUM'],
    ['17.12.5', true, true, 'ACCEPTED'],
    ['17.12.5', false, true, 'BELOW_MINIMUM'],
    ['17.12.6', false, true, 'ACCEPTED'],
    ['17.15.5', true, true, 'PREFERRED'],
    ['17.15.6', true, true, 'ACCEPTED'],
    ['17.15.6', true, false, 'OUTSIDE_RANGE'],
    ['17.16.1', true, true, 'OUTSIDE_RANGE'],
  ])(
    'RANGE %s inclusive %s/%s -> %s',
    (version, minimumInclusive, maximumInclusive, compliance) => {
      const value = input(version)
      value.effectivePolicy.policy = policy({
        policyMode: 'RANGE',
        maximumFirmwareReleaseId: '17.15.6',
        minimumInclusive,
        maximumInclusive,
      })
      value.maximum = release('17.15.6')
      expect(resolveFirmwareCompliance(value).compliance).toBe(compliance)
    },
  )
  it.each(['EXACT', 'LATEST_APPROVED_IN_TRAIN'] as const)(
    '%s accepts only the effective target',
    (policyMode) => {
      for (const [version, expected] of [
        ['17.15.5', 'PREFERRED'],
        ['17.12.6', 'OUTSIDE_RANGE'],
        ['17.16.1', 'OUTSIDE_RANGE'],
      ]) {
        const value = input(version)
        value.effectivePolicy.policy = policy({
          policyMode,
          minimumFirmwareReleaseId: null,
        })
        value.minimum = null
        expect(resolveFirmwareCompliance(value).compliance).toBe(expected)
      }
    },
  )
  it.each(['BLOCKED', 'WITHDRAWN'])(
    '%s current wins over preferred, no policy and compatibility',
    (catalogState) => {
      const value = input('17.15.5', {
        currentFirmware: release('17.15.5', { catalogState }),
      })
      expect(resolveFirmwareCompliance(value)).toMatchObject({
        compliance: 'BLOCKED_RELEASE',
        recommendation: 'REVIEW_REQUIRED',
      })
      value.effectivePolicy.policy = null
      value.currentCompatibility!.status = 'INCOMPATIBLE'
      expect(resolveFirmwareCompliance(value).compliance).toBe(
        'BLOCKED_RELEASE',
      )
    },
  )
  it('preserves raw observations without inventing canonical identity', () => {
    expect(
      resolveFirmwareCompliance(
        input('', { currentFirmware: null, rawVersion: 'raw-opaque' }),
      ),
    ).toMatchObject({
      compliance: 'UNKNOWN_FIRMWARE',
      rawVersion: 'raw-opaque',
      recommendation: 'REVIEW_REQUIRED',
    })
  })
  it('exposes the policy resolver reason', () => {
    expect(
      resolveFirmwareCompliance(
        input('17.15.5', {
          effectivePolicy: {
            status: 'UNRESOLVED',
            policy: null,
            source: null,
            unresolvedReason: 'AMBIGUOUS_DEFAULT_TRACK',
          },
        }),
      ),
    ).toMatchObject({
      compliance: 'NO_POLICY',
      explanation: expect.stringContaining('AMBIGUOUS_DEFAULT_TRACK'),
    })
  })
  it('never orders opaque firmware', () => {
    expect(resolveFirmwareCompliance(input('opaque-release')).compliance).toBe(
      'NOT_COMPARABLE',
    )
  })
  it('does not conflate current incompatibility with target incompatibility', () => {
    const value = input()
    value.currentCompatibility!.status = 'INCOMPATIBLE'
    expect(resolveFirmwareCompliance(value).compliance).toBe('INCOMPATIBLE')
    value.currentCompatibility!.status = 'COMPATIBLE'
    value.targetCompatibility!.status = 'INCOMPATIBLE'
    expect(resolveFirmwareCompliance(value)).toMatchObject({
      compliance: 'COMPATIBILITY_UNRESOLVED',
      recommendation: 'REVIEW_REQUIRED',
    })
  })
  it.each(['UNKNOWN', 'AMBIGUOUS', 'INCOMPATIBLE'] as const)(
    'target %s requires review even at preferred',
    (status) => {
      const value = input()
      value.targetCompatibility!.status = status
      value.resolvedTarget = null
      expect(resolveFirmwareCompliance(value)).toMatchObject({
        compliance: 'COMPATIBILITY_UNRESOLVED',
        recommendation: 'REVIEW_REQUIRED',
      })
    },
  )
  it('unknown current compatibility cannot imply compliance', () => {
    const value = input()
    value.currentCompatibility!.status = 'UNKNOWN'
    expect(resolveFirmwareCompliance(value).compliance).toBe(
      'COMPATIBILITY_UNRESOLVED',
    )
  })
  it.each(['BLOCKED', 'WITHDRAWN', 'VERIFIED'])(
    'rejects unsafe/ineligible preferred targets: %s',
    (catalogState) => {
      const value = input()
      value.preferredTarget = release('17.15.5', {
        catalogState,
        policyEligibility: 'DISALLOWED',
      })
      expect(resolveFirmwareCompliance(value).compliance).toBe(
        'TARGET_UNRESOLVED',
      )
    },
  )
  it.each(['RESOLVED', 'UNKNOWN', 'AMBIGUOUS', 'INCOMPATIBLE'] as const)(
    'AOS-8 → AOS-10 target %s',
    (status) => {
      const target = release('10.7.0', { platform: 'AOS-10' })
      const value = input('8.10.0', {
        currentFirmware: release('8.10.0', { platform: 'AOS-8' }),
        preferredTarget: target,
        resolvedTarget: status === 'RESOLVED' ? target : null,
      })
      value.targetCompatibility!.status = status
      value.effectivePolicy.policy = policy({
        desiredPlatform: 'AOS-10',
        policyMode: 'EXACT',
        targetFirmwareReleaseId: target.id,
        minimumFirmwareReleaseId: null,
      })
      expect(resolveFirmwareCompliance(value).recommendation).toBe(
        status === 'RESOLVED' ? 'PLATFORM_MIGRATION' : 'REVIEW_REQUIRED',
      )
    },
  )
  it.each([
    ['EXACT_ONLY', 'VERIFIED', 'NOT_COMPARABLE'],
    ['ANY_VERIFIED_VARIANT', 'VERIFIED', 'PREFERRED'],
    ['ANY_VERIFIED_VARIANT', 'OBSERVED', 'NOT_COMPARABLE'],
    ['ANY_NON_BLOCKED_VARIANT', 'OBSERVED', 'PREFERRED'],
    ['ANY_NON_BLOCKED_VARIANT', 'BLOCKED', 'BLOCKED_RELEASE'],
  ])('variant %s / %s -> %s', (variantEquivalence, catalogState, expected) => {
    const preferred = release('15.2(7)E17', {
      platform: 'IOS',
      variantEquivalence,
    })
    const current = release('15.2(7)E17a', {
      platform: 'IOS',
      logicalVersion: '15.2(7)E17',
      variant: 'a',
      catalogState,
    })
    const value = input('', {
      currentFirmware: current,
      preferredTarget: preferred,
      resolvedTarget: preferred,
      minimum: null,
    })
    value.effectivePolicy.policy = policy({
      policyMode: 'EXACT',
      minimumFirmwareReleaseId: null,
    })
    expect(resolveFirmwareCompliance(value).compliance).toBe(expected)
  })
  it('exact rebuild and compatible image equivalence retain their catalog identity', () => {
    const preferred = release('WC.16.11.0020', {
      logicalVersion: '16.11.0020',
      imageCode: 'WC',
    })
    const current = release('YA.16.11.0020', {
      logicalVersion: '16.11.0020',
      imageCode: 'YA',
    })
    const value = input('', {
      currentFirmware: current,
      preferredTarget: preferred,
      resolvedTarget: current,
      minimum: null,
    })
    value.effectivePolicy.policy = policy({
      policyMode: 'EXACT',
      minimumFirmwareReleaseId: null,
    })
    expect(resolveFirmwareCompliance(value)).toMatchObject({
      compliance: 'PREFERRED',
      resolvedTarget: { imageCode: 'YA' },
    })
  })
  it('does not allow compatibility to authorize an unpermitted rebuild', () => {
    const value = input()
    value.resolvedTarget = release('17.15.5a', {
      logicalVersion: '17.15.5',
      variant: 'a',
    })
    expect(resolveFirmwareCompliance(value).compliance).toBe(
      'TARGET_UNRESOLVED',
    )
  })
  it('newer accepted firmware has explicit UI language', () => {
    expect(
      firmwareComplianceLabel(resolveFirmwareCompliance(input('17.15.6'))),
    ).toBe('Accepted — newer than preferred')
  })
})

describe('policy moving target', () => {
  it('ignores observed, imported, verified but unevaluated, blocked and withdrawn newer releases', () => {
    const releases = [
      release('17.12.5'),
      release('17.15.5'),
      release('17.16.1', {
        catalogState: 'OBSERVED',
        policyEligibility: 'NOT_EVALUATED',
      }),
      release('17.16.2', { policyEligibility: 'NOT_EVALUATED' }),
      release('17.17.1', { catalogState: 'BLOCKED' }),
      release('17.18.1', { catalogState: 'WITHDRAWN' }),
    ]
    expect(
      resolveLatestApprovedInTrain(releases, 'train', 'IOS XE').release?.id,
    ).toBe('17.15.5')
  })
  it('returns no target for empty or non-comparable eligible catalog', () => {
    expect(
      resolveLatestApprovedInTrain([], 'train', 'IOS XE').release,
    ).toBeNull()
    expect(
      resolveLatestApprovedInTrain(
        [release('opaque'), release()],
        'train',
        'IOS XE',
      ).release,
    ).toBeNull()
  })
})

it('exact rebuild identity is preferred without granting other rebuilds equivalence', () => {
  const rebuild = release('15.2(7)E17a', {
    platform: 'IOS',
    logicalVersion: '15.2(7)E17',
    variant: 'a',
  })
  const value = input('', {
    currentFirmware: rebuild,
    preferredTarget: rebuild,
    resolvedTarget: rebuild,
    minimum: null,
  })
  value.effectivePolicy.policy = policy({
    policyMode: 'EXACT',
    minimumFirmwareReleaseId: null,
  })
  expect(resolveFirmwareCompliance(value).compliance).toBe('PREFERRED')
})

it('an excluded boundary wins even when it is also the preferred version', () => {
  const value = input()
  value.effectivePolicy.policy = policy({
    policyMode: 'RANGE',
    maximumFirmwareReleaseId: '17.15.5',
    maximumInclusive: false,
  })
  value.maximum = release()
  expect(resolveFirmwareCompliance(value).compliance).toBe('OUTSIDE_RANGE')
})

it('current compatibility review never displays a resolved target as an unresolved current check', () => {
  const value = input()
  value.currentCompatibility!.status = 'UNKNOWN'
  expect(firmwareComplianceLabel(resolveFirmwareCompliance(value))).toBe(
    'Current compatibility requires review',
  )
})
