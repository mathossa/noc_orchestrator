import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  inventory: vi.fn(),
  filters: vi.fn(),
  xlsx: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}))
vi.mock('@/lib/inventory-explorer-store', () => ({
  getInventoryExportRecords: mocks.inventory,
  getInventoryFilterOptions: mocks.filters,
}))
vi.mock('@/lib/inventory-report-xlsx', () => ({
  inventoryReportXlsx: mocks.xlsx,
}))

import { GET } from './route'

describe('inventory Excel API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'engineer' } })
    mocks.filters.mockResolvedValue({
      vendors: [{ id: 'fortinet', name: 'Fortinet' }],
      models: [], deviceTypes: [], contracts: [],
    })
    mocks.inventory.mockResolvedValue([
      { currentFirmware: '7.4.8', contract: 'Pro-Active' },
      { currentFirmware: '7.2.11', contract: 'Active' },
    ])
    mocks.xlsx.mockResolvedValue(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  })

  it('exports filtered workbook with the official XLSX MIME type', async () => {
    const response = await GET(new Request(
      'https://noc.example/api/v1/reports/inventory/xlsx?vendor=fortinet&firmware=7.4',
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(response.headers.get('content-disposition')).toMatch(/\.xlsx"$/)
    expect(mocks.inventory).toHaveBeenCalledWith(
      { kind: 'all' },
      expect.objectContaining({ vendor: 'fortinet' }),
    )
    expect(mocks.xlsx).toHaveBeenCalledWith(
      [expect.objectContaining({ currentFirmware: '7.4.8' })],
      expect.any(String),
      expect.stringContaining('Fortinet'),
    )
  })

  it('does not expose cross-customer inventory without authentication', async () => {
    mocks.getSession.mockResolvedValue(null)
    const response = await GET(new Request(
      'https://noc.example/api/v1/reports/inventory/xlsx',
    ))
    expect(response.status).toBe(401)
    expect(mocks.inventory).not.toHaveBeenCalled()
    expect(mocks.xlsx).not.toHaveBeenCalled()
  })
})
