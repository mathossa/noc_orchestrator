import { describe, expect, it } from 'vitest'
import { parseDeviceImportOptions, type DeviceImportField } from '@/lib/device-import'
import {
  bestImportReferenceSuggestion,
  buildDeviceImportStagedReferenceSeeds,
  importReferenceSimilarity,
} from '@/lib/device-import-staging'

function values(overrides: Partial<Record<DeviceImportField, string | null>>) {
  const fields: DeviceImportField[] = [
    'organizationSite', 'customer', 'site', 'name', 'hostname', 'serialNumber', 'vendor', 'model', 'deviceType',
    'managementAddress', 'currentFirmware', 'firmwareVersion', 'softwareVersion', 'contract', 'externalProvider', 'externalId', 'notes',
  ]
  return Object.fromEntries(fields.map((field) => [field, overrides[field] ?? null])) as Record<DeviceImportField, string | null>
}

const options = parseDeviceImportOptions({
  sheetName: 'Devices',
  headerRow: 1,
  mapping: { '0': 'hostname' },
  defaults: {},
  resolutions: {},
})

describe('staged device import references', () => {
  it('collapses repeated raw values into one staged reference with dependency context', () => {
    const rows = [
      { rowNumber: 2, values: values({ customer: 'Unica Groep', site: 'Deventer', vendor: 'Fortinet', deviceType: 'Firewall', model: 'Fortinet FortiGate-100F', currentFirmware: '7.4.12' }) },
      { rowNumber: 3, values: values({ customer: 'Unica Groep', site: 'Deventer', vendor: 'Fortinet', deviceType: 'Firewall', model: 'Fortinet FortiGate-100F', currentFirmware: '7.4.12' }) },
    ]

    const references = buildDeviceImportStagedReferenceSeeds(rows, options)
    const customer = references.find((reference) => reference.kind === 'CUSTOMER')!
    const site = references.find((reference) => reference.kind === 'SITE')!
    const model = references.find((reference) => reference.kind === 'DEVICE_MODEL')!
    const firmware = references.find((reference) => reference.kind === 'FIRMWARE_RELEASE')!

    expect(customer).toMatchObject({ sourceValue: 'Unica Groep', occurrenceCount: 2, contextKey: '' })
    expect(site).toMatchObject({ sourceValue: 'Deventer', occurrenceCount: 2, contextKey: 'customer:unica groep' })
    expect(site.metadata).toMatchObject({ customerSourceValue: 'Unica Groep', rowNumbers: [2, 3] })
    expect(model.contextKey).toBe('vendor:fortinet')
    expect(model.metadata).toMatchObject({ vendorSourceValue: 'Fortinet', deviceTypeSourceValue: 'Firewall', deviceTypeSourceValues: ['Firewall'], platform: 'FortiOS' })
    expect(firmware.contextKey).toBe('vendor:fortinet|model:fortinet fortigate-100f|platform:fortios')
  })

  it('keeps the same raw Firmware Version separate when Software Version differs', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      {
        rowNumber: 2,
        values: values({
          vendor: 'HP',
          model: 'HP 2530-24G',
          platform: 'AOS-S',
          currentFirmware: 'WC.16.01.0010',
          firmwareVersion: 'WC.16.01.0010',
          softwareVersion: 'WC.16.01.0020',
        }),
      },
      {
        rowNumber: 3,
        values: values({
          vendor: 'HP',
          model: 'HP 2530-24G',
          platform: 'AOS-S',
          currentFirmware: 'WC.16.01.0010',
          firmwareVersion: 'WC.16.01.0010',
          softwareVersion: 'WC.16.01.0030',
        }),
      },
    ], options)

    const firmware = references.filter((reference) => reference.kind === 'FIRMWARE_RELEASE')
    expect(firmware).toHaveLength(2)
    expect(new Set(firmware.map((reference) => reference.contextKey)).size).toBe(2)
    expect(firmware.map((reference) => reference.metadata.softwareVersionSourceValue).sort()).toEqual([
      'WC.16.01.0020',
      'WC.16.01.0030',
    ])
  })

  it('collapses the same Vendor + Model even when upstream Device Type labels differ', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      { rowNumber: 2, values: values({ vendor: 'Cisco', deviceType: 'Switch', model: 'Cisco WS-C2960X-24PS-L' }) },
      { rowNumber: 3, values: values({ vendor: 'Cisco', deviceType: 'Stack', model: 'Cisco WS-C2960X-24PS-L' }) },
    ], options)

    const models = references.filter((reference) => reference.kind === 'DEVICE_MODEL')
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ contextKey: 'vendor:cisco', occurrenceCount: 2 })
    expect(models[0].metadata.deviceTypeSourceValues).toEqual(['Switch', 'Stack'])
  })

  it('keeps raw Software Version evidence on Firmware references for profile rules', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      {
        rowNumber: 2,
        values: values({
          vendor: 'Cisco',
          model: 'Cisco SG350-28P',
          currentFirmware: '2.5.18',
          firmwareVersion: '2.5.18',
          softwareVersion: '2.5.0.83',
        }),
      },
    ], options)

    const firmware = references.find((reference) => reference.kind === 'FIRMWARE_RELEASE')!
    expect(firmware.metadata).toMatchObject({
      firmwareVersionSourceValue: '2.5.18',
      softwareVersionSourceValue: '2.5.0.83',
    })
  })

  it('keeps site identity customer-scoped when the same site label occurs under multiple organizations', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      { rowNumber: 2, values: values({ customer: 'Customer A', site: 'Amsterdam' }) },
      { rowNumber: 3, values: values({ customer: 'Customer B', site: 'Amsterdam' }) },
    ], options)

    const sites = references.filter((reference) => reference.kind === 'SITE')
    expect(sites).toHaveLength(2)
    expect(new Set(sites.map((reference) => reference.contextKey))).toEqual(new Set([
      'customer:customer a',
      'customer:customer b',
    ]))
  })

  it('replaces generic upstream Site placeholders with the split Organization/Site location before staging', () => {
    const splitOptions = parseDeviceImportOptions({
      sheetName: 'Devices',
      headerRow: 1,
      mapping: { '0': 'hostname' },
      defaults: {},
      resolutions: {},
      organizationSiteDelimiter: ' - ',
    })
    const rows = [{
      rowNumber: 2,
      values: values({ organizationSite: 'DHL - eCom Alkmaar', customer: 'DHL', site: 'Unknown' }),
    }]

    const references = buildDeviceImportStagedReferenceSeeds(rows, splitOptions)
    const site = references.find((reference) => reference.kind === 'SITE')!
    expect(site.sourceValue).toBe('eCom Alkmaar')
    expect(rows[0].values.site).toBe('eCom Alkmaar')
  })

  it('offers a strong suggestion for punctuation/prefix variations but does not call weak matches strong', () => {
    expect(importReferenceSimilarity('Cisco WS-C2960X-24PS-L', 'WS C2960X 24PS L')).toBeGreaterThan(0.9)
    expect(importReferenceSimilarity('AP-515', 'AP-505')).toBeLessThan(0.9)
    expect(bestImportReferenceSuggestion('Cisco WS-C2960X-24PS-L', [
      { id: 'one', label: 'WS C2960X 24PS L' },
      { id: 'two', label: 'C9300-24P' },
    ])).toMatchObject({ targetId: 'one' })
  })
})
