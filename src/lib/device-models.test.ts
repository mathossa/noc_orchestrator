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
      supportedPlatforms: [],
      notes: null,
      isActive: true,
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
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
