import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchFindUnique: vi.fn(),
  rowFindMany: vi.fn(),
  rowUpdate: vi.fn(),
  rowUpdateMany: vi.fn(),
  rowGroupBy: vi.fn(),
  ruleFindMany: vi.fn(),
  ruleUpsert: vi.fn(),
  referenceFindMany: vi.fn(),
  referenceDeleteMany: vi.fn(),
  referenceCreateMany: vi.fn(),
  transaction: vi.fn(),
  refresh: vi.fn(),
  workspace: vi.fn(),
}))

vi.mock('@/lib/device-import', () => ({
  normalizeImportText: (value: unknown) => typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
    : '',
  parseDeviceImportOptions: (value: unknown) => value,
}))

vi.mock('@/lib/device-import-staging', () => ({
  buildDeviceImportStagedReferenceSeeds: vi.fn(() => []),
}))

vi.mock('@/lib/device-import-staging-store', () => {
  class DeviceImportStagingError extends Error {}
  return {
    DeviceImportStagingError,
    getDeviceImportBatchWorkspace: mocks.workspace,
    refreshDeviceImportBatchReferences: mocks.refresh,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceImportBatch: { findUnique: mocks.batchFindUnique },
    deviceImportStagedRow: {
      findMany: mocks.rowFindMany,
      update: mocks.rowUpdate,
      updateMany: mocks.rowUpdateMany,
      groupBy: mocks.rowGroupBy,
    },
    deviceImportProfileRule: {
      findMany: mocks.ruleFindMany,
      upsert: mocks.ruleUpsert,
    },
    deviceImportStagedReference: {
      findMany: mocks.referenceFindMany,
      deleteMany: mocks.referenceDeleteMany,
      createMany: mocks.referenceCreateMany,
    },
    $transaction: mocks.transaction,
  },
}))

import {
  applyDeviceImportRowAction,
  applySavedImportProfileRules,
} from '@/lib/device-import-staged-rules'

const phoneRow = {
  id: 'row-phone',
  rowNumber: 2,
  status: 'STAGED',
  mappedData: { hostname: 'phone-01', deviceType: 'Phone', vendor: 'Cisco' },
}
const switchRow = {
  id: 'row-switch',
  rowNumber: 3,
  status: 'STAGED',
  mappedData: { hostname: 'switch-01', deviceType: 'Network Switch', vendor: 'Aruba' },
}

function batch(id = 'batch-1') {
  return {
    id,
    profileId: 'profile-auvik',
    status: 'STAGED',
    settings: {},
  }
}

describe('staged import ignore rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batchFindUnique.mockResolvedValue(batch())
    mocks.rowUpdate.mockResolvedValue({})
    mocks.rowUpdateMany.mockResolvedValue({ count: 1 })
    mocks.rowGroupBy.mockResolvedValue([
      { status: 'STAGED', _count: { _all: 1 } },
      { status: 'IGNORED', _count: { _all: 1 } },
    ])
    mocks.ruleFindMany.mockResolvedValue([])
    mocks.ruleUpsert.mockResolvedValue({ id: 'rule-phone' })
    mocks.referenceFindMany.mockResolvedValue([])
    mocks.referenceDeleteMany.mockResolvedValue({ count: 0 })
    mocks.referenceCreateMany.mockResolvedValue({ count: 0 })
    mocks.refresh.mockResolvedValue({ batch: { id: 'batch-1' } })
    mocks.workspace.mockResolvedValue({ batch: { id: 'batch-1' } })
    mocks.transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (tx: unknown) => Promise<unknown>)({
          deviceImportStagedReference: {
            deleteMany: mocks.referenceDeleteMany,
            createMany: mocks.referenceCreateMany,
          },
        })
      }
      return Promise.all(input as Promise<unknown>[])
    })
  })

  it('ignores Device Type Phone and remembers the profile rule', async () => {
    mocks.rowFindMany
      .mockResolvedValueOnce([phoneRow, switchRow])
      .mockResolvedValueOnce([switchRow])

    const result = await applyDeviceImportRowAction({
      batchId: 'batch-1',
      action: 'IGNORE',
      field: 'deviceType',
      value: 'Phone',
      remember: true,
    })

    expect(result.affected).toBe(1)
    expect(mocks.ruleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        profileId_action_field_operator_normalizedValue: {
          profileId: 'profile-auvik',
          action: 'IGNORE',
          field: 'deviceType',
          operator: 'EQUALS',
          normalizedValue: 'phone',
        },
      },
      create: expect.objectContaining({ value: 'Phone', normalizedValue: 'phone' }),
    }))
    expect(mocks.rowUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-phone'] } },
      data: {
        status: 'IGNORED',
        statusSource: 'PROFILE_RULE',
        statusReason: 'deviceType = Phone',
      },
    })
  })

  it('ignores a Firmware value and remembers it for the import profile', async () => {
    const firmwareRow = {
      id: 'row-fw',
      rowNumber: 4,
      status: 'STAGED',
      mappedData: { hostname: 'ap-01', deviceType: 'Access Point', vendor: 'Aruba', currentFirmware: '8.10.0.20' },
    }
    mocks.rowFindMany
      .mockResolvedValueOnce([firmwareRow, switchRow])
      .mockResolvedValueOnce([switchRow])

    const result = await applyDeviceImportRowAction({
      batchId: 'batch-1',
      action: 'IGNORE',
      field: 'currentFirmware',
      value: '8.10.0.20',
      remember: true,
    })

    expect(result.affected).toBe(1)
    expect(mocks.ruleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        profileId_action_field_operator_normalizedValue: {
          profileId: 'profile-auvik',
          action: 'IGNORE',
          field: 'currentFirmware',
          operator: 'EQUALS',
          normalizedValue: '8.10.0.20',
        },
      },
    }))
    expect(mocks.rowUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-fw'] } },
      data: {
        status: 'IGNORED',
        statusSource: 'PROFILE_RULE',
        statusReason: 'currentFirmware = 8.10.0.20',
      },
    })
  })

  it('automatically applies the remembered Phone rule on a second import', async () => {
    mocks.batchFindUnique.mockResolvedValue(batch('batch-2'))
    mocks.ruleFindMany.mockResolvedValue([{ id: 'rule-phone', field: 'deviceType', value: 'Phone' }])
    mocks.rowFindMany
      .mockResolvedValueOnce([phoneRow, switchRow])
      .mockResolvedValueOnce([switchRow])

    await applySavedImportProfileRules('batch-2')

    expect(mocks.ruleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        profileId: 'profile-auvik',
        isActive: true,
        action: 'IGNORE',
        operator: 'EQUALS',
      },
    }))
    expect(mocks.rowUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-phone'] } },
      data: {
        status: 'IGNORED',
        statusSource: 'PROFILE_RULE',
        statusReason: 'deviceType = Phone',
      },
    })
  })
})
