import { describe, expect, it } from 'vitest'
import {
  extractFirmwareVersion,
  mappedRows,
  parseDeviceImportOptions,
} from '@/lib/device-import'
import { buildDeviceImportStagedReferenceSeeds } from '@/lib/device-import-staging'
import type { XlsxSheet } from '@/lib/xlsx-reader'

describe('firmware import regressions', () => {
  it('preserves complete standalone and labelled vendor firmware versions', () => {
    expect(extractFirmwareVersion('15.2(7)E13')).toBe('15.2(7)E13')
    expect(extractFirmwareVersion('12.2(53)SE2')).toBe('12.2(53)SE2')
    expect(extractFirmwareVersion('YA.16.11.0021')).toBe('YA.16.11.0021')
    expect(
      extractFirmwareVersion(
        'Cisco IOS Software, C2960X Software, Version 15.2(7)E13, RELEASE SOFTWARE',
      ),
    ).toBe('15.2(7)E13')
  })

  it('keeps placeholder firmware unknown instead of creating a fake release and infers Meraki platform', () => {
    const sheet: XlsxSheet = {
      name: 'Inventory',
      rowCount: 2,
      columnCount: 4,
      rows: [
        { rowNumber: 1, values: ['Vendor', 'Model', 'Firmware Version', 'Software Version'] },
        { rowNumber: 2, values: ['Meraki', 'Meraki MS225-24P', '0', ''] },
      ],
    }
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 1,
      mapping: { '0': 'vendor', '1': 'model', '2': 'firmwareVersion', '3': 'softwareVersion' },
      defaults: {},
    })
    const rows = mappedRows(sheet, options)

    expect(rows[0].values).toMatchObject({
      firmwareVersion: '0',
      currentFirmware: null,
      platform: 'Meraki',
    })
    expect(
      buildDeviceImportStagedReferenceSeeds(rows, options).some(
        (reference) => reference.kind === 'FIRMWARE_RELEASE',
      ),
    ).toBe(false)
  })

  it('still replaces a placeholder with a meaningful raw Software Version', () => {
    const sheet: XlsxSheet = {
      name: 'Inventory',
      rowCount: 2,
      columnCount: 2,
      rows: [
        { rowNumber: 1, values: ['Firmware Version', 'Software Version'] },
        { rowNumber: 2, values: ['0.1', 'Cupertino 17.09.05'] },
      ],
    }
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 1,
      mapping: { '0': 'firmwareVersion', '1': 'softwareVersion' },
      defaults: {},
    })

    expect(mappedRows(sheet, options)[0].values.currentFirmware).toBe('17.09.05')
  })
})
