import { describe, expect, it } from 'vitest'
import { suggestImporterV2ColumnMappings } from '@/lib/importer-v2-xlsx'

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
})
