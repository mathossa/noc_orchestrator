import { describe, expect, it } from 'vitest'
import {
  isAosSBootFirmwarePair,
  isCiscoRommonVersion,
  selectImportedRunningFirmware,
} from '@/lib/device-import-running-firmware'

describe('imported running firmware interpretation', () => {
  it('treats Cisco ROMMON as boot firmware and uses Software Version', () => {
    expect(isCiscoRommonVersion('16.12(3r)')).toBe(true)
    expect(isCiscoRommonVersion('17.5(1r)')).toBe(true)
    expect(isCiscoRommonVersion('17.12.5')).toBe(false)

    expect(
      selectImportedRunningFirmware({
        currentFirmware: '16.12(3r)',
        firmwareVersion: '16.12(3r)',
        softwareVersion: 'Cisco IOS XE Software, Version 17.12.5',
      }),
    ).toEqual({
      version: '17.12.5',
      source: 'SOFTWARE_VERSION',
      reason: 'CISCO_ROMMON',
    })

    expect(
      selectImportedRunningFirmware({
        currentFirmware: '17.5(1r)',
        firmwareVersion: '17.5(1r)',
        softwareVersion: '17.09.05',
      }).version,
    ).toBe('17.09.05')
  })

  it('uses AOS-S Software Version when Firmware Version is boot firmware', () => {
    expect(
      isAosSBootFirmwarePair('WC.16.01.0010', 'WC.16.11.0002'),
    ).toBe(true)
    expect(
      selectImportedRunningFirmware({
        vendor: 'HPE Networking',
        model: '2930F',
        currentFirmware: 'WC.16.01.0010',
        firmwareVersion: 'WC.16.01.0010',
        softwareVersion: 'WC.16.11.0002',
      }),
    ).toEqual({
      version: 'WC.16.11.0002',
      source: 'SOFTWARE_VERSION',
      reason: 'AOS_S_BOOT_FIRMWARE',
    })
  })

  it('does not reinterpret an AOS-S-looking pair without Aruba/HPE context', () => {
    expect(
      selectImportedRunningFirmware({
        vendor: 'Other Vendor',
        model: 'Other Model',
        currentFirmware: 'WC.16.01.0010',
        firmwareVersion: 'WC.16.01.0010',
        softwareVersion: 'WC.16.11.0002',
      }),
    ).toEqual({
      version: 'WC.16.01.0010',
      source: 'FIRMWARE_VERSION',
      reason: 'REPORTED_FIRMWARE',
    })
  })

  it('keeps ordinary reported firmware authoritative', () => {
    expect(
      selectImportedRunningFirmware({
        currentFirmware: '7.4.12',
        firmwareVersion: '7.4.12',
        softwareVersion: '7.4.11',
      }),
    ).toEqual({
      version: '7.4.12',
      source: 'FIRMWARE_VERSION',
      reason: 'REPORTED_FIRMWARE',
    })
  })

  it('uses Software Version for placeholder firmware values', () => {
    expect(
      selectImportedRunningFirmware({
        currentFirmware: '0.1',
        firmwareVersion: '0.1',
        softwareVersion: 'Cupertino 17.09.05',
      }),
    ).toEqual({
      version: '17.09.05',
      source: 'SOFTWARE_VERSION',
      reason: 'PLACEHOLDER_FIRMWARE',
    })
  })

  it('does not discard a ROMMON value when no running software evidence exists', () => {
    expect(
      selectImportedRunningFirmware({
        currentFirmware: '16.12(3r)',
        firmwareVersion: '16.12(3r)',
        softwareVersion: null,
      }),
    ).toEqual({
      version: '16.12(3r)',
      source: 'FIRMWARE_VERSION',
      reason: 'REPORTED_FIRMWARE',
    })
  })
})
