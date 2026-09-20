import { describe, expect, it } from 'vitest'
import {
  catalogSemanticsFromReleaseDecision,
  evaluateReleaseAgainstTrain,
  releaseDecisionFromCatalogSemantics,
  resolveCatalogTrainForModel,
  type TrainPolicyRelease,
} from '@/lib/firmware-catalog-defaults'

function release(id: string, version: string, decision: TrainPolicyRelease['decision'] = 'ALLOWED'): TrainPolicyRelease {
  return { id, version, decision, isActive: true }
}

describe('firmware catalog release decisions', () => {
  it('maps observed/allowed/blocked/withdrawn without a preferred release status', () => {
    expect(releaseDecisionFromCatalogSemantics({ catalogState: 'OBSERVED', policyEligibility: 'NOT_EVALUATED' })).toBe('NEEDS_REVIEW')
    expect(releaseDecisionFromCatalogSemantics({ catalogState: 'VERIFIED', policyEligibility: 'ALLOWED' })).toBe('ALLOWED')
    expect(releaseDecisionFromCatalogSemantics({ catalogState: 'VERIFIED', policyEligibility: 'PREFERRED' })).toBe('ALLOWED')
    expect(releaseDecisionFromCatalogSemantics({ catalogState: 'VERIFIED', policyEligibility: 'DISALLOWED' })).toBe('BLOCKED')
    expect(catalogSemanticsFromReleaseDecision('BLOCKED')).toEqual({ catalogState: 'BLOCKED', policyEligibility: 'DISALLOWED' })
  })

  it('applies minimum and preferred independently', () => {
    const preferred = release('p', '17.15.5')
    const minimum = release('m', '17.15.4')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: preferred, preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('PREFERRED')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: minimum, preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('ACCEPTABLE')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: release('old', '17.15.3'), preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('BELOW_MINIMUM')
  })

  it('makes the preferred release the only acceptable release when minimum is absent', () => {
    const preferred = release('p', '17.15.5')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: release('newer', '17.15.6'), preferredRelease: preferred, minimumAcceptableRelease: null })).toMatchObject({
      position: 'OUTSIDE_ACCEPTABLE',
      acceptable: false,
      updateRequired: true,
    })
  })

  it('lets review/blocked/withdrawn decisions override minimum ordering', () => {
    const preferred = release('p', '17.15.5')
    const minimum = release('m', '17.15.4')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: release('review', '17.15.6', 'NEEDS_REVIEW'), preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('REVIEW_REQUIRED')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: release('blocked', '17.15.6', 'BLOCKED'), preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('NOT_ALLOWED')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'CISCO', platform: 'IOS XE', release: release('withdrawn', '17.15.6', 'WITHDRAWN'), preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('NOT_ALLOWED')
  })

  it('returns not comparable rather than guessing unsupported vendor syntax', () => {
    const preferred = release('p', 'gold')
    const minimum = release('m', 'silver')
    expect(evaluateReleaseAgainstTrain({ vendorKey: 'ACME', platform: 'OpaqueOS', release: release('r', 'bronze'), preferredRelease: preferred, minimumAcceptableRelease: minimum }).position).toBe('NOT_COMPARABLE')
  })
})

