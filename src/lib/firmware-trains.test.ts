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

  it('uses Accepted as the default train state and validates preferred/minimum configuration shape', () => {
    expect(parseFirmwareTrainInput({ vendorId: 'vendor-1', platform: 'IOS XE', name: '17.15' }).state).toBe('ACCEPTED')
    expect(parseFirmwareTrainInput({
      vendorId: 'vendor-1',
      platform: 'IOS XE',
      name: '17.15',
      state: 'PREFERRED',
      preferredFirmwareReleaseId: 'release-1',
      minimumAcceptableFirmwareReleaseId: 'release-2',
    })).toMatchObject({
      state: 'PREFERRED',
      preferredFirmwareReleaseId: 'release-1',
      minimumAcceptableFirmwareReleaseId: 'release-2',
    })
    expect(() => parseFirmwareTrainInput({
      vendorId: 'vendor-1',
      platform: 'IOS XE',
      name: '17.15',
      minimumAcceptableFirmwareReleaseId: 'release-2',
    })).toThrow(FirmwareTrainValidationError)
  })

    it('requires vendor, platform, and train name', () => {
    expect(() => parseFirmwareTrainInput({})).toThrow(FirmwareTrainValidationError)
  })
})
