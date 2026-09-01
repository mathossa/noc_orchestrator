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
    expect(model.contextKey).toBe('vendor:fortinet|type:firewall')
    expect(model.metadata).toMatchObject({ vendorSourceValue: 'Fortinet', deviceTypeSourceValue: 'Firewall' })
    expect(firmware.contextKey).toBe('vendor:fortinet|model:fortinet fortigate-100f')
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
