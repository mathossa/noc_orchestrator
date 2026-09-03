import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/device-import-store', () => ({
  commitDeviceImport: vi.fn(),
  previewDeviceImport: vi.fn(),
  reviewDeviceImportBlockers: vi.fn(),
}))

import { DEVICE_IMPORT_FIELDS, type DeviceImportField } from '@/lib/device-import'
import {
  isUnclassifiedFirmwareRow,
  modelValuesForPublication,
  publicationResolutionContext,
} from '@/lib/device-import-staged-publication'
import type { DeviceImportMappedValues } from '@/lib/device-import-staging'

function values(overrides: Partial<Record<DeviceImportField, string | null>>): DeviceImportMappedValues {
  return Object.fromEntries(DEVICE_IMPORT_FIELDS.map((field) => [field, overrides[field] ?? null])) as DeviceImportMappedValues
}

describe('staged publication resolution contexts', () => {
  it('uses the canonical Site customer instead of stale staged metadata', () => {
    expect(publicationResolutionContext(
      'SITE',
      { customerTargetId: 'stale-customer' },
      { customerId: 'canonical-customer' },
    )).toBe('canonical-customer')
  })

  it('uses the canonical Model vendor instead of stale staged metadata', () => {
    expect(publicationResolutionContext(
      'DEVICE_MODEL',
      { vendorTargetId: 'stale-vendor' },
      { vendorId: 'canonical-vendor' },
    )).toBe('canonical-vendor')
  })

  it('uses the canonical Firmware vendor and platform instead of stale staged metadata', () => {
    expect(publicationResolutionContext(
      'FIRMWARE_RELEASE',
      { vendorTargetId: 'stale-vendor', platform: 'IOS' },
      { vendorId: 'canonical-vendor', platform: 'IOS-XE' },
    )).toBe('canonical-vendor|ios-xe')
  })

  it('keeps metadata as a backwards-compatible fallback when no canonical target is available', () => {
    expect(publicationResolutionContext(
      'DEVICE_MODEL',
      { vendorTargetId: 'legacy-vendor' },
    )).toBe('legacy-vendor')
  })
})

describe('staged publication canonical model identity', () => {
  it('replaces stale source vendor/type/model values with the accepted canonical model values', () => {
    const source = values({
      vendor: 'HP',
      deviceType: 'Stack',
      model: 'HP 2930F-24G-PoE+-4SFP',
    })
    const references = [{
      kind: 'DEVICE_MODEL',
      normalizedSourceValue: 'hp 2930f-24g-poe+-4sfp',
      contextKey: 'vendor:hp',
      resolutionSource: 'USER',
      targetId: 'model-1',
      metadata: { vendorSourceValue: 'HP' },
    }]
    const targets = [{
      id: 'model-1',
      vendorId: 'vendor-hpe',
      model: '2930F-24G-PoE+-4SFP',
      vendor: { name: 'HPE Networking' },
      deviceType: { name: 'Switch' },
    }]

    expect(modelValuesForPublication(source, references, targets)).toEqual({
      vendor: 'HPE Networking',
      model: '2930F-24G-PoE+-4SFP',
      deviceType: 'Switch',
    })
  })

  it('keeps source values when there is no accepted model target', () => {
    const source = values({ vendor: 'HP', deviceType: 'Stack', model: 'Unknown 24G' })
    expect(modelValuesForPublication(source, [], [])).toEqual({
      vendor: 'HP',
      model: 'Unknown 24G',
      deviceType: 'Stack',
    })
  })
})

describe('staged publication with unclassified firmware', () => {
  const references = [{
    kind: 'FIRMWARE_RELEASE',
    normalizedSourceValue: '09.8',
    contextKey: 'vendor:apc|model:smart-ups 1000 rm|platform:',
    resolutionSource: 'UNCLASSIFIED_NO_PLATFORM',
  }]

  it('recognizes a platform-less observed firmware value that was intentionally deferred', () => {
    expect(isUnclassifiedFirmwareRow(values({
      vendor: 'APC',
      model: 'Smart-UPS 1000 RM',
      currentFirmware: '09.8',
    }), references)).toBe(true)
  })

  it('does not suppress firmware for another model or an explicitly classified platform', () => {
    expect(isUnclassifiedFirmwareRow(values({
      vendor: 'APC',
      model: 'Smart-UPS 1500 RM',
      currentFirmware: '09.8',
    }), references)).toBe(false)

    expect(isUnclassifiedFirmwareRow(values({
      vendor: 'APC',
      model: 'Smart-UPS 1000 RM',
      platform: 'UPS OS',
      currentFirmware: '09.8',
    }), references)).toBe(false)
  })
})
