import { describe, expect, it } from 'vitest'
import type { DeviceModelFirmwareReference, DeviceModelRecord } from '@/lib/device-models'
import { commonCompatibleDesiredReleases, groupDeviceModels } from '@/lib/model-bulk-firmware'

function model(overrides: Partial<DeviceModelRecord> & Pick<DeviceModelRecord, 'id' | 'vendorId' | 'model'>): DeviceModelRecord {
  return {
    deviceTypeId: 'type-1',
    familyId: null,
    supportedPlatforms: ['AOS-S'],
    notes: null,
    isActive: true,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    vendor: { id: overrides.vendorId, code: 'VENDOR', name: overrides.vendorId, isActive: true },
    deviceType: { id: 'type-1', code: 'SWITCH', name: 'Switches', isActive: true },
    family: null,
    deviceCount: 0,
    desiredFirmwareRelease: null,
    ...overrides,
  }
}

function release(overrides: Partial<DeviceModelFirmwareReference> & Pick<DeviceModelFirmwareReference, 'id' | 'vendorId'>): DeviceModelFirmwareReference {
  return {
    version: overrides.id,
    logicalVersion: overrides.id,
    variant: null,
    imageCode: null,
    platform: 'AOS-S',
    catalogState: 'VERIFIED',
    policyEligibility: 'ALLOWED',
    variantEquivalence: 'EXACT_ONLY',
    status: 'APPROVED',
    isActive: true,
    releasedAt: null,
    firmwareTrain: null,
    ...overrides,
  }
}

describe('model family grouping and common desired firmware', () => {
  it('groups concrete models by explicit family membership rather than model name prefixes', () => {
    const family = { id: 'family-2530', vendorId: 'aruba', name: '2530', isActive: true }
    const records = [
      model({ id: 'm1', vendorId: 'aruba', model: '2530-24G', familyId: family.id, family }),
      model({ id: 'm2', vendorId: 'aruba', model: 'Completely different label', familyId: family.id, family }),
      model({ id: 'm3', vendorId: 'aruba', model: '2530-looking-name', familyId: null, family: null }),
    ]
    const groups = groupDeviceModels(records, 'family')
    expect(groups.find((group) => group.key === family.id)?.rows.map((row) => row.id)).toEqual(['m1', 'm2'])
    expect(groups.find((group) => group.key.startsWith('unassigned:'))?.rows.map((row) => row.id)).toEqual(['m3'])
  })

  it('does not offer releases on a platform explicitly excluded by the model selection', () => {
    const selected = [
      model({ id: 'm1', vendorId: 'aruba', model: 'AP-515', supportedPlatforms: ['AOS-8'] }),
      model({ id: 'm2', vendorId: 'aruba', model: 'AP-505', supportedPlatforms: ['AOS-8'] }),
    ]
    const releases = [
      release({ id: 'same-platform', vendorId: 'aruba', platform: 'AOS-8', policyEligibility: 'ALLOWED' }),
      release({ id: 'cross-platform', vendorId: 'aruba', platform: 'AOS-10', policyEligibility: 'PREFERRED', status: 'RECOMMENDED' }),
      release({ id: 'observed', vendorId: 'aruba', platform: 'AOS-8', catalogState: 'OBSERVED', policyEligibility: 'NOT_EVALUATED', status: 'AVAILABLE' }),
      release({ id: 'blocked', vendorId: 'aruba', platform: 'AOS-8', catalogState: 'BLOCKED', policyEligibility: 'DISALLOWED', status: 'BLOCKED' }),
      release({ id: 'archived', vendorId: 'aruba', platform: 'AOS-8', isActive: false }),
      release({ id: 'wrong-vendor', vendorId: 'cisco', platform: 'IOS-XE' }),
    ]
    expect(commonCompatibleDesiredReleases(selected, releases).map((item) => item.id)).toEqual(['same-platform'])
  })

  it('offers a release when every selected model supports that platform', () => {
    const selected = [
      model({ id: 'm1', vendorId: 'aruba', model: 'Model A', supportedPlatforms: ['AOS-S'] }),
      model({ id: 'm2', vendorId: 'aruba', model: 'Model B', supportedPlatforms: ['AOS-S', 'AOS-S-v2'] }),
    ]
    const releases = [
      release({ id: 'aos-s', vendorId: 'aruba', platform: 'AOS-S' }),
      release({ id: 'aos-s-v2', vendorId: 'aruba', platform: 'AOS-S-v2' }),
    ]
    expect(commonCompatibleDesiredReleases(selected, releases).map((item) => item.id)).toEqual(['aos-s'])

    const bothSupportV2 = selected.map((item) => ({ ...item, supportedPlatforms: ['AOS-S', 'AOS-S-v2'] }))
    expect(commonCompatibleDesiredReleases(bothSupportV2, releases).map((item) => item.id)).toEqual(['aos-s', 'aos-s-v2'])
  })

  it('keeps policy-eligible candidates when a model has no support evidence yet', () => {
    const selected = [model({ id: 'm1', vendorId: 'aruba', model: 'Unknown support', supportedPlatforms: [] })]
    const releases = [release({ id: 'aos-s', vendorId: 'aruba', platform: 'AOS-S' })]
    expect(commonCompatibleDesiredReleases(selected, releases).map((item) => item.id)).toEqual(['aos-s'])
  })

  it('offers no target for mixed-vendor selection', () => {
    const selected = [
      model({ id: 'm1', vendorId: 'aruba', model: '2530-24G' }),
      model({ id: 'm2', vendorId: 'cisco', model: 'C9300-24P', supportedPlatforms: [] }),
    ]
    expect(commonCompatibleDesiredReleases(selected, [release({ id: 'fw', vendorId: 'aruba' })])).toEqual([])
  })
})
