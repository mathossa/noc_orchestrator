import { describe, expect, it } from 'vitest'
import { FirmwareReleaseValidationError, parseFirmwareReleaseInput } from '@/lib/firmware-releases'

describe('firmware release validation', () => {
  it('keeps vendor versions opaque rather than semver-normalizing them', () => {
    const parsed = parseFirmwareReleaseInput({
      vendorId: 'vendor-1',
      platform: 'IOS XE',
      version: ' 17.15.5a-ED ',
    })
    expect(parsed.version).toBe('17.15.5a-ED')
  })

  it('normalizes platform whitespace but preserves display casing', () => {
    const parsed = parseFirmwareReleaseInput({ vendorId: 'vendor-1', platform: '  IOS   XE  ', version: '17.15.5' })
    expect(parsed.platform).toBe('IOS XE')
  })

  it('rejects unsupported catalog statuses', () => {
    expect(() => parseFirmwareReleaseInput({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', status: 'LATEST' })).toThrow(FirmwareReleaseValidationError)
  })

  it('validates SHA256 and file size metadata', () => {
    expect(() => parseFirmwareReleaseInput({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', sha256: 'abc', fileSizeBytes: '-1' })).toThrow(FirmwareReleaseValidationError)
  })

  it('accepts a complete manual catalog record without external identity', () => {
    const parsed = parseFirmwareReleaseInput({
      vendorId: 'vendor-1',
      platform: 'FortiOS',
      version: '7.4.12',
      status: 'APPROVED',
      fileSizeBytes: '123456789',
      sha256: 'a'.repeat(64),
      releaseNotesUrl: 'https://example.invalid/release-notes',
      source: 'MANUAL',
    })
    expect(parsed.fileSizeBytes?.toString()).toBe('123456789')
    expect(parsed.externalProvider).toBeNull()
    expect(parsed.externalId).toBeNull()
  })
})
