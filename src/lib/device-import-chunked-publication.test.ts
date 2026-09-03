import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindMany: vi.fn(),
  siteFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
  deviceTypeFindMany: vi.fn(),
  modelFindMany: vi.fn(),
  releaseFindMany: vi.fn(),
  contractFindMany: vi.fn(),
  deviceFindMany: vi.fn(),
  aliasFindMany: vi.fn(),
  transaction: vi.fn(),
  txDeviceCreate: vi.fn(),
  txDeviceUpdate: vi.fn(),
  txAuditCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: { findMany: mocks.customerFindMany },
    site: { findMany: mocks.siteFindMany },
    vendor: { findMany: mocks.vendorFindMany },
    deviceType: { findMany: mocks.deviceTypeFindMany },
    deviceModel: { findMany: mocks.modelFindMany },
    firmwareRelease: { findMany: mocks.releaseFindMany },
    contractType: { findMany: mocks.contractFindMany },
    device: { findMany: mocks.deviceFindMany },
    importReferenceAlias: { findMany: mocks.aliasFindMany },
    $transaction: mocks.transaction,
  },
}))

import { parseDeviceImportOptions } from '@/lib/device-import'
import { commitDeviceImport, reviewDeviceImportBlockers } from '@/lib/device-import-store'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'

const customer = { id: 'customer-1', code: 'C1', name: 'Customer One', isActive: true, contractTypeId: null }
const vendor = { id: 'vendor-1', code: 'ARUBA', name: 'Aruba', isActive: true }
const deviceType = { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true }
const model = {
  id: 'model-1',
  vendorId: vendor.id,
  deviceTypeId: deviceType.id,
  model: '2530-24G',
  platform: 'AOS-S',
  supportedPlatforms: [{ platform: 'AOS-S' }],
  isActive: true,
  vendor,
  deviceType,
}

function workbook(rows: string[][]): XlsxWorkbook {
  return {
    sheets: [{
      name: 'Devices',
      rowCount: rows.length,
      columnCount: Math.max(...rows.map((row) => row.length)),
      rows: rows.map((values, index) => ({ rowNumber: index + 1, values })),
    }],
  }
}

function options(mapping: Record<string, string>) {
  return parseDeviceImportOptions({
    sheetName: 'Devices',
    headerRow: 1,
    mapping,
    defaults: { customerId: customer.id },
  })
}

describe('large device publication safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindMany.mockResolvedValue([customer])
    mocks.siteFindMany.mockResolvedValue([])
    mocks.vendorFindMany.mockResolvedValue([vendor])
    mocks.deviceTypeFindMany.mockResolvedValue([deviceType])
    mocks.modelFindMany.mockResolvedValue([model])
    mocks.releaseFindMany.mockResolvedValue([])
    mocks.contractFindMany.mockResolvedValue([])
    mocks.deviceFindMany.mockResolvedValue([])
    mocks.aliasFindMany.mockResolvedValue([])
    mocks.txDeviceCreate.mockResolvedValue({ id: 'created-device' })
    mocks.txDeviceUpdate.mockResolvedValue({ id: 'updated-device' })
    mocks.txAuditCreate.mockResolvedValue({ id: 'audit' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      device: { create: mocks.txDeviceCreate, update: mocks.txDeviceUpdate },
      auditEvent: { create: mocks.txAuditCreate },
    }))
  })

  it('splits a large selected set into bounded transactions and reports each committed chunk', async () => {
    const onChunkCommitted = vi.fn()
    const onPlanReady = vi.fn()
    const book = workbook([
      ['Hostname', 'Model'],
      ['sw-01', '2530-24G'],
      ['sw-02', '2530-24G'],
      ['sw-03', '2530-24G'],
    ])

    const result = await commitDeviceImport(
      book,
      options({ '0': 'hostname', '1': 'model' }),
      { mode: 'ALL_IMPORTABLE' },
      'devices.xlsx',
      'user-1',
      { transactionChunkSize: 2, onChunkCommitted, onPlanReady },
    )

    expect(result.created).toBe(3)
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(onPlanReady).toHaveBeenCalledWith(expect.objectContaining({ selectedRowNumbers: [2, 3, 4] }))
    expect(onChunkCommitted).toHaveBeenNthCalledWith(1, expect.objectContaining({ rowNumbers: [2, 3], created: 2, updated: 0 }))
    expect(onChunkCommitted).toHaveBeenNthCalledWith(2, expect.objectContaining({ rowNumbers: [4], created: 1, updated: 0 }))
  })

  it('groups blocked devices by the actual field-level validation reason', async () => {
    const review = await reviewDeviceImportBlockers(
      workbook([
        ['Hostname', 'Model'],
        ['', '2530-24G'],
      ]),
      options({ '0': 'hostname', '1': 'model' }),
      'devices.xlsx',
    )

    expect(review.total).toBe(1)
    expect(review.rows[0]).toMatchObject({ rowNumber: 2, action: 'ERROR' })
    expect(review.rows[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'name: Device name is required.' }),
    ]))
    expect(review.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'ERROR', message: 'name: Device name is required.', count: 1 }),
    ]))
  })
})
