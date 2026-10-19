import { describe, expect, it } from 'vitest'
import {
  eligibleImporterV2PublicationRows,
  parseImporterV2PublicationSelection,
  withoutImporterV2ConflictingRows,
} from '@/lib/importer-v2-publication-selection'

describe('scoped publication selection safety', () => {
  it('preserves explicit selection without extending it to other valid batch rows', () => {
    expect(
      parseImporterV2PublicationSelection({
        mode: 'ROWS',
        rowNumbers: [26, 25, 26],
      }),
    ).toEqual({ mode: 'ROWS', rowNumbers: [25, 26] })

    expect(
      eligibleImporterV2PublicationRows({
        candidates: [25, 26, 43, 82, 89],
        matchingRows: [25, 26],
      }),
    ).toEqual([25, 26])
  })

  it('intersects filtered results across all pages with eligible rows only', () => {
    const selected = parseImporterV2PublicationSelection({
      mode: 'QUERY',
      filters: { vendor: 'Fortinet', issue: 'NONE' },
    })
    expect(selected).toEqual({
      mode: 'QUERY',
      filters: { vendor: 'Fortinet', issue: 'NONE' },
    })

    expect(
      eligibleImporterV2PublicationRows({
        candidates: [1, 9, 11, 107, 1900],
        matchingRows: [11, 107, 125, 1900],
      }),
    ).toEqual([11, 107, 1900])
  })

  it('defers every conflicting sibling and preserves the remaining selected rows', () => {
    expect(
      withoutImporterV2ConflictingRows(
        [2, 7, 8, 22, 100],
        [7, 8],
      ),
    ).toEqual([2, 22, 100])

    expect(
      withoutImporterV2ConflictingRows([7, 8], [7, 8]),
    ).toEqual([])
  })

  it('rejects arbitrary query keys, nested values and invalid explicit rows', () => {
    expect(() =>
      parseImporterV2PublicationSelection({
        mode: 'QUERY',
        filters: { customer: { not: 'anything' } },
      }),
    ).toThrow()

    expect(() =>
      parseImporterV2PublicationSelection({
        mode: 'QUERY',
        filters: { batchId: 'other-batch' },
      }),
    ).toThrow()

    expect(() =>
      parseImporterV2PublicationSelection({
        mode: 'ROWS',
        rowNumbers: [0, 2],
      }),
    ).toThrow()

    expect(() =>
      parseImporterV2PublicationSelection({
        mode: 'ROWS',
        rowNumbers: [],
      }),
    ).toThrow()
  })
})
