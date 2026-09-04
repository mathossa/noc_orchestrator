import { describe, expect, it } from 'vitest'
import {
  resolveFirmwarePolicyAt,
  resolveFirmwarePolicyTimeline,
  validateFirmwarePolicyCandidate,
  type FirmwarePolicyCandidate,
  type FirmwarePolicyDeviceContext,
} from '@/lib/firmware-policies'

const context: FirmwarePolicyDeviceContext = {
  deviceId: 'device-1',
  customerId: 'customer-1',
  siteId: 'site-1',
  deviceModelId: 'model-1',
  deviceModelFamilyId: 'family-1',
}

function policy(overrides: Partial<FirmwarePolicyCandidate> = {}): FirmwarePolicyCandidate {
  return {
    id: 'policy-family-preferred-v1',
    isActive: true,
    policyMode: 'EXACT',
    trackKey: 'preferred',
    trackName: 'Preferred',
    trackClass: 'PREFERRED',
    isDefaultTrack: true,
    desiredPlatform: 'AOS-10',
    minimumFirmwareReleaseId: null,
    targetFirmwareReleaseId: 'fw-aos10',
    maximumFirmwareReleaseId: null,
    firmwareTrainId: null,
    minimumInclusive: true,
    maximumInclusive: true,
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    policyVersion: 1,
    deviceModelFamilyId: 'family-1',
    deviceModelId: null,
    customerId: null,
    siteId: null,
    deviceId: null,
    contractTypeId: null,
    vendorId: null,
    deviceTypeId: null,
    ...overrides,
  }
}

