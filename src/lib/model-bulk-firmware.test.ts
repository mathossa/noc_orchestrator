import { describe, expect, it } from 'vitest'
import type { DeviceModelFirmwareReference, DeviceModelRecord } from '@/lib/device-models'
import { commonCompatibleDesiredReleases, groupDeviceModels } from '@/lib/model-bulk-firmware'

function model(overrides: Partial<DeviceModelRecord> & Pick<DeviceModelRecord, 'id' | 'vendorId' | 'model'>): DeviceModelRecord {
  return {
    deviceTypeId: 'type-1',
    familyId: null,
    platform: 'AOS-S',
    notes: null,
    isActive: true,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    vendor: { id: overrides.vendorId, code: 'VENDOR', name: overrides.vendorId, isActive: true },
    deviceType: { id: 'type-1', code: 'SWITCH', name: 'Switches', isActive: true },
    family: null,
    deviceCount: 0,
    desiredFirmwareRelease: null,
    ...overrides,
  }
}

function release(overrides: Partial<DeviceModelFirmwareReference> & Pick<DeviceModelFirmwareReference, 'id' | 'vendorId'>): DeviceModelFirmwareReference {
  return {
    version: overrides.id,
    platform: 'AOS-S',
    status: 'APPROVED',
    isActive: true,
    releasedAt: null,
    firmwareTrain: null,
    ...overrides,
  }
}

describe('model family grouping and common desired firmware', () => {
  it('groups concrete models by explicit family membership rather than model name prefixes', () => {
    const family = { id: 'family-2530', vendorId: 'aruba', name: '2530', isActive: true }
    const records = [
      model({ id: 'm1', vendorId: 'aruba', model: '2530-24G', familyId: family.id, family }),
      model({ id: 'm2', vendorId: 'aruba', model: 'Completely different label', familyId: family.id, family }),
      model({ id: 'm3', vendorId: 'aruba', model: '2530-looking-name', familyId: null, family: null }),
    ]

    const groups = groupDeviceModels(records, 'family')

    expect(groups.find((group) => group.key === family.id)?.rows.map((row) => row.id)).toEqual(['m1', 'm2'])
    expect(groups.find((group) => group.key.startsWith('unassigned:'))?.rows.map((row) => row.id)).toEqual(['m3'])
  })

  it('returns only releases compatible with every selected concrete model', () => {
    const selected = [
      model({ id: 'm1', vendorId: 'aruba', model: '2530-24G', platform: 'AOS-S' }),
      model({ id: 'm2', vendorId: 'aruba', model: '2530-48G', platform: ' aos-s ' }),
    ]
    const releases = [
      release({ id: 'good', vendorId: 'aruba', platform: 'AOS-S', status: 'APPROVED' }),
      release({ id: 'wrong-platform', vendorId: 'aruba', platform: 'AOS-CX' }),
      release({ id: 'available', vendorId: 'aruba', platform: 'AOS-S', status: 'AVAILABLE' }),
      release({ id: 'archived', vendorId: 'aruba', platform: 'AOS-S', isActive: false }),
      release({ id: 'wrong-vendor', vendorId: 'cisco', platform: 'AOS-S' }),
    ]

    expect(commonCompatibleDesiredReleases(selected, releases).map((item) => item.id)).toEqual(['good'])
  })

  it('offers no target for mixed-vendor selection', () => {
    const selected = [
      model({ id: 'm1', vendorId: 'aruba', model: '2530-24G' }),
      model({ id: 'm2', vendorId: 'cisco', model: 'C9300-24P', platform: null }),
    ]

    expect(commonCompatibleDesiredReleases(selected, [release({ id: 'fw', vendorId: 'aruba' })])).toEqual([])
  })
})
