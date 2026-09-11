import { describe, expect, it } from 'vitest'
import {
  resolveObservedFirmwareRelease,
  supportedFirmwarePlatforms,
} from '@/lib/firmware-observation'

describe('observed firmware identity resolution', () => {
  const releases = [
    {
      id: 'mr-32-2-4',
      vendorId: 'cisco',
      platform: 'Meraki MR',
      version: 'MR 32.2.4',
    },
    {
      id: 'ms-32-2-4',
      vendorId: 'cisco',
      platform: 'Meraki MS',
      version: 'MR 32.2.4',
    },
  ]

  it('matches an observed Meraki MR release by vendor, version and model platform', () => {
    expect(
      resolveObservedFirmwareRelease({
        vendorId: 'cisco',
        observedVersion: 'MR 32.2.4',
        supportedPlatforms: ['Meraki MR'],
        releases,
      }),
    ).toMatchObject({
      status: 'MATCHED',
      release: { id: 'mr-32-2-4' },
    })
  })

  it('normalizes harmless case and whitespace differences without changing identity semantics', () => {
    expect(
      resolveObservedFirmwareRelease({
        vendorId: 'cisco',
        observedVersion: '  mr 32.2.4  ',
        supportedPlatforms: [' meraki mr '],
        releases,
      }).status,
    ).toBe('MATCHED')
  })

  it('refuses to invent a canonical link when the version is ambiguous without platform evidence', () => {
    expect(
      resolveObservedFirmwareRelease({
        vendorId: 'cisco',
        observedVersion: 'MR 32.2.4',
        releases,
      }).status,
    ).toBe('AMBIGUOUS')
  })

  it('parses the model supported-platform list used by inventory', () => {
    expect(supportedFirmwarePlatforms('IOS-XE, Meraki MR, IOS-XE')).toEqual([
      'IOS-XE',
      'Meraki MR',
    ])
  })
})
