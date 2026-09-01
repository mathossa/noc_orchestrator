import { describe, expect, it } from 'vitest'
import { nextAvailableImportSiteCode, suggestedImportSiteCode } from '@/lib/device-import-site-code'

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
})