describe('firmware policy resolver', () => {
  it('inherits the family default when no more-specific policy exists', () => {
    const result = resolveFirmwarePolicyAt([policy()], context, new Date('2026-09-04T00:00:00Z'))
    expect(result).toMatchObject({
      status: 'RESOLVED',
      policy: { id: 'policy-family-preferred-v1', desiredPlatform: 'AOS-10' },
      source: { scope: 'FAMILY', subject: 'FAMILY', trackKey: 'preferred' },
    })
  })

  it('lets a concrete-model policy override the family baseline', () => {
    const modelPolicy = policy({
      id: 'policy-model',
      deviceModelFamilyId: null,
      deviceModelId: 'model-1',
      desiredPlatform: 'IOS-XE',
      targetFirmwareReleaseId: 'fw-model',
    })
    const result = resolveFirmwarePolicyAt([policy(), modelPolicy], context, new Date('2026-09-04T00:00:00Z'))
    expect(result).toMatchObject({ status: 'RESOLVED', policy: { id: 'policy-model' }, source: { scope: 'MODEL' } })
  })

  it('applies Device > Site > Customer > Model > Family precedence', () => {
    const candidates = [
      policy(),
      policy({ id: 'model', deviceModelFamilyId: null, deviceModelId: 'model-1', targetFirmwareReleaseId: 'fw-model' }),
      policy({ id: 'customer', customerId: 'customer-1', targetFirmwareReleaseId: 'fw-customer' }),
      policy({ id: 'site', siteId: 'site-1', targetFirmwareReleaseId: 'fw-site' }),
      policy({ id: 'device', deviceModelFamilyId: null, deviceId: 'device-1', targetFirmwareReleaseId: 'fw-device' }),
    ]

    expect(resolveFirmwarePolicyAt(candidates, context).policy?.id).toBe('device')
    expect(resolveFirmwarePolicyAt(candidates.filter((candidate) => candidate.id !== 'device'), context).policy?.id).toBe('site')
    expect(resolveFirmwarePolicyAt(candidates.filter((candidate) => !['device', 'site'].includes(candidate.id)), context).policy?.id).toBe('customer')
    expect(resolveFirmwarePolicyAt(candidates.filter((candidate) => !['device', 'site', 'customer'].includes(candidate.id)), context).policy?.id).toBe('model')
    expect(resolveFirmwarePolicyAt([policy()], context).policy?.id).toBe('policy-family-preferred-v1')
  })

  it('allows a customer to select an accepted legacy AOS-8 track over the family preferred AOS-10 track', () => {
    const familyPreferred = policy()
    const familyLegacy = policy({
      id: 'family-legacy',
      trackKey: 'legacy-aos8',
      trackName: 'Accepted legacy',
      trackClass: 'LEGACY',
      isDefaultTrack: false,
      desiredPlatform: 'AOS-8',
      targetFirmwareReleaseId: 'fw-aos8',
    })
    const customerLegacy = policy({
      id: 'customer-legacy',
      customerId: 'customer-1',
      trackKey: 'legacy-aos8',
      trackName: 'Accepted legacy',
      trackClass: 'LEGACY',
      isDefaultTrack: true,
      desiredPlatform: 'AOS-8',
      targetFirmwareReleaseId: 'fw-aos8',
    })

    const result = resolveFirmwarePolicyAt([familyPreferred, familyLegacy, customerLegacy], context)
    expect(result).toMatchObject({
      status: 'RESOLVED',
      policy: { id: 'customer-legacy', desiredPlatform: 'AOS-8' },
      source: { scope: 'CUSTOMER', trackKey: 'legacy-aos8', trackClass: 'LEGACY' },
    })
  })

  it('does not use the currently running platform to redefine the desired platform', () => {
    const result = resolveFirmwarePolicyAt([policy({ desiredPlatform: 'AOS-10' })], context)
    expect(result.policy?.desiredPlatform).toBe('AOS-10')
  })

  it('prefers a model-specific subject over a family subject inside the same customer scope', () => {
    const familyCustomer = policy({ id: 'customer-family', customerId: 'customer-1' })
    const modelCustomer = policy({
      id: 'customer-model',
      customerId: 'customer-1',
      deviceModelFamilyId: null,
      deviceModelId: 'model-1',
      targetFirmwareReleaseId: 'fw-model-customer',
    })
    expect(resolveFirmwarePolicyAt([familyCustomer, modelCustomer], context).policy?.id).toBe('customer-model')
  })

  it('keeps multiple simultaneous tracks but requires one default when more than one applies', () => {
    const preferred = policy({ isDefaultTrack: false })
    const legacy = policy({
      id: 'legacy',
      trackKey: 'legacy',
      trackName: 'Legacy',
      trackClass: 'LEGACY',
      isDefaultTrack: false,
      desiredPlatform: 'AOS-8',
      targetFirmwareReleaseId: 'fw-legacy',
    })
    expect(resolveFirmwarePolicyAt([preferred, legacy], context)).toMatchObject({
      status: 'UNRESOLVED',
      unresolvedReason: 'NO_DEFAULT_TRACK',
    })
  })

  it('rejects ambiguous multiple default tracks instead of guessing', () => {
    const legacy = policy({
      id: 'legacy',
      trackKey: 'legacy',
      trackName: 'Legacy',
      trackClass: 'LEGACY',
      isDefaultTrack: true,
      desiredPlatform: 'AOS-8',
      targetFirmwareReleaseId: 'fw-legacy',
    })
    expect(resolveFirmwarePolicyAt([policy(), legacy], context)).toMatchObject({
      status: 'UNRESOLVED',
      unresolvedReason: 'AMBIGUOUS_DEFAULT_TRACK',
    })
  })

  it('uses the newest effective version of a track without deleting history', () => {
    const oldPolicy = policy({ id: 'old', policyVersion: 1, targetFirmwareReleaseId: 'fw-old' })
    const nextPolicy = policy({
      id: 'new',
      policyVersion: 2,
      targetFirmwareReleaseId: 'fw-new',
      effectiveFrom: '2026-09-03T00:00:00.000Z',
    })
    expect(resolveFirmwarePolicyAt([oldPolicy, nextPolicy], context, new Date('2026-09-04T00:00:00Z')).policy?.id).toBe('new')
  })

  it('keeps a future policy inspectable without activating it early', () => {
    const current = policy({ id: 'current', effectiveFrom: '2026-09-01T00:00:00.000Z', policyVersion: 1 })
    const future = policy({
      id: 'future',
      effectiveFrom: '2026-10-01T00:00:00.000Z',
      policyVersion: 2,
      targetFirmwareReleaseId: 'fw-future',
    })
    const result = resolveFirmwarePolicyTimeline([current, future], context, new Date('2026-09-04T00:00:00Z'))
    expect(result.policy?.id).toBe('current')
    expect(result.next).toMatchObject({ effectiveFrom: '2026-10-01T00:00:00.000Z', policy: { id: 'future' } })
  })

  it('does not grant contract/vendor/device-type columns precedence in #43', () => {
    const legacyReserved = policy({ id: 'reserved', contractTypeId: 'contract-1' })
    expect(resolveFirmwarePolicyAt([legacyReserved], context)).toMatchObject({ status: 'UNRESOLVED', unresolvedReason: 'NO_POLICY' })
  })
})

