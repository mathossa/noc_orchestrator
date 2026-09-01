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
  profileAliasFindMany: vi.fn(),
  transaction: vi.fn(),
  txDeviceCreate: vi.fn(),
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
    deviceImportProfileAlias: { findMany: mocks.profileAliasFindMany },
    $transaction: mocks.transaction,
  },
}))

import { parseDeviceImportOptions } from '@/lib/device-import'
import { commitDeviceImport, previewDeviceImport } from '@/lib/device-import-store'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'

const vendor = { id: 'vendor-1', code: 'ARUBA', name: 'Aruba', isActive: true }
const deviceType = { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true }
const model = {
  id: 'model-1',
  vendorId: vendor.id,
  deviceTypeId: deviceType.id,
  model: '2530-24G',
  platform: 'AOS-S',
  isActive: true,
  vendor,
  deviceType,
}

function workbook(deviceRows: number): XlsxWorkbook {
  const rows = [['Hostname', 'Model']]
  for (let index = 1; index <= deviceRows; index += 1) rows.push([`sw-${index}`, '2530-24G'])
  return {
    sheets: [{
      name: 'Devices',
      rowCount: rows.length,
      columnCount: 2,
      rows: rows.map((values, index) => ({ rowNumber: index + 1, values })),
    }],
  }
}

const options = parseDeviceImportOptions({
  sheetName: 'Devices',
  headerRow: 1,
  mapping: { '0': 'hostname', '1': 'model' },
  defaults: { customerId: 'customer-1' },
})

describe('large XLSX device import behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindMany.mockResolvedValue([{ id: 'customer-1', code: 'C1', name: 'Customer One', isActive: true, contractTypeId: null }])
    mocks.siteFindMany.mockResolvedValue([])
    mocks.vendorFindMany.mockResolvedValue([vendor])
    mocks.deviceTypeFindMany.mockResolvedValue([deviceType])
    mocks.modelFindMany.mockResolvedValue([model])
    mocks.releaseFindMany.mockResolvedValue([])
    mocks.contractFindMany.mockResolvedValue([])
    mocks.deviceFindMany.mockResolvedValue([])
    mocks.aliasFindMany.mockResolvedValue([])
    mocks.profileAliasFindMany.mockResolvedValue([])
    mocks.txDeviceCreate.mockImplementation(async () => ({ id: crypto.randomUUID() }))
    mocks.txAuditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      device: { create: mocks.txDeviceCreate, update: vi.fn() },
      auditEvent: { create: mocks.txAuditCreate },
    }))
  })

  it('validates the full workbook but returns only a bounded 200-row preview sample', async () => {
    const preview = await previewDeviceImport(workbook(250), options, 'large.xlsx')

    expect(preview.counts).toMatchObject({ create: 250, importable: 250, error: 0, conflict: 0 })
    expect(preview.rows).toHaveLength(200)
    expect(preview.rows[0].rowNumber).toBe(2)
    expect(preview.rows[199].rowNumber).toBe(201)
  })

  it('commits every valid CREATE/UPDATE row with one all-importable selection token', async () => {
    const result = await commitDeviceImport(
      workbook(3),
      options,
      { mode: 'ALL_IMPORTABLE' },
      'large.xlsx',
      'user-1',
    )

    expect(result).toMatchObject({ created: 3, updated: 0, failed: 0, skipped: 0, importedRows: [2, 3, 4] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.txDeviceCreate).toHaveBeenCalledTimes(3)
  })
})
