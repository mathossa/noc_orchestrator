import { describe, expect, it } from 'vitest'
import {
  cleanDeviceModelName,
  DeviceModelValidationError,
  normalizedDeviceModelName,
  parseDeviceModelInput,
} from '@/lib/device-models'

describe('device model validation', () => {
  it('normalizes whitespace while preserving the displayed model casing', () => {
    expect(cleanDeviceModelName('  C9300-24P   Network   Advantage ')).toBe('C9300-24P Network Advantage')
    expect(normalizedDeviceModelName('  c9300-24p  ')).toBe('c9300-24p')
  })

  it('creates a manual model without external identity fields', () => {
    expect(
      parseDeviceModelInput({
        vendorId: 'vendor-1',
        deviceTypeId: 'type-1',
        model: 'C9300-24P',
      }),
    ).toEqual({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      familyId: null,
      model: 'C9300-24P',
      platform: null,
      supportedPlatforms: null,
      preferredPlatform: null,
      notes: null,
      isActive: true,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
    })
  })

  it('accepts multiple supported platforms in the existing model platform field', () => {
    expect(parseDeviceModelInput({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: '2530-24G',
      platform: ' AOS-S,   AOS-S-v2 ',
    })).toMatchObject({
      platform: 'AOS-S, AOS-S-v2',
      supportedPlatforms: ['AOS-S', 'AOS-S-v2'],
    })
  })

  it('uses the only supported platform as the preferred platform', () => {
    expect(parseDeviceModelInput({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: 'Switch',
      supportedPlatforms: ['IOS XE'],
    })).toMatchObject({
      supportedPlatforms: ['IOS XE'],
      preferredPlatform: 'IOS XE',
    })
  })

  it('accepts an explicit preferred platform for multi-platform models', () => {
    expect(parseDeviceModelInput({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: 'AP',
      supportedPlatforms: ['AOS-8', 'AOS-10'],
      preferredPlatform: 'AOS-10',
    })).toMatchObject({
      supportedPlatforms: ['AOS-8', 'AOS-10'],
      preferredPlatform: 'AOS-10',
    })
  })

  it('rejects a preferred platform outside the supported-platform set', () => {
    expect(() => parseDeviceModelInput({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: 'AP',
      supportedPlatforms: ['AOS-8', 'AOS-10'],
      preferredPlatform: 'AOS-S',
    })).toThrow(DeviceModelValidationError)
  })

  it('deduplicates supported platforms case-insensitively', () => {
    expect(parseDeviceModelInput({
      vendorId: 'vendor-1',
      deviceTypeId: 'type-1',
      model: '2530-24G',
      supportedPlatforms: ['AOS-S', 'aos-s', 'AOS-S-v2'],
    })).toMatchObject({
      platform: 'aos-s, AOS-S-v2',
      supportedPlatforms: ['aos-s', 'AOS-S-v2'],
    })
  })

  it('requires vendor, device type, and model identity', () => {
    expect(() => parseDeviceModelInput({})).toThrow(DeviceModelValidationError)

    try {
      parseDeviceModelInput({})
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceModelValidationError)
      expect((error as DeviceModelValidationError).fields).toMatchObject({
        vendorId: expect.any(String),
        deviceTypeId: expect.any(String),
        model: expect.any(String),
      })
    }
  })

  it('rejects unknown source types', () => {
    expect(() =>
      parseDeviceModelInput({
        vendorId: 'vendor-1',
        deviceTypeId: 'type-1',
        model: 'Model',
        source: 'SSH',
      }),
    ).toThrow(DeviceModelValidationError)
  })
})
