import { describe, expect, it } from 'vitest'
import {
  canonicalSoftwarePlatform,
  classifyImportedDeviceModel,
  inferFirmwareTrainName,
} from '@/lib/device-import-normalization'

describe('device import classification hierarchy', () => {
  it.each([
    ['Fortinet FortiGate-100F', 'FG-100F', 'FortiGate', 'FORTIOS', 'Firewall'],
    [
      'FortiSwitch FS-124F',
      'FS-124F',
      'FortiSwitch',
      'FORTISWITCH-OS',
      'Switch',
    ],
    ['FortiAP FAP-231F', 'FAP-231F', 'FortiAP', 'FORTIAP-OS', 'Access Point'],
    ['Cisco C9300-24P', 'C9300-24P', 'Catalyst', 'IOS-XE', 'Switch'],
    ['WS-C2960X-24PS-L', 'WS-C2960X-24PS-L', 'Catalyst', 'IOS', 'Switch'],
    ['Aruba 2530-48G', '2530-48G', 'Aruba Switch', 'AOS-S', 'Switch'],
    ['CX 6200F', 'CX 6200F', 'Aruba CX', 'AOS-CX', 'Switch'],
    ['AP-515', 'AP-515', 'Aruba WLAN', 'AOS-10', 'Access Point'],
  ])('classifies %s', (source, model, family, platformCode, type) => {
    const result = classifyImportedDeviceModel(source)
    expect(result).toMatchObject({
      model,
      productFamilyName: family,
      deviceTypeName: type,
    })
    expect(result?.softwarePlatforms.map((item) => item.code)).toContain(
      platformCode,
    )
  })

  it('preserves AP-315 multi-platform support without choosing a false default', () => {
    const result = classifyImportedDeviceModel('Aruba AP-315')
    expect(result?.softwarePlatforms.map((item) => item.code)).toEqual([
      'AOS-8',
      'AOS-10',
    ])
    expect(result?.preferredSoftwarePlatformCode).toBeNull()
  })

  it('uses a confirmed profile rule ahead of built-in normalization', () => {
    const result = classifyImportedDeviceModel('FortiGate 100F', [
      {
        operator: 'EQUALS',
        value: 'FortiGate 100F',
        normalizedValue: 'fortigate 100f',
        result: {
          classificationKey: 'CUSTOM_FORTIGATE',
          model: '100F',
          productFamilyName: 'FortiGate',
          softwarePlatforms: [{ code: 'FORTIOS', name: 'FortiOS' }],
          preferredSoftwarePlatformCode: 'FORTIOS',
          deviceTypeName: 'Firewall',
        },
      },
    ])
    expect(result).toMatchObject({
      source: 'PROFILE_RULE',
      model: '100F',
      classificationKey: 'CUSTOM_FORTIGATE',
    })
  })

  it('normalizes platform aliases and infers useful firmware trains', () => {
    expect(canonicalSoftwarePlatform('AOS 10')).toEqual({
      code: 'AOS-10',
      name: 'AOS 10',
    })
    expect(inferFirmwareTrainName('FortiOS', '7.4.7')).toBe('7.4')
    expect(inferFirmwareTrainName('AOS-S', 'WC.16.11.0020')).toBe('WC.16.11')
    expect(inferFirmwareTrainName('IOS XE', '17.12.5')).toBe('17.12')
  })
})
