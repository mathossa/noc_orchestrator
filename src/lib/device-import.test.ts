import { describe, expect, it } from 'vitest'
import {
  detectHeaderRow,
  extractFirmwareVersion,
  headersFromRow,
  importResolutionKey,
  mappedRows,
  parseDeviceImportOptions,
  splitOrganizationSite,
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

  it('recognizes Auvik organization, firmware, and software version columns independently', () => {
    expect(suggestColumnMapping(['Organization Name', 'Firmware Version', 'Software Version'])).toEqual({
      '0': 'organizationSite',
      '1': 'firmwareVersion',
      '2': 'softwareVersion',
    })
  })

  it('splits an Organization - Site value using the final delimiter', () => {
    expect(splitOrganizationSite('Unica Groep - UICTS Working Spirit Deventer')).toEqual({
      customer: 'Unica Groep',
      site: 'UICTS Working Spirit Deventer',
    })
  })

  it('extracts firmware versions from verbose Auvik software strings', () => {
    expect(extractFirmwareVersion('FortiGate-100F v7.4.12,build2902,250701 (GA.M)')).toBe('7.4.12')
    expect(extractFirmwareVersion('S424EF-v7.4.9-build946,260122 (GA)')).toBe('7.4.9')
    expect(extractFirmwareVersion('FP231G-v7.4.7-build0802')).toBe('7.4.7')
  })

  it('prefers Firmware Version over Software Version when both are mapped', () => {
    const auvikSheet: XlsxSheet = {
      name: 'Inventory',
      rowCount: 2,
      columnCount: 3,
      rows: [
        { rowNumber: 1, values: ['Organization Name', 'Firmware Version', 'Software Version'] },
        { rowNumber: 2, values: ['Acme - Amsterdam', '7.4.12', 'FortiGate-100F v7.4.11,build1234'] },
      ],
    }
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 1,
      mapping: { '0': 'organizationSite', '1': 'firmwareVersion', '2': 'softwareVersion' },
      defaults: {},
    })

    expect(mappedRows(auvikSheet, options)[0].values).toMatchObject({
      customer: 'Acme',
      site: 'Amsterdam',
      currentFirmware: '7.4.12',
    })
  })

  it('uses Software Version as firmware fallback when Firmware Version is absent', () => {
    const auvikSheet: XlsxSheet = {
      name: 'Inventory',
      rowCount: 2,
      columnCount: 2,
      rows: [
        { rowNumber: 1, values: ['Hostname', 'Software Version'] },
        { rowNumber: 2, values: ['fw-01', 'S448EN-v7.4.9-build946,260122 (GA)'] },
      ],
    }
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 1,
      mapping: { '0': 'hostname', '1': 'softwareVersion' },
      defaults: {},
    })

    expect(mappedRows(auvikSheet, options)[0].values.currentFirmware).toBe('7.4.9')
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

  it('keeps one-time reference resolutions in the validated import options', () => {
    const key = importResolutionKey('DEVICE_MODEL', 'Fortinet FortiGate-100F', 'vendor-fortinet')
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 2,
      mapping: { '0': 'hostname', '2': 'model' },
      defaults: { customerId: 'customer-1' },
      resolutions: { [key]: 'model-100f', ignored: '' },
    })

    expect(options.resolutions).toEqual({ [key]: 'model-100f' })
  })

  it('accepts header rows beyond the former 5,000-row application cap', () => {
    const options = parseDeviceImportOptions({
      sheetName: 'Inventory',
      headerRow: 6000,
      mapping: { '0': 'hostname' },
      defaults: {},
    })
    expect(options.headerRow).toBe(6000)
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
