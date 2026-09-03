import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/device-import-store', () => ({ commitDeviceImport: vi.fn(), previewDeviceImport: vi.fn() }))

import { DEVICE_IMPORT_FIELDS, type DeviceImportField } from '@/lib/device-import'
import {
  firmwareEvidenceGroupsForReference,
  hasCompetingFirmwareSourceEvidence,
  shouldInspectFirmwareSourceSplit,
  stagedFirmwareEvidenceContext,
  stagedFirmwareLegacyRawContext,
} from '@/lib/device-import-staged-firmware-platforms'
import { firmwareValuesForPublication } from '@/lib/device-import-staged-publication'
import type { DeviceImportMappedValues } from '@/lib/device-import-staging'

function values(overrides: Partial<Record<DeviceImportField, string | null>>): DeviceImportMappedValues {
  return Object.fromEntries(DEVICE_IMPORT_FIELDS.map((field) => [field, overrides[field] ?? null])) as DeviceImportMappedValues
}

describe('firmware source fan-out', () => {
  const row20 = values({
    vendor: 'HP',
    model: 'HP 2530-24G',
    platform: 'AOS-S',
    currentFirmware: 'WC.16.01.0010',
    firmwareVersion: 'WC.16.01.0010',
    softwareVersion: 'WC.16.01.0020',
  })
  const row30 = values({
    vendor: 'HP',
    model: 'HP 2530-24G',
    platform: 'AOS-S',
    currentFirmware: 'WC.16.01.0010',
    firmwareVersion: 'WC.16.01.0010',
    softwareVersion: 'WC.16.01.0030',
  })

  it('always inspects legacy firmware references instead of trusting incomplete collapsed metadata', () => {
    expect(shouldInspectFirmwareSourceSplit({
      kind: 'FIRMWARE_RELEASE',
      contextKey: stagedFirmwareLegacyRawContext(row20),
    })).toBe(true)
    expect(shouldInspectFirmwareSourceSplit({
      kind: 'FIRMWARE_RELEASE',
      contextKey: stagedFirmwareEvidenceContext(row20),
    })).toBe(false)
  })

  it('splits one raw Firmware Version into separate source-evidence groups', () => {
    const legacy = {
      normalizedSourceValue: 'wc.16.01.0010',
      contextKey: stagedFirmwareLegacyRawContext(row20),
    }
    const groups = firmwareEvidenceGroupsForReference(legacy, [
      { rowNumber: 2, values: row20 },
      { rowNumber: 3, values: row30 },
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.contextKey)).toEqual(expect.arrayContaining([
      stagedFirmwareEvidenceContext(row20),
      stagedFirmwareEvidenceContext(row30),
    ]))
  })

  it('keeps competing Firmware/Software evidence unresolved until source-selection rules run', () => {
    expect(hasCompetingFirmwareSourceEvidence('WC.16.01.0010', {
      firmwareVersionSourceValue: 'WC.16.01.0010',
      softwareVersionSourceValue: 'WC.16.01.0020',
    })).toBe(true)
  })

  it('publishes each device row with the firmware release selected from its own Software Version', () => {
    const references = [
      {
        kind: 'FIRMWARE_RELEASE',
        normalizedSourceValue: 'wc.16.01.0010',
        contextKey: stagedFirmwareEvidenceContext(row20),
        resolutionSource: 'CREATED',
        targetId: 'release-20',
        metadata: { platform: 'AOS-S' },
      },
      {
        kind: 'FIRMWARE_RELEASE',
        normalizedSourceValue: 'wc.16.01.0010',
        contextKey: stagedFirmwareEvidenceContext(row30),
        resolutionSource: 'CREATED',
        targetId: 'release-30',
        metadata: { platform: 'AOS-S' },
      },
    ]
    const targets = [
      { id: 'release-20', vendorId: 'vendor-hp', platform: 'AOS-S', version: 'WC.16.01.0020' },
      { id: 'release-30', vendorId: 'vendor-hp', platform: 'AOS-S', version: 'WC.16.01.0030' },
    ]

    expect(firmwareValuesForPublication(row20, references, targets)).toEqual({
      currentFirmware: 'WC.16.01.0020',
      platform: 'AOS-S',
    })
    expect(firmwareValuesForPublication(row30, references, targets)).toEqual({
      currentFirmware: 'WC.16.01.0030',
      platform: 'AOS-S',
    })
  })
})
