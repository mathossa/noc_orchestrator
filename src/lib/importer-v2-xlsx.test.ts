import { describe, expect, it } from 'vitest'
import {
  detectImporterV2HeaderRow,
  importerV2HeadersFromRow,
  mappedImporterV2Rows,
  suggestImporterV2ColumnMappings,
} from '@/lib/importer-v2-xlsx'
import type { XlsxSheet } from '@/lib/xlsx-reader'

describe('Importer v2 XLSX ingestion helpers', () => {
  const sheet: XlsxSheet = {
    name: 'Devices',
    rowCount: 4,
    columnCount: 7,
    rows: [
      { rowNumber: 1, values: ['Inventory export', '', '', '', '', '', ''] },
      {
        rowNumber: 2,
        values: [
          'Organization Name',
          'Device Name',
          'Serial Number',
          'Vendor',
          'Make & Model',
          'Firmware Version',
          'Software Version',
        ],
      },
      {
        rowNumber: 3,
        values: [
          'DHL - eCom - Alkmaar',
          'switch-1',
          'SER-1',
          'Cisco',
          'C9300-24P',
          '17.5(1r)',
          'Cisco IOS XE Software, Version 17.12.05',
        ],
      },
      { rowNumber: 4, values: ['', '', '', '', '', '', ''] },
    ],
  }

  it('detects an Auvik-style header row and maps known source columns', () => {
    const headerRow = detectImporterV2HeaderRow(sheet.rows)
    const headers = importerV2HeadersFromRow(
      sheet.rows.find((row) => row.rowNumber === headerRow),
      sheet.columnCount,
    )
    const mappings = suggestImporterV2ColumnMappings(headers)

    expect(headerRow).toBe(2)
    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ columnIndex: 0, targetField: 'customer' }),
        expect.objectContaining({ columnIndex: 1, targetField: 'deviceName' }),
        expect.objectContaining({ columnIndex: 2, targetField: 'serialNumber' }),
        expect.objectContaining({ columnIndex: 3, targetField: 'vendor' }),
        expect.objectContaining({ columnIndex: 4, targetField: 'model' }),
        expect.objectContaining({ columnIndex: 5, targetField: 'firmwareVersion' }),
        expect.objectContaining({ columnIndex: 6, targetField: 'softwareVersion' }),
      ]),
    )
  })

  it('materializes mapped data rows without inventing ignored source values', () => {
    const headers = importerV2HeadersFromRow(sheet.rows[1], sheet.columnCount)
    const mappings = suggestImporterV2ColumnMappings(headers)
    const rows = mappedImporterV2Rows({ sheet, headerRow: 2, mappings })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      rowNumber: 3,
      rawValues: {
        customer: 'DHL - eCom - Alkmaar',
        deviceName: 'switch-1',
        serialNumber: 'SER-1',
        vendor: 'Cisco',
        model: 'C9300-24P',
        firmwareVersion: '17.5(1r)',
        softwareVersion: 'Cisco IOS XE Software, Version 17.12.05',
      },
    })
    expect(rows[0].rawValues.notes).toBeUndefined()
  })
})
