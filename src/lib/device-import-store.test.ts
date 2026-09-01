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
    $transaction: mocks.transaction,
  },
}))

import { parseDeviceImportOptions } from '@/lib/device-import'
import { commitDeviceImport, previewDeviceImport } from '@/lib/device-import-store'
import type { XlsxWorkbook } from '@/lib/xlsx-reader'

const customers = [
  { id: 'customer-1', code: 'C1', name: 'Customer One', isActive: true, contractTypeId: 'contract-managed' },
  { id: 'customer-2', code: 'C2', name: 'Customer Two', isActive: true, contractTypeId: null },
]
const sites = [
  { id: 'site-1', customerId: 'customer-1', code: 'AMS', name: 'Amsterdam', isActive: true, contractTypeId: null },
  { id: 'site-2', customerId: 'customer-2', code: 'RTM', name: 'Rotterdam', isActive: true, contractTypeId: null },
]
const vendors = [{ id: 'vendor-1', code: 'ARUBA', name: 'Aruba', isActive: true }]
const deviceTypes = [{ id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true }]
const models = [{
  id: 'model-1',
  vendorId: 'vendor-1',
  deviceTypeId: 'type-1',
  model: '2530-24G',
  platform: 'AOS-S',
  isActive: true,
  vendor: vendors[0],
  deviceType: deviceTypes[0],
}]
const releases = [{ id: 'fw-1', vendorId: 'vendor-1', platform: 'AOS-S', version: '16.11.0031', status: 'AVAILABLE', isActive: true }]
const contracts = [{ id: 'contract-managed', code: 'MANAGED', name: 'Fully Managed', isActive: true }]

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

function options(mapping: Record<string, string>, defaults: Record<string, string | null> = {}) {
  return parseDeviceImportOptions({
    sheetName: 'Devices',
    headerRow: 1,
    mapping,
    defaults,
  })
}

function existingDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    customerId: 'customer-1',
    siteId: 'site-1',
    deviceModelId: 'model-1',
    name: 'sw-01',
    hostname: 'sw-01',
    serialNumber: 'SERIAL-1',
    managementAddress: '10.0.0.1',
    notes: null,
    currentFirmwareReleaseId: 'fw-1',
    currentFirmwareObservedAt: new Date('2026-08-31T10:00:00Z'),
    currentFirmwareSource: 'MANUAL',
    source: 'MANUAL',
    externalProvider: 'CMDB',
    externalId: 'asset-1',
    isActive: true,
    currentFirmwareRelease: { id: 'fw-1', version: '16.11.0031' },
    ...overrides,
  }
}

