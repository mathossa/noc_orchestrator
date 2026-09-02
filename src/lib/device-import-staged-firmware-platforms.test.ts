import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { resolveStagedFirmwarePlatform } from '@/lib/device-import-staged-firmware-platforms'

const ap315 = {
  vendorId: 'vendor-aruba',
  platform: null,
  supportedPlatforms: [{ platform: 'AOS-8' }, { platform: 'AOS-10' }],
}

describe('staged firmware platform resolution', () => {
  it('keeps explicit staged row evidence ahead of a stale model-derived metadata platform', () => {
    expect(resolveStagedFirmwarePlatform(
      { platform: 'AOS-10', platforms: ['AOS-8'] },
      ap315,
      '8.10.0.20',
    )).toBe('AOS-8')
  })

  it('infers the only supported platform for a single-platform model', () => {
    expect(resolveStagedFirmwarePlatform(
      {},
      { vendorId: 'vendor-cisco', platform: null, supportedPlatforms: [{ platform: 'IOS XE' }] },
      '17.15.5',
    )).toBe('IOS XE')
  })

  it('uses an exact firmware version only when it uniquely identifies one supported platform', () => {
    expect(resolveStagedFirmwarePlatform(
      {},
      ap315,
      '8.10.0.20',
      [
        { id: 'fw-8', vendorId: 'vendor-aruba', platform: 'AOS-8', version: '8.10.0.20' },
        { id: 'fw-10', vendorId: 'vendor-aruba', platform: 'AOS-10', version: '10.7.0.1' },
      ],
    )).toBe('AOS-8')
  })

  it('keeps a multi-platform model in review when the same version exists on more than one supported platform', () => {
    expect(resolveStagedFirmwarePlatform(
      {},
      ap315,
      '10.0.0',
      [
        { id: 'fw-8', vendorId: 'vendor-aruba', platform: 'AOS-8', version: '10.0.0' },
        { id: 'fw-10', vendorId: 'vendor-aruba', platform: 'AOS-10', version: '10.0.0' },
      ],
    )).toBeNull()
  })

  it('keeps conflicting staged platform evidence in review instead of choosing the model default', () => {
    expect(resolveStagedFirmwarePlatform(
      { platforms: ['AOS-8', 'AOS-10'] },
      { ...ap315, platform: 'AOS-10' },
      '10.7.0.1',
    )).toBeNull()
  })
})
