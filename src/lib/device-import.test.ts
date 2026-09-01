import { describe, expect, it } from 'vitest'
import {
  detectHeaderRow,
  headersFromRow,
  mappedRows,
  parseDeviceImportOptions,
  suggestColumnMapping,
  DeviceImportValidationError,
} from '@/lib/device-import'
import type { XlsxSheet } from '@/lib/xlsx-reader'

const sheet: XlsxSheet = {
  name: 'Inventory',
  rowCount: 4,
  columnCount: 5,
  rows: [
    { rowNumber: 1, values: ['Customer device export', '', '', '', ''] },
    { rowNumber: 2, values: ['Hostname', 'Vendor', 'Model', 'IP Address', 'Firmware'] },
    { rowNumber: 3, values: ['sw-01', 'Aruba', '2530-24G', '10.0.0.1', '16.11.0031'] },
    { rowNumber: 4, values: ['sw-02', 'Aruba', '2530-48G', '10.0.0.2', '16.11.0031'] },
  ],
}

describe('device XLSX import mapping', () => {
  it('detects a likely inventory header row and suggests common mappings', () => {
    expect(detectHeaderRow(sheet.rows)).toBe(2)
    const headers = headersFromRow(sheet.rows[1], sheet.columnCount)
    expect(suggestColumnMapping(headers)).toEqual({
      '0': 'hostname',
      '1': 'vendor',
      '2': 'model',
      '3': 'managementAddress',
      '4': 'currentFirmware',
    })
  })

  it('extracts mapped non-empty data rows after the selected header', () => {
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 2,
      mapping: { '0': 'hostname', '2': 'model', '4': 'currentFirmware' },
      defaults: { customerId: 'customer-1' },
    })

    expect(mappedRows(sheet, options)).toEqual([
      {
        rowNumber: 3,
        values: expect.objectContaining({ hostname: 'sw-01', model: '2530-24G', currentFirmware: '16.11.0031' }),
      },
      {
        rowNumber: 4,
        values: expect.objectContaining({ hostname: 'sw-02', model: '2530-48G', currentFirmware: '16.11.0031' }),
      },
    ])
  })

  it('rejects mapping the same destination field more than once', () => {
    expect(() => parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 2,
      mapping: { '0': 'hostname', '1': 'hostname' },
      defaults: {},
    })).toThrow(DeviceImportValidationError)
  })
})
