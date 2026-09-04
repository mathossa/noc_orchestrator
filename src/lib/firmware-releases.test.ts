import { describe, expect, it } from 'vitest'
import {
  FirmwareReleaseValidationError,
  catalogSemanticsFromLegacyStatus,
  isFirmwarePolicyEligible,
  parseFirmwareReleaseInput,
} from '@/lib/firmware-releases'

describe('firmware release validation', () => {
  it('keeps exact vendor versions opaque while deriving safe grouping metadata', () => {
    const parsed = parseFirmwareReleaseInput({
      vendorId: 'vendor-1',
      platform: 'IOS',
      version: ' 15.2(7)E17a ',
    })
    expect(parsed.version).toBe('15.2(7)E17a')
    expect(parsed.logicalVersion).toBe('15.2(7)E17')
    expect(parsed.variant).toBe('a')
  })

  it('extracts Aruba image code without removing it from the exact version', () => {
    const parsed = parseFirmwareReleaseInput({ vendorId: 'vendor-1', platform: 'AOS-S', version: 'WC.16.11.0002' })
    expect(parsed).toMatchObject({
      version: 'WC.16.11.0002',
      logicalVersion: '16.11.0002',
      imageCode: 'WC',
    })
  })

  it('normalizes platform whitespace but preserves display casing', () => {
    const parsed = parseFirmwareReleaseInput({ vendorId: 'vendor-1', platform: '  IOS   XE  ', version: '17.15.5' })
    expect(parsed.platform).toBe('IOS XE')
  })

  it('maps legacy APPROVED/RECOMMENDED/BLOCKED statuses into independent catalog semantics', () => {
    expect(catalogSemanticsFromLegacyStatus('APPROVED')).toEqual({ catalogState: 'VERIFIED', policyEligibility: 'ALLOWED' })
    expect(catalogSemanticsFromLegacyStatus('RECOMMENDED')).toEqual({ catalogState: 'VERIFIED', policyEligibility: 'PREFERRED' })
    expect(catalogSemanticsFromLegacyStatus('BLOCKED')).toEqual({ catalogState: 'BLOCKED', policyEligibility: 'DISALLOWED' })
  })

  it('forces blocked or withdrawn releases to be policy-disallowed', () => {
    const parsed = parseFirmwareReleaseInput({
      vendorId: 'vendor-1',
      platform: 'IOS XE',
      version: '17.15.5',
      catalogState: 'WITHDRAWN',
      policyEligibility: 'PREFERRED',
    })
    expect(parsed.catalogState).toBe('WITHDRAWN')
    expect(parsed.policyEligibility).toBe('DISALLOWED')
    expect(parsed.status).toBe('DEPRECATED')
  })

  it('does not make a newly observed or verified release policy eligible by default', () => {
    const parsed = parseFirmwareReleaseInput({
      vendorId: 'vendor-1',
      platform: 'FortiOS',
      version: '7.4.12',
      catalogState: 'VERIFIED',
      source: 'IMPORT',
    })
    expect(parsed.policyEligibility).toBe('NOT_EVALUATED')
    expect(isFirmwarePolicyEligible(parsed)).toBe(false)
  })

  it('recognizes only explicit allowed/preferred releases as policy eligible', () => {
    expect(isFirmwarePolicyEligible({ isActive: true, catalogState: 'VERIFIED', policyEligibility: 'ALLOWED' })).toBe(true)
    expect(isFirmwarePolicyEligible({ isActive: true, catalogState: 'VERIFIED', policyEligibility: 'PREFERRED' })).toBe(true)
    expect(isFirmwarePolicyEligible({ isActive: true, catalogState: 'BLOCKED', policyEligibility: 'PREFERRED' })).toBe(false)
  })

  it('rejects unsupported catalog-state and policy-eligibility values', () => {
    expect(() =>
      parseFirmwareReleaseInput({
        vendorId: 'vendor-1',
        platform: 'IOS XE',
        version: '17.15.5',
        catalogState: 'LATEST',
      }),
    ).toThrow(FirmwareReleaseValidationError)
  })

  it('validates SHA256 and file size metadata', () => {
    expect(() => parseFirmwareReleaseInput({ vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', sha256: 'abc', fileSizeBytes: '-1' })).toThrow(FirmwareReleaseValidationError)
  })

  it('accepts a complete manual catalog record without external identity', () => {
    const parsed = parseFirmwareReleaseInput({
      vendorId: 'vendor-1',
      platform: 'FortiOS',
      version: '7.4.12',
      policyEligibility: 'ALLOWED',
      fileSizeBytes: '123456789',
      sha256: 'a'.repeat(64),
      releaseNotesUrl: 'https://example.invalid/release-notes',
      source: 'MANUAL',
    })
    expect(parsed.fileSizeBytes?.toString()).toBe('123456789')
    expect(parsed.policyEligibility).toBe('ALLOWED')
    expect(parsed.status).toBe('APPROVED')
    expect(parsed.externalProvider).toBeNull()
    expect(parsed.externalId).toBeNull()
  })
})