describe('XLSX device import planning and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindMany.mockResolvedValue(customers)
    mocks.siteFindMany.mockResolvedValue(sites)
    mocks.vendorFindMany.mockResolvedValue(vendors)
    mocks.deviceTypeFindMany.mockResolvedValue(deviceTypes)
    mocks.modelFindMany.mockResolvedValue(models)
    mocks.releaseFindMany.mockResolvedValue(releases)
    mocks.contractFindMany.mockResolvedValue(contracts)
    mocks.deviceFindMany.mockResolvedValue([])
    mocks.txDeviceCreate.mockResolvedValue({ id: 'created-1' })
    mocks.txDeviceUpdate.mockResolvedValue({ id: 'device-1' })
    mocks.txAuditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      device: { create: mocks.txDeviceCreate, update: mocks.txDeviceUpdate },
      auditEvent: { create: mocks.txAuditCreate },
    }))
  })

  it('resolves a new device through normal customer/site/model/firmware references without creating reference data', async () => {
    const preview = await previewDeviceImport(
      workbook([
        ['Hostname', 'Vendor', 'Model', 'Firmware', 'Contract'],
        ['sw-01', 'Aruba', '2530-24G', '16.11.0031', 'Fully Managed'],
      ]),
      options(
        { '0': 'hostname', '1': 'vendor', '2': 'model', '3': 'currentFirmware', '4': 'contract' },
        { customerId: 'customer-1', siteId: 'site-1' },
      ),
      'devices.xlsx',
    )

    expect(preview.counts).toMatchObject({ create: 1, update: 0, error: 0, conflict: 0, importable: 1 })
    expect(preview.rows[0]).toMatchObject({
      action: 'CREATE',
      identity: 'sw-01',
      customer: 'Customer One',
      site: 'Amsterdam',
      model: 'Aruba · 2530-24G',
      currentFirmware: '16.11.0031',
    })
  })

  it('surfaces unknown concrete models instead of silently creating them', async () => {
    const preview = await previewDeviceImport(
      workbook([['Hostname', 'Model'], ['sw-01', 'UNKNOWN-24G']]),
      options({ '0': 'hostname', '1': 'model' }, { customerId: 'customer-1' }),
      'devices.xlsx',
    )

    expect(preview.rows[0].action).toBe('ERROR')
    expect(preview.rows[0].issues.map((issue) => issue.message).join(' ')).toContain('was not found')
    expect(mocks.txDeviceCreate).not.toHaveBeenCalled()
  })

  it('rejects a file-level site default that belongs to another customer', async () => {
    const preview = await previewDeviceImport(
      workbook([['Hostname', 'Model'], ['sw-01', '2530-24G']]),
      options({ '0': 'hostname', '1': 'model' }, { customerId: 'customer-1', siteId: 'site-2' }),
      'devices.xlsx',
    )

    expect(preview.rows[0].action).toBe('ERROR')
    expect(preview.rows[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('belongs to another customer') }),
    ]))
  })

  it('uses external provider + ID before customer/name fallback and previews an update instead of a duplicate create', async () => {
    mocks.deviceFindMany.mockResolvedValue([existingDevice()])
    const preview = await previewDeviceImport(
      workbook([
        ['External provider', 'External ID', 'Hostname', 'Model', 'IP Address'],
        ['CMDB', 'asset-1', 'sw-01', '2530-24G', '10.0.0.2'],
      ]),
      options({ '0': 'externalProvider', '1': 'externalId', '2': 'hostname', '3': 'model', '4': 'managementAddress' }, { customerId: 'customer-1' }),
      'devices.xlsx',
    )

    expect(preview.rows[0]).toMatchObject({ action: 'UPDATE', existingDeviceId: 'device-1' })
    expect(preview.rows[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'managementAddress', before: '10.0.0.1', after: '10.0.0.2' }),
    ]))
  })

  it('marks duplicate create identities inside the workbook as conflicts', async () => {
    const preview = await previewDeviceImport(
      workbook([['Hostname', 'Model'], ['sw-01', '2530-24G'], ['sw-01', '2530-24G']]),
      options({ '0': 'hostname', '1': 'model' }, { customerId: 'customer-1' }),
      'devices.xlsx',
    )

    expect(preview.counts.conflict).toBe(2)
    expect(preview.rows.every((row) => row.importable === false)).toBe(true)
  })

  it('commits selected valid rows in one transaction, marks provenance IMPORT, and never writes lifecycle/policy state', async () => {
    mocks.deviceFindMany.mockResolvedValue([existingDevice()])
    const book = workbook([
      ['External provider', 'External ID', 'Hostname', 'Model', 'IP Address', 'Firmware'],
      ['CMDB', 'asset-1', 'sw-01', '2530-24G', '10.0.0.2', '16.11.0031'],
    ])
    const importOptions = options(
      { '0': 'externalProvider', '1': 'externalId', '2': 'hostname', '3': 'model', '4': 'managementAddress', '5': 'currentFirmware' },
      { customerId: 'customer-1' },
    )

    const result = await commitDeviceImport(book, importOptions, [2], 'devices.xlsx', 'user-1')

    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0, importedRows: [2] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.txDeviceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'device-1' },
      data: expect.objectContaining({
        source: 'IMPORT',
        managementAddress: '10.0.0.2',
        currentFirmwareSource: 'IMPORT',
        lastSynchronizedAt: expect.any(Date),
      }),
    }))
    const updateData = mocks.txDeviceUpdate.mock.calls[0][0].data
    expect(updateData).not.toHaveProperty('lifecycle')
    expect(updateData).not.toHaveProperty('firmwarePolicies')
    expect(mocks.txAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: 'user-1',
        action: 'CURRENT_FIRMWARE_CHANGED',
        metadata: expect.objectContaining({ context: 'XLSX_IMPORT_UPDATE', rowNumber: 2 }),
      }),
    }))
  })

  it('propagates a transaction failure so a batch is never reported as partially successful', async () => {
    mocks.transaction.mockRejectedValue(new Error('database failure'))
    const book = workbook([['Hostname', 'Model'], ['sw-01', '2530-24G']])
    const importOptions = options({ '0': 'hostname', '1': 'model' }, { customerId: 'customer-1' })

    await expect(commitDeviceImport(book, importOptions, [2], 'devices.xlsx', null)).rejects.toThrow('database failure')
  })
})
