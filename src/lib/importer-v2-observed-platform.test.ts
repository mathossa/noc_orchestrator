import { describe, expect, it } from 'vitest'
import {
  inferImporterV2ObservedPlatform,
  importerV2ObservedCompatibilityRule,
} from '@/lib/importer-v2-observed-platform'

describe('Importer v2 observed platform inference', () => {
  it('infers Meraki MR from an observed MR release and Meraki model context', () => {
    expect(
      inferImporterV2ObservedPlatform({
        vendor: 'Cisco',
        model: 'Meraki CW9162I',
        softwareVersion: 'MR 32.2.4',
      }),
    ).toEqual({
      platform: 'Meraki MR',
      evidence: 'MERAKI_FIRMWARE_FAMILY',
      firmwareFamily: 'MR',
      explanation:
        'Meraki firmware family MR was read directly from the observed version prefix and mapped to Meraki MR.',
    })
  })

  it.each([
    ['MS 17.2.1', 'Meraki MS'],
    ['MX 19.1.4', 'Meraki MX'],
    ['MV 6.4', 'Meraki MV'],
    ['MG 3.0.5', 'Meraki MG'],
    ['MT 4.2', 'Meraki MT'],
  ])('maps %s to %s', (softwareVersion, platform) => {
    expect(
      inferImporterV2ObservedPlatform({
        model: 'Cisco Meraki example',
        softwareVersion,
      })?.platform,
    ).toBe(platform)
  })

  it('infers IOS from classic Cisco train syntax with Cisco context', () => {
    expect(
      inferImporterV2ObservedPlatform({
        vendor: 'Cisco',
        model: 'WS-C2960X-48FPS-L',
        softwareVersion: '15.2(7)E2',
      }),
    ).toEqual({
      platform: 'IOS',
      evidence: 'CISCO_CLASSIC_IOS_VERSION',
      firmwareFamily: 'IOS',
      explanation:
        'Classic Cisco IOS train syntax was read directly from the observed version and mapped to IOS.',
    })
  })

  it('does not infer IOS from classic-looking syntax without Cisco context', () => {
    expect(
      inferImporterV2ObservedPlatform({
        vendor: 'Example Networks',
        model: 'Switch-100',
        softwareVersion: '15.2(7)E2',
      }),
    ).toBeNull()
  })

  it('does not infer from a bare MR-like value without Cisco/Meraki context', () => {
    expect(
      inferImporterV2ObservedPlatform({
        vendor: 'Example Networks',
        model: 'AP-100',
        softwareVersion: 'MR 32.2.4',
      }),
    ).toBeNull()
  })

  it('does not replace a source supplied software platform', () => {
    expect(
      inferImporterV2ObservedPlatform({
        vendor: 'Cisco',
        model: 'Meraki CW9162I',
        softwarePlatform: 'Custom Platform',
        softwareVersion: 'MR 32.2.4',
      }),
    ).toBeNull()
  })

  it('uses observed evidence only when no canonical model compatibility rule exists', () => {
    const inference = inferImporterV2ObservedPlatform({
      vendor: 'Cisco',
      model: 'Meraki CW9162I',
      softwareVersion: 'MR 32.2.4',
    })
    expect(
      importerV2ObservedCompatibilityRule({
        vendor: 'Cisco',
        model: 'Meraki CW9162I',
        inference,
        existingRules: [],
      }),
    ).toMatchObject({
      model: 'Meraki CW9162I',
      platforms: ['Meraki MR'],
    })

    expect(
      importerV2ObservedCompatibilityRule({
        vendor: 'Cisco',
        model: 'Meraki CW9162I',
        inference,
        existingRules: [
          {
            vendor: 'Cisco',
            model: 'Meraki CW9162I',
            platforms: ['Meraki MR'],
          },
        ],
      }),
    ).toBeNull()
  })
})
