import { describe, expect, it } from 'vitest'
import {
  XLSX_INVENTORY_ADAPTER_TYPE,
  xlsxInventorySourceAdapter,
} from '@/lib/importer-v2-xlsx-adapter'
import { suggestImporterV2ColumnMappings } from '@/lib/importer-v2-xlsx'
import type { XlsxSheet } from '@/lib/xlsx-reader'

describe('Importer v2 XLSX source adapter', () => {
  it('uses the generic source boundary while preserving XLSX mapping and raw evidence', async () => {
    const sheet: XlsxSheet = {
      name: 'Devices',
      rowCount: 2,
      columnCount: 4,
      rows: [
        {
          rowNumber: 1,
          values: ['Customer', 'Device Name', 'Serial Number', 'Firmware Version'],
        },
        {
          rowNumber: 2,
          values: ['Example', 'SW01', 'SER-1', '17.15.5'],
        },
      ],
    }
    const headers = sheet.rows[0].values
    const mappings = suggestImporterV2ColumnMappings(headers)

    const result = await xlsxInventorySourceAdapter.loadAndNormalize({
      source: {
        provider: 'AUVIK',
        adapterType: XLSX_INVENTORY_ADAPTER_TYPE,
        sourceAdapterId: 'auvik-xlsx',
        name: 'auvik-export.xlsx',
        enabled: true,
        configuration: {},
        metadata: { fileName: 'auvik-export.xlsx' },
      },
      input: {
        sheet,
        headerRow: 1,
        headers,
        mappings,
      },
    })

    expect(result.source).toMatchObject({
      provider: 'AUVIK',
      adapterType: 'xlsx',
      sourceAdapterId: 'auvik-xlsx',
    })
    expect(result.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        sourceRecordKey: 'SER-1',
        rawValues: expect.objectContaining({
          customer: 'Example',
          deviceName: 'SW01',
          serialNumber: 'SER-1',
          firmwareVersion: '17.15.5',
        }),
        sourceEvidence: {
          Customer: 'Example',
          'Device Name': 'SW01',
          'Serial Number': 'SER-1',
          'Firmware Version': '17.15.5',
        },
      }),
    ])
  })
})
