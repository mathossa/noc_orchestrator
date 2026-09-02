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
})
