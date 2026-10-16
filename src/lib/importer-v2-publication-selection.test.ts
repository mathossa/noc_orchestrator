import { describe, expect, it } from 'vitest'
import {
  eligibleImporterV2PublicationRows,
  parseImporterV2PublicationSelection,
  withoutImporterV2ConflictingRows,
} from '@/lib/importer-v2-publication-selection'

describe('scoped publication selection safety', () => {
  it('preserves explicit selection without extending it to other valid batch rows', () => {
    const selected = parseImporterV2PublicationSelection({
      mode: 'ROWS', rowNumbers: [25, 26],
    })
    expect(selected).toEqual({ mode: 'ROWS', rowNumbers: [25, 26] })
    expect(eligibleImporterV2PublicationRows({
      candidates: [25, 26, 43, 82, 89],
      matchingRows: [25, 26],
    })).toEqual([25, 26])
  })

  it('intersects filtered results across all pages with only eligible rows', () => {
    const selected = parseImporterV2PublicationSelection({
      mode: 'QUERY', filters: { vendor: 'Fortinet', issue: 'NONE' },
    })
    expect(selected).toEqual({
      mode: 'QUERY', filters: { vendor: 'Fortinet', issue: 'NONE' },
    })
    expect(eligibleImporterV2PublicationRows({
      candidates: [1, 9, 11, 107, 1900],
      matchingRows: [11, 107, 125, 1900],
    })).toEqual([11, 107, 1900])
  })

  it('rejects arbitrary query keys, nested values and invalid explicit rows', () => {
    expect(() => parseImporterV2PublicationSelection({
      mode: 'QUERY', filters: { customer: { not: 'anything' } },
    })).toThrow()
    expect(() => parseImporterV2PublicationSelection({
      mode: 'QUERY', filters: { batchId: 'other-batch' },
    })).toThrow()
    expect(() => parseImporterV2PublicationSelection({
      mode: 'ROWS', rowNumbers: [0, 2],
    })).toThrow()
    expect(() => parseImporterV2PublicationSelection({
      mode: 'ROWS', rowNumbers: [],
    })).toThrow()
  })

  it('defers every shared-serial HA candidate and preserves other devices', () => {
    const candidates = [2, 7, 8, 22, 100]
    // These row numbers are synthetic: both sides of a collision are blocked,
    // not arbitrarily picking the first observed member as the winner.
    expect(withoutImporterV2ConflictingRows(candidates, [7, 8]))
      .toEqual([2, 22, 100])
    expect(withoutImporterV2ConflictingRows([7, 8], [7, 8]))
      .toEqual([])
  })

  it('keeps the requested candidate ordering and ignores unmatched conflict rows', () => {
    expect(eligibleImporterV2PublicationRows({
      candidates: [8, 16, 25, 92],
      matchingRows: [25, 8, 200],
    })).toEqual([8, 25])
  })
})
