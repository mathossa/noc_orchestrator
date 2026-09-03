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
    expect(model.metadata).toMatchObject({ vendorSourceValue: 'Fortinet', deviceTypeSourceValue: 'Firewall', deviceTypeSourceValues: ['Firewall'] })
    expect(firmware.contextKey).toBe('vendor:fortinet|model:fortinet fortigate-100f|platform:')
  })

  it('collapses the same Vendor + Model even when upstream Device Type labels differ', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      { rowNumber: 2, values: values({ vendor: 'Cisco', deviceType: 'Switch', model: 'Cisco WS-C2960X-24PS-L' }) },
      { rowNumber: 3, values: values({ vendor: 'Cisco', deviceType: 'Stack', model: 'Cisco WS-C2960X-24PS-L' }) },
      { rowNumber: 4, values: values({ vendor: 'Cisco', deviceType: 'Switches', model: 'Cisco WS-C2960X-24PS-L' }) },
    ], options)

    const models = references.filter((reference) => reference.kind === 'DEVICE_MODEL')
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      sourceValue: 'Cisco WS-C2960X-24PS-L',
      contextKey: 'vendor:cisco',
      occurrenceCount: 3,
      metadata: {
        vendorSourceValue: 'Cisco',
        deviceTypeSourceValue: 'Switch',
        deviceTypeSourceValues: ['Switch', 'Stack', 'Switches'],
        rowNumbers: [2, 3, 4],
      },
    })
  })

  it('keeps raw Software Version evidence on Firmware references for profile rules', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      { rowNumber: 2, values: values({ vendor: 'Cisco', model: 'C9300-24P', currentFirmware: '17.12.04', softwareVersion: 'Dublin 17.12.04' }) },
    ], options)

    expect(references.find((reference) => reference.kind === 'FIRMWARE_RELEASE')?.metadata).toMatchObject({
      softwareVersionSourceValue: 'Dublin 17.12.04',
      softwareVersionSourceValues: ['Dublin 17.12.04'],
    })
  })

  it('keeps site identity customer-scoped when the same site label occurs under multiple organizations', () => {
    const references = buildDeviceImportStagedReferenceSeeds([
      { rowNumber: 2, values: values({ customer: 'Customer A', site: 'Main' }) },
      { rowNumber: 3, values: values({ customer: 'Customer B', site: 'Main' }) },
    ], options)

    expect(references.filter((reference) => reference.kind === 'SITE')).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceValue: 'Main', contextKey: 'customer:customer a' }),
      expect.objectContaining({ sourceValue: 'Main', contextKey: 'customer:customer b' }),
    ]))
  })

  it('replaces generic upstream Site placeholders with the split Organization/Site location before staging', () => {
    const rows = [
      { rowNumber: 2, values: values({ organizationSite: 'Unica Groep - UICTS Working Spirit Deventer', customer: 'Unica Groep', site: 'Open internet' }) },
      { rowNumber: 3, values: values({ organizationSite: 'Unica Groep - Zwolle', customer: 'Unica Groep', site: 'Open internet' }) },
    ]

    const references = buildDeviceImportStagedReferenceSeeds(rows, options)
    const sites = references.filter((reference) => reference.kind === 'SITE')

    expect(rows[0].values.site).toBe('UICTS Working Spirit Deventer')
    expect(rows[1].values.site).toBe('Zwolle')
    expect(sites).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceValue: 'UICTS Working Spirit Deventer',
        contextKey: 'organization-site:unica groep - uicts working spirit deventer',
      }),
      expect.objectContaining({
        sourceValue: 'Zwolle',
        contextKey: 'organization-site:unica groep - zwolle',
      }),
    ]))
  })

  it('offers a strong suggestion for punctuation/prefix variations but does not call weak matches strong', () => {
    expect(importReferenceSimilarity('Fortinet FortiGate-100F', 'Fortinet FortiGate 100F')).toBeGreaterThan(0.9)
    expect(importReferenceSimilarity('Firewall', 'Wireless Access Point')).toBeLessThan(0.55)

    const best = bestImportReferenceSuggestion(
      'Fortinet FortiGate-100F',
      [{ id: '100f', label: 'Fortinet FortiGate 100F' }, { id: 'switch', label: 'Aruba 2530 Switch' }],
      (candidate) => candidate.label,
    )
    expect(best?.candidate.id).toBe('100f')
  })
})
