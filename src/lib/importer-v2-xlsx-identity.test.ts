import { describe, expect, it } from 'vitest'
import {
  mappedImporterV2Rows,
  suggestImporterV2ColumnMappings,
} from '@/lib/importer-v2-xlsx'
import type { XlsxSheet } from '@/lib/xlsx-reader'

describe('Importer v2 XLSX identity column safety', () => {
  it('does not guess generic ID or Device ID columns are device identities', () => {
    const mappings = suggestImporterV2ColumnMappings([
      'Organization Name',
      'ID',
      'Device ID',
      'Device Name',
      'Serial Number',
    ])

    expect(mappings).not.toContainEqual(
      expect.objectContaining({ targetField: 'sourceId' }),
    )
    expect(mappings).toContainEqual(
      expect.objectContaining({ columnIndex: 3, targetField: 'deviceName' }),
    )
    expect(mappings).toContainEqual(
      expect.objectContaining({ columnIndex: 4, targetField: 'serialNumber' }),
    )
  })

  it('still maps an explicitly named Source ID column', () => {
    const mappings = suggestImporterV2ColumnMappings([
      'Source ID',
      'Device Name',
      'Serial Number',
    ])

    expect(mappings).toContainEqual(
      expect.objectContaining({ columnIndex: 0, targetField: 'sourceId' }),
    )
  })

  it('ignores an unsafe historical ID-to-sourceId mapping from a saved profile', () => {
    const sheet: XlsxSheet = {
      name: 'Devices',
      rowCount: 2,
      columnCount: 3,
      rows: [
        { rowNumber: 1, values: ['ID', 'Device Name', 'Serial Number'] },
        { rowNumber: 2, values: ['445102676lj30', '071SWI0201.vanmirelo.local', 'FOC2231V3CX'] },
      ],
    }

    const rows = mappedImporterV2Rows({
      sheet,
      headerRow: 1,
      mappings: [
        { columnIndex: 0, sourceHeader: 'ID', targetField: 'sourceId' },
        { columnIndex: 1, sourceHeader: 'Device Name', targetField: 'deviceName' },
        { columnIndex: 2, sourceHeader: 'Serial Number', targetField: 'serialNumber' },
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].rawValues.sourceId).toBeUndefined()
    expect(rows[0].rawValues.deviceName).toBe('071SWI0201.vanmirelo.local')
    expect(rows[0].rawValues.serialNumber).toBe('FOC2231V3CX')
    expect(rows[0].sourceRecordKey).toBe('FOC2231V3CX')
  })
})
