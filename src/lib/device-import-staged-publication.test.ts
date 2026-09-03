import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/device-import-store', () => ({ commitDeviceImport: vi.fn(), previewDeviceImport: vi.fn() }))

import { DEVICE_IMPORT_FIELDS, type DeviceImportField } from '@/lib/device-import'
import {
  isUnclassifiedFirmwareRow,
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
