import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exportRecords: vi.fn(),
  csv: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}))

vi.mock('@/lib/inventory-explorer-store', () => ({
  getInventoryExportRecords: mocks.exportRecords,
}))

vi.mock('@/lib/inventory-export', () => ({
  inventoryExportCsv: mocks.csv,
}))

import { GET } from './route'

describe('inventory CSV export scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exportRecords.mockResolvedValue([])
    mocks.csv.mockReturnValue('Customer,Site,Current firmware,Contract\r\n')
    mocks.getSession.mockResolvedValue({ user: { id: 'engineer-1' } })
  })

  it('exports all customers with the existing vendor, device-type, and contract filters', async () => {
    const request = new Request(
      'https://noc.example/api/v1/inventory/export?scope=all&vendor=fortinet&deviceType=firewall&contract=managed',
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('noc-inventory-all-')
    expect(mocks.exportRecords).toHaveBeenCalledWith(
      { kind: 'all' },
      expect.objectContaining({
        vendor: 'fortinet',
        deviceType: 'firewall',
        contract: 'managed',
      }),
    )
  })

  it('keeps the customer, Site and device-type export scopes available', async () => {
    for (const [url, scope] of [
      [
        '?scope=customer&customerId=customer-a',
        { kind: 'customer', customerId: 'customer-a' },
      ],
      [
        '?scope=site&customerId=customer-a&siteId=site-1',
        { kind: 'site', customerId: 'customer-a', siteId: 'site-1' },
      ],
      [
        '?scope=deviceType&customerId=customer-a&siteId=site-1&deviceTypeId=firewall',
        {
          kind: 'deviceType',
          customerId: 'customer-a',
          siteId: 'site-1',
          deviceTypeId: 'firewall',
        },
      ],
    ] as const) {
      const response = await GET(
        new Request('https://noc.example/api/v1/inventory/export' + url),
      )
      expect(response.status).toBe(200)
      expect(mocks.exportRecords).toHaveBeenCalledWith(
        scope,
        expect.any(Object),
      )
    }
  })

  it('requires a session before exporting any internal contract data', async () => {
    mocks.getSession.mockResolvedValue(null)
    const response = await GET(
      new Request('https://noc.example/api/v1/inventory/export?scope=all'),
    )
    expect(response.status).toBe(401)
    expect(mocks.exportRecords).not.toHaveBeenCalled()
  })

  it('rejects invalid export scopes without calling the inventory store', async () => {
    const response = await GET(
      new Request('https://noc.example/api/v1/inventory/export?scope=site'),
    )
    expect(response.status).toBe(400)
    expect(mocks.exportRecords).not.toHaveBeenCalled()
  })
})
