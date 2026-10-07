import { describe, expect, it } from 'vitest'
import {
  firmwarePlatformOptionsForVendor,
  firmwareTrainsForPlatform,
  reviewPlatformPatch,
  reviewTrainIdForPlatform,
} from '@/lib/firmware-review-platform'

const release = {
  platform: 'FortiGate',
  firmwareTrainId: 'fortigate-train',
}

describe('firmware review platform correction', () => {
  it('only offers software platforms from the same vendor', () => {
    const options = firmwarePlatformOptionsForVendor(
      [
        { vendorId: 'fortinet', platform: 'FortiGate' },
        { vendorId: 'fortinet', platform: 'FortiOS' },
        { vendorId: 'cisco', platform: 'IOS XE' },
      ],
      'fortinet',
    )

    expect(options.map((option) => option.platform)).toEqual(['FortiGate', 'FortiOS'])
  })

  it('filters train choices to the selected vendor and software platform', () => {
    const trains = [
      {
        id: 'fortios-74',
        vendorId: 'fortinet',
        platform: 'FortiOS',
        name: '7.4.x',
        state: 'PREFERRED',
        preferredFirmwareReleaseId: null,
        minimumAcceptableFirmwareReleaseId: null,
        preferredRelease: null,
        minimumAcceptableRelease: null,
        isActive: true,
        source: 'MANUAL',
        externalProvider: null,
        externalId: null,
        lastSynchronizedAt: null,
        deviceCount: 0,
        vendor: { id: 'fortinet', code: 'FORTINET', name: 'Fortinet', isActive: true },
      },
      {
        id: 'fortigate-old',
        vendorId: 'fortinet',
        platform: 'FortiGate',
        name: 'wrong',
        state: 'ACCEPTED',
        preferredFirmwareReleaseId: null,
        minimumAcceptableFirmwareReleaseId: null,
        preferredRelease: null,
        minimumAcceptableRelease: null,
        isActive: true,
        source: 'MANUAL',
        externalProvider: null,
        externalId: null,
        lastSynchronizedAt: null,
        deviceCount: 0,
        vendor: { id: 'fortinet', code: 'FORTINET', name: 'Fortinet', isActive: true },
      },
      {
        id: 'cisco-17',
        vendorId: 'cisco',
        platform: 'FortiOS',
        name: '17.x',
        state: 'ACCEPTED',
        preferredFirmwareReleaseId: null,
        minimumAcceptableFirmwareReleaseId: null,
        preferredRelease: null,
        minimumAcceptableRelease: null,
        isActive: true,
        source: 'MANUAL',
        externalProvider: null,
        externalId: null,
        lastSynchronizedAt: null,
        deviceCount: 0,
        vendor: { id: 'cisco', code: 'CISCO', name: 'Cisco', isActive: true },
      },
    ] as never

    expect(firmwareTrainsForPlatform(trains, 'fortinet', ' fortios ').map((train) => train.id)).toEqual([
      'fortios-74',
    ])
  })

  it('clears the old train when the software platform changes', () => {
    expect(
      reviewTrainIdForPlatform({
        release,
        selectedPlatform: 'FortiOS',
      }),
    ).toBe('')

    expect(
      reviewPlatformPatch({
        release,
        selectedPlatform: 'FortiOS',
        selectedTrainId: '',
      }),
    ).toEqual({
      platform: 'FortiOS',
      firmwareTrainId: null,
    })
  })

  it('keeps a compatible existing train when the platform is unchanged', () => {
    expect(
      reviewTrainIdForPlatform({
        release,
        selectedPlatform: ' fortigate ',
      }),
    ).toBe('fortigate-train')

    expect(
      reviewPlatformPatch({
        release,
        selectedPlatform: 'FortiGate',
        selectedTrainId: 'fortigate-train',
      }),
    ).toEqual({})
  })
})
