import { describe, expect, it } from 'vitest'
import { cleanSiteCode, normalizedSiteName, parseSiteInput, SiteValidationError } from '@/lib/sites'

describe('site validation', () => {
  it('cleans site identity without requiring integration metadata', () => {
    const parsed = parseSiteInput({ name: '  Head   Office ', code: ' hq_main ' })
    expect(parsed.name).toBe('Head Office')
    expect(parsed.code).toBe('HQ-MAIN')
    expect(parsed.source).toBe('MANUAL')
    expect(parsed.externalProvider).toBeNull()
    expect(parsed.externalId).toBeNull()
  })

  it('normalizes names for customer-scoped duplicate detection', () => {
    expect(normalizedSiteName('  HEAD   Office ')).toBe('head office')
  })

  it('canonicalizes optional site codes', () => {
    expect(cleanSiteCode('ams_dc-1')).toBe('AMS-DC-1')
    expect(cleanSiteCode('')).toBeNull()
  })

  it('accepts partial location data without a full postal address', () => {
    const parsed = parseSiteInput({ name: 'Warehouse', city: 'Deventer', country: 'Netherlands' })
    expect(parsed.city).toBe('Deventer')
    expect(parsed.addressLine1).toBeNull()
  })

  it('rejects missing names and unsupported provenance', () => {
    expect(() => parseSiteInput({ name: '', source: 'SCRAPE' })).toThrow(SiteValidationError)
  })
})
