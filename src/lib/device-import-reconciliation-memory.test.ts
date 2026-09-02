import { describe, expect, it, vi } from 'vitest'
import {
  modelDraftIdsForVendorSource,
  profileIdForRepeatedWorkbook,
} from '@/lib/device-import-reconciliation-memory'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { resolveOneReference } from '@/lib/device-import-staging-store'

describe('device import reconciliation memory', () => {
  it('marks every Model draft that received a propagated source-Vendor choice', () => {
    const drafts = {
      one: { vendorSourceValue: 'Aruba' },
      two: { vendorSourceValue: ' aruba ' },
      three: { vendorSourceValue: 'Cisco' },
    }

    expect(modelDraftIdsForVendorSource(drafts, 'one')).toEqual(['one', 'two'])
  })

  it('reuses the active profile from the newest batch with the identical workbook filename', () => {
    const batches = [
      { fileName: 'Auvik Export.xlsx', profileId: 'profile-current' },
      { fileName: 'Auvik Export.xlsx', profileId: 'profile-old' },
    ]
    const profiles = [
      { id: 'profile-current', isActive: true, settings: { sheetName: 'Devices' } },
      { id: 'profile-old', isActive: true, settings: { sheetName: 'Devices' } },
    ]

    expect(profileIdForRepeatedWorkbook('AUVIK EXPORT.xlsx', ['Devices'], batches, profiles)).toBe('profile-current')
    expect(profileIdForRepeatedWorkbook('Another.xlsx', ['Devices'], batches, profiles)).toBeNull()
    expect(profileIdForRepeatedWorkbook('Auvik Export.xlsx', ['Other sheet'], batches, profiles)).toBeNull()
  })

  it('uses a remembered profile mapping before an exact canonical name match', () => {
    const reference = {
      id: 'type-ref',
      batchId: 'batch-1',
      kind: 'DEVICE_TYPE',
      sourceValue: 'Switch',
      normalizedSourceValue: 'switch',
      contextKey: '',
      metadata: {},
      status: 'UNRESOLVED',
      targetId: null,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: null,
      occurrenceCount: 1,
    }
    const universe = {
      customers: [],
      sites: [],
      vendors: [],
      deviceTypes: [
        { id: 'type-exact', code: 'SWITCH', name: 'Switch', isActive: true },
        { id: 'type-remembered', code: 'NETWORK', name: 'Network device', isActive: true },
      ],
      models: [],
      contracts: [],
      firmwareReleases: [],
      aliases: [{
        kind: 'DEVICE_TYPE',
        normalizedSourceValue: 'switch',
        contextKey: '',
        targetId: 'type-remembered',
      }],
    }

    expect(resolveOneReference(reference as never, [reference] as never, universe as never)).toMatchObject({
      status: 'LINKED',
      targetId: 'type-remembered',
      resolutionSource: 'PROFILE_ALIAS',
    })
  })

  it('reuses remembered Firmware with explicit staged platform evidence on a multi-platform Model', () => {
    const reference = {
      id: 'firmware-ref',
      batchId: 'batch-1',
      kind: 'FIRMWARE_RELEASE',
      sourceValue: '8.10.0.20',
      normalizedSourceValue: '8.10.0.20',
      contextKey: '',
      metadata: { modelTargetId: 'model-ap315', platform: 'AOS-8' },
      status: 'UNRESOLVED',
      targetId: null,
      suggestedTargetId: null,
      suggestionScore: null,
      resolutionSource: null,
      occurrenceCount: 1,
    }
    const vendor = { id: 'vendor-hpe', code: 'HPE', name: 'HPE Networking', isActive: true }
    const deviceType = { id: 'type-ap', code: 'AP', name: 'Access Point', isActive: true }
    const universe = {
      customers: [],
      sites: [],
      vendors: [vendor],
      deviceTypes: [deviceType],
      models: [{
        id: 'model-ap315',
        vendorId: vendor.id,
        deviceTypeId: deviceType.id,
        familyId: null,
        model: 'AP315',
        platform: null,
        isActive: true,
        vendor,
        deviceType,
      }],
      contracts: [],
      firmwareReleases: [{
        id: 'firmware-aos8',
        vendorId: vendor.id,
        platform: 'AOS-8',
        version: '8.10.0.20',
        status: 'AVAILABLE',
        isActive: true,
        vendor,
      }],
      aliases: [{
        kind: 'FIRMWARE_RELEASE',
        normalizedSourceValue: '8.10.0.20',
        contextKey: 'vendor-hpe|aos-8',
        targetId: 'firmware-aos8',
      }],
    }

    expect(resolveOneReference(reference as never, [reference] as never, universe as never)).toMatchObject({
      status: 'LINKED',
      targetId: 'firmware-aos8',
      resolutionSource: 'PROFILE_ALIAS',
      metadata: { platform: 'AOS-8' },
    })
  })

})
