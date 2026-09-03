import { describe, expect, it } from 'vitest'
import {
  importSiteProfileContext,
  importSiteProfileContextCandidates,
  nextAvailableImportSiteCode,
  suggestedImportSiteCode,
  suggestedImportSiteName,
} from '@/lib/device-import-site-code'

describe('import Site codes', () => {
  it('creates readable canonical codes from imported Site names', () => {
    expect(suggestedImportSiteCode('UICTS Working Spirit Deventer')).toBe('UICTS-WORKING-SPIRIT-DEVENTER')
    expect(suggestedImportSiteCode('  Zwolle / DC #1  ')).toBe('ZWOLLE-DC-1')
  })

  it('adds a numeric suffix when a Site code is already used', () => {
    const used = new Set(['ZWOLLE-DC', 'ZWOLLE-DC-2'])
    expect(nextAvailableImportSiteCode('ZWOLLE-DC', used)).toBe('ZWOLLE-DC-3')
  })

  it('keeps generated codes within forty characters when adding suffixes', () => {
    const base = suggestedImportSiteCode('A very long imported site name that needs to be shortened for the code')
    const result = nextAvailableImportSiteCode(base, new Set([base]))
    expect(result.length).toBeLessThanOrEqual(40)
    expect(result.endsWith('-2')).toBe(true)
  })

  it('uses the raw organization suffix as a review suggestion for generic upstream Sites', () => {
    expect(suggestedImportSiteName('Open internet', 'Unica Groep - UICTS Working Spirit Deventer', 'Unica Groep'))
      .toBe('UICTS Working Spirit Deventer')
    expect(suggestedImportSiteName('Open internet', 'Unica Groep - Zwolle', 'Unica Groep')).toBe('Zwolle')
    expect(suggestedImportSiteName('Datacenter', 'Unica Groep - Zwolle', 'Unica Groep')).toBe('Datacenter')
  })

  it('keeps same generic Site labels distinguishable by raw organization context', () => {
    expect(importSiteProfileContext('customer-1', 'Unica Groep - Deventer'))
      .not.toBe(importSiteProfileContext('customer-1', 'Unica Groep - Zwolle'))
  })

  it('never falls a generic Site label back to a Customer-wide remembered mapping', () => {
    expect(importSiteProfileContextCandidates('customer-1', 'Unica Groep - Deventer', 'Open internet'))
      .toEqual(['customer-1|organization-site:unica groep - deventer'])
    expect(importSiteProfileContextCandidates('customer-1', 'Unica Groep - Deventer', 'Deventer'))
      .toEqual(['customer-1|organization-site:unica groep - deventer', 'customer-1'])
  })
})
