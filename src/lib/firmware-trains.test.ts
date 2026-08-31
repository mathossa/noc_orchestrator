import { describe, expect, it } from 'vitest'
import {
  FirmwareTrainValidationError,
  normalizedFirmwareTrainName,
  normalizedFirmwareTrainPlatform,
  parseFirmwareTrainInput,
} from '@/lib/firmware-trains'

describe('firmware train validation', () => {
  it('keeps train labels explicit instead of parsing them as versions', () => {
    const parsed = parseFirmwareTrainInput({ vendorId: 'vendor-1', platform: 'FortiOS', name: ' 8.13.x ' })
    expect(parsed.name).toBe('8.13.x')
  })

  it('normalizes train identity for duplicate detection', () => {
    expect(normalizedFirmwareTrainName(' 8.13.X ')).toBe('8.13.x')
    expect(normalizedFirmwareTrainPlatform('  IOS   XE ')).toBe('ios xe')
  })

  it('accepts manual trains without external identity', () => {
    const parsed = parseFirmwareTrainInput({ vendorId: 'vendor-1', platform: 'FortiOS', name: '8.13.x' })
    expect(parsed.source).toBe('MANUAL')
    expect(parsed.externalProvider).toBeNull()
    expect(parsed.externalId).toBeNull()
  })

  it('requires vendor, platform, and train name', () => {
    expect(() => parseFirmwareTrainInput({})).toThrow(FirmwareTrainValidationError)
  })
})
