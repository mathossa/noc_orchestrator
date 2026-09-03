import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  builtInFirmwareInterpretation,
  builtInPreferredModelPlatform,
} from '@/lib/device-import-staged-firmware-assist'
import { inferFirmwareTrainName } from '@/lib/device-import-normalization'
import { selectDeviceImportFirmwareSource } from '@/lib/device-import-profile-predictions'

describe('staged firmware built-in platform inference', () => {
  it.each([
    ['Cisco C9200L-24P-4G', 'IOS XE'],
    ['Cisco C9200L-24P-4X', 'IOS XE'],
    ['Cisco C9300-24P', 'IOS XE'],
    ['Cisco C9300-48P', 'IOS XE'],
    ['Cisco C9300CX-8P-2X2G', 'IOS XE'],
    ['Cisco C9120AXI-E', 'IOS XE'],
    ['Cisco C9120AXE-E', 'IOS XE'],
    ['Cisco WS-C2960X-24PS-L', 'IOS'],
    ['Cisco SG350-28P', 'Sx350'],
    ['Cisco SG350X-48P', 'Sx350'],
    ['Cisco SF350-24P', 'Sx350'],
  ])('infers %s as %s', (model, expectedPlatform) => {
    expect(builtInPreferredModelPlatform(model)).toBe(expectedPlatform)
  })

  it('uses Software Version for Sx350 while keeping other platforms automatic', () => {
    expect(builtInFirmwareInterpretation('Cisco SG350-28P', 'Sx350')).toMatchObject({
      firmwareSource: 'SOFTWARE_VERSION',
    })
    expect(builtInFirmwareInterpretation('Cisco C9200L-24P-4G', 'IOS XE')).toEqual({
      firmwareSource: null,
      reason: null,
    })
  })

  it('maps the SG350 Auvik example to Sx350 2.5.0.83 in train 2.5', () => {
    const platform = builtInPreferredModelPlatform('Cisco SG350-28P')
    const interpretation = builtInFirmwareInterpretation('Cisco SG350-28P', platform)
    const version = selectDeviceImportFirmwareSource({
      effective: '2.5.18',
      firmwareVersion: '2.5.18',
      softwareVersion: '2.5.0.83',
    }, interpretation.firmwareSource)

    expect(platform).toBe('Sx350')
    expect(version).toBe('2.5.0.83')
    expect(inferFirmwareTrainName(platform, version)).toBe('2.5')
  })

  it('does not guess for an unknown model', () => {
    expect(builtInPreferredModelPlatform('Cisco Mystery-123')).toBe('')
  })
})
