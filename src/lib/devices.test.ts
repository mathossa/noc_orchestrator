import { describe, expect, it } from 'vitest'
import { DeviceValidationError, normalizedDeviceName, parseDeviceInput } from '@/lib/devices'

describe('device inventory validation', () => {
  it('accepts a minimal manual device without integration identity or site', () => {
    const parsed = parseDeviceInput({
      customerId: 'customer-1',
      deviceModelId: 'model-1',
      name: '  HQ-SW-01  ',
    })

    expect(parsed).toMatchObject({
      customerId: 'customer-1',
      siteId: null,
      deviceModelId: 'model-1',
      name: 'HQ-SW-01',
      source: 'MANUAL',
      externalProvider: null,
      externalId: null,
      currentFirmwareReleaseId: null,
      currentFirmwareObservedAt: null,
      currentFirmwareSource: 'MANUAL',
    })
  })

  it('normalizes device names for customer-scoped duplicate detection', () => {
    expect(normalizedDeviceName('  HQ   Switch 01 ')).toBe(normalizedDeviceName('hq switch 01'))
  })

  it('accepts a recorded firmware observation timestamp without requiring reachability', () => {
    const parsed = parseDeviceInput({
      customerId: 'customer-1',
      deviceModelId: 'model-1',
      name: 'Switch',
      managementAddress: '10.20.30.40',
      currentFirmwareReleaseId: 'release-1',
      currentFirmwareSource: 'IMPORT',
      currentFirmwareObservedAt: '2026-08-31T20:30:00.000Z',
    })

    expect(parsed.managementAddress).toBe('10.20.30.40')
    expect(parsed.currentFirmwareSource).toBe('IMPORT')
    expect(parsed.currentFirmwareObservedAt?.toISOString()).toBe('2026-08-31T20:30:00.000Z')
  })

  it('clears observation time when current firmware is unknown', () => {
    const parsed = parseDeviceInput({
      customerId: 'customer-1',
      deviceModelId: 'model-1',
      name: 'Switch',
      currentFirmwareObservedAt: '2026-08-31T20:30:00.000Z',
    })

    expect(parsed.currentFirmwareObservedAt).toBeNull()
  })

  it('rejects missing required relationships and unsupported provenance', () => {
    expect(() => parseDeviceInput({ name: '', source: 'SSH' })).toThrow(DeviceValidationError)
    try {
      parseDeviceInput({ name: '', source: 'SSH' })
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceValidationError)
      expect((error as DeviceValidationError).fields).toMatchObject({
        customerId: expect.any(String),
        deviceModelId: expect.any(String),
        name: expect.any(String),
        source: expect.any(String),
      })
    }
  })
})
