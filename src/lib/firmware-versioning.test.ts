import { describe, expect, it } from 'vitest'
import { compareFirmwareVersions, deriveFirmwareReleaseIdentity } from '@/lib/firmware-versioning'

describe('firmware release identity', () => {
  it('separates Aruba AOS-S image code from the shared logical release', () => {
    expect(deriveFirmwareReleaseIdentity({ vendorKey: 'Aruba', platform: 'AOS-S', version: 'WC.16.11.0002' })).toMatchObject({
      exactVersion: 'WC.16.11.0002',
      logicalVersion: '16.11.0002',
      variant: null,
      imageCode: 'WC',
      parserId: 'aruba-image-dotted-v1',
    })
  })

  it('preserves Cisco maintenance rebuild suffixes instead of stripping them', () => {
    expect(deriveFirmwareReleaseIdentity({ vendorKey: 'Cisco', platform: 'IOS', version: '15.2(7)E17a' })).toMatchObject({
      exactVersion: '15.2(7)E17a',
      logicalVersion: '15.2(7)E17',
      variant: 'a',
      imageCode: null,
      parserId: 'cisco-ios-train-v1',
    })
  })

  it('keeps unsupported vendor versions opaque', () => {
    expect(deriveFirmwareReleaseIdentity({ vendorKey: 'Example', platform: 'UnknownOS', version: 'release-blue-r3' })).toMatchObject({
      exactVersion: 'release-blue-r3',
      logicalVersion: 'release-blue-r3',
      variant: null,
      imageCode: null,
      parserId: 'opaque-v1',
    })
  })
})

describe('firmware version ordering', () => {
  it('orders deterministic dotted releases without assuming SemVer metadata', () => {
    expect(compareFirmwareVersions({ vendorKey: 'Aruba', platform: 'AOS-8', leftVersion: '8.10.0.22', rightVersion: '8.13.2.0' }).result).toBe('LESS')
    expect(compareFirmwareVersions({ vendorKey: 'Cisco', platform: 'IOS-XE', leftVersion: '17.15.6', rightVersion: '17.15.5' }).result).toBe('GREATER')
  })

  it('orders releases inside one Cisco IOS train', () => {
    expect(compareFirmwareVersions({ vendorKey: 'Cisco', platform: 'IOS', leftVersion: '15.2(7)E17', rightVersion: '15.2(7)E18' })).toMatchObject({
      result: 'LESS',
      comparatorId: 'cisco-ios-train-v1',
    })
  })

  it('does not invent ordering between Cisco rebuild suffixes', () => {
    expect(compareFirmwareVersions({ vendorKey: 'Cisco', platform: 'IOS', leftVersion: '15.2(7)E17', rightVersion: '15.2(7)E17a' }).result).toBe('NOT_COMPARABLE')
  })

  it('compares Aruba image builds by shared logical version while leaving image compatibility to the compatibility layer', () => {
    expect(compareFirmwareVersions({ vendorKey: 'Aruba', platform: 'AOS-S', leftVersion: 'WC.16.11.0002', rightVersion: 'YA.16.11.0014' })).toMatchObject({
      result: 'LESS',
      comparatorId: 'aruba-image-dotted-v1',
    })
  })

  it('returns not comparable for unsupported opaque syntax instead of lexical guessing', () => {
    expect(compareFirmwareVersions({ vendorKey: 'Example', platform: 'UnknownOS', leftVersion: 'release-blue', rightVersion: 'release-green' }).result).toBe('NOT_COMPARABLE')
  })
})