describe('platform preferred-train fallback', () => {
  const preferredRelease = release('17.15.5', '17.15.5')
  const acceptedRelease = release('17.12.5', '17.12.5')

  it('inherits the platform preferred train when compatible', () => {
    const result = resolveCatalogTrainForModel({
      vendorKey: 'CISCO',
      platform: 'IOS XE',
      trains: [{ id: '17.15', name: '17.15', state: 'PREFERRED', preferredRelease, compatibility: 'COMPATIBLE', compatibilityExplanation: 'Inherited platform support.' }],
    })
    expect(result).toMatchObject({ status: 'RESOLVED', source: 'PLATFORM_PREFERRED', train: { id: '17.15' } })
  })

  it('falls back to the newest known-compatible accepted train after explicit incompatibility', () => {
    const result = resolveCatalogTrainForModel({
      vendorKey: 'CISCO',
      platform: 'IOS XE',
      trains: [
        { id: '17.15', name: '17.15', state: 'PREFERRED', preferredRelease, compatibility: 'INCOMPATIBLE', compatibilityExplanation: 'Denied by family compatibility rule.' },
        { id: '17.9', name: '17.9', state: 'ACCEPTED', preferredRelease: release('17.9.5', '17.9.5'), compatibility: 'COMPATIBLE', compatibilityExplanation: 'Allowed.' },
        { id: '17.12', name: '17.12', state: 'ACCEPTED', preferredRelease: acceptedRelease, compatibility: 'COMPATIBLE', compatibilityExplanation: 'Allowed.' },
      ],
    })
    expect(result).toMatchObject({ status: 'RESOLVED', source: 'ACCEPTED_FALLBACK', train: { id: '17.12' } })
  })

  it('honors an explicit compatible model-family train override', () => {
    const result = resolveCatalogTrainForModel({
      vendorKey: 'CISCO',
      platform: 'IOS XE',
      explicitOverrideTrainId: '17.9',
      trains: [
        { id: '17.15', name: '17.15', state: 'PREFERRED', preferredRelease, compatibility: 'COMPATIBLE', compatibilityExplanation: 'Allowed.' },
        { id: '17.9', name: '17.9', state: 'ACCEPTED', preferredRelease: release('17.9.5', '17.9.5'), compatibility: 'COMPATIBLE', compatibilityExplanation: 'Override.' },
      ],
    })
    expect(result).toMatchObject({ status: 'RESOLVED', source: 'EXPLICIT_OVERRIDE', train: { id: '17.9' } })
  })

  it('does not inherit or fall back through a train whose preferred release is not Allowed', () => {
    const result = resolveCatalogTrainForModel({
      vendorKey: 'CISCO',
      platform: 'IOS XE',
      trains: [
        {
          id: '17.15',
          name: '17.15',
          state: 'PREFERRED',
          preferredRelease: release('review', '17.15.6', 'NEEDS_REVIEW'),
          compatibility: 'COMPATIBLE',
          compatibilityExplanation: 'Compatible image.',
        },
        {
          id: '17.12',
          name: '17.12',
          state: 'ACCEPTED',
          preferredRelease: acceptedRelease,
          compatibility: 'COMPATIBLE',
          compatibilityExplanation: 'Allowed.',
        },
      ],
    })
    expect(result).toMatchObject({
      status: 'REVIEW_REQUIRED',
      train: null,
    })
  })

    it('does not invent a fallback when preferred compatibility is unknown', () => {
    const result = resolveCatalogTrainForModel({
      vendorKey: 'CISCO',
      platform: 'IOS XE',
      trains: [
        { id: '17.15', name: '17.15', state: 'PREFERRED', preferredRelease, compatibility: 'UNKNOWN', compatibilityExplanation: 'No safe evidence.' },
        { id: '17.12', name: '17.12', state: 'ACCEPTED', preferredRelease: acceptedRelease, compatibility: 'COMPATIBLE', compatibilityExplanation: 'Allowed.' },
      ],
    })
    expect(result.status).toBe('REVIEW_REQUIRED')
  })

  it('reports no compatible fallback when preferred is incompatible and none is known compatible', () => {
    const result = resolveCatalogTrainForModel({
      vendorKey: 'CISCO',
      platform: 'IOS XE',
      trains: [
        { id: '17.15', name: '17.15', state: 'PREFERRED', preferredRelease, compatibility: 'INCOMPATIBLE', compatibilityExplanation: 'Denied.' },
        { id: '17.12', name: '17.12', state: 'ACCEPTED', preferredRelease: acceptedRelease, compatibility: 'INCOMPATIBLE', compatibilityExplanation: 'Denied.' },
      ],
    })
    expect(result.status).toBe('NO_COMPATIBLE_TRAIN')
  })
})