describe('firmware policy mode validation', () => {
  it('accepts exact, minimum, range, and latest-approved-in-train shapes', () => {
    expect(validateFirmwarePolicyCandidate(policy({ policyMode: 'EXACT' }))).toEqual([])
    expect(validateFirmwarePolicyCandidate(policy({
      policyMode: 'MINIMUM',
      minimumFirmwareReleaseId: 'fw-min',
      targetFirmwareReleaseId: 'fw-preferred',
    }))).toEqual([])
    expect(validateFirmwarePolicyCandidate(policy({
      policyMode: 'RANGE',
      minimumFirmwareReleaseId: 'fw-min',
      maximumFirmwareReleaseId: 'fw-max',
      targetFirmwareReleaseId: 'fw-preferred',
      minimumInclusive: true,
      maximumInclusive: false,
    }))).toEqual([])
    expect(validateFirmwarePolicyCandidate(policy({
      policyMode: 'LATEST_APPROVED_IN_TRAIN',
      targetFirmwareReleaseId: null,
      firmwareTrainId: 'train-1',
    }))).toEqual([])
  })

  it('keeps acceptance bounds separate from the preferred target', () => {
    const ranged = policy({
      policyMode: 'RANGE',
      minimumFirmwareReleaseId: 'fw-min',
      targetFirmwareReleaseId: 'fw-preferred',
      maximumFirmwareReleaseId: 'fw-max',
      minimumInclusive: true,
      maximumInclusive: false,
    })
    expect(ranged).toMatchObject({
      minimumFirmwareReleaseId: 'fw-min',
      targetFirmwareReleaseId: 'fw-preferred',
      maximumFirmwareReleaseId: 'fw-max',
      minimumInclusive: true,
      maximumInclusive: false,
    })
    expect(validateFirmwarePolicyCandidate(ranged)).toEqual([])
  })

  it('rejects incomplete policy modes rather than inventing targets', () => {
    expect(validateFirmwarePolicyCandidate(policy({ policyMode: 'EXACT', targetFirmwareReleaseId: null }))).toContain(
      'EXACT policy requires a preferred firmware release.',
    )
    expect(validateFirmwarePolicyCandidate(policy({ policyMode: 'MINIMUM', minimumFirmwareReleaseId: null }))).toContain(
      'MINIMUM policy requires a minimum firmware release.',
    )
    expect(validateFirmwarePolicyCandidate(policy({
      policyMode: 'RANGE',
      minimumFirmwareReleaseId: null,
      maximumFirmwareReleaseId: null,
    }))).toContain('RANGE policy requires a minimum and/or maximum firmware release.')
    expect(validateFirmwarePolicyCandidate(policy({
      policyMode: 'LATEST_APPROVED_IN_TRAIN',
      targetFirmwareReleaseId: null,
      firmwareTrainId: null,
    }))).toContain('LATEST_APPROVED_IN_TRAIN policy requires an explicit firmware train.')
  })
})
