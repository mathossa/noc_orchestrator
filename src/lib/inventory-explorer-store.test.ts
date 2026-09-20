import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  result as complianceResult,
  release as complianceRelease,
} from './test-fixtures/firmware-compliance'
import type { DeviceExceptionSummary } from './device-exception-summary-store'
import { parseInventoryQuery } from './inventory-explorer'

const mocks = vi.hoisted(() => ({
  deviceFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
  modelFindMany: vi.fn(),
  typeFindMany: vi.fn(),
  typeFindFirst: vi.fn(),
  contractFindMany: vi.fn(),
  customerFindFirst: vi.fn(),
  siteFindFirst: vi.fn(),
  compliance: vi.fn(),
  exceptions: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    device: { findMany: mocks.deviceFindMany },
    vendor: { findMany: mocks.vendorFindMany },
    deviceModel: { findMany: mocks.modelFindMany },
    deviceType: {
      findMany: mocks.typeFindMany,
      findFirst: mocks.typeFindFirst,
    },
    contractType: { findMany: mocks.contractFindMany },
    customer: { findFirst: mocks.customerFindFirst },
    site: { findFirst: mocks.siteFindFirst },
  },
}))

vi.mock('@/lib/firmware-compliance-store', () => ({
  resolveFirmwareComplianceBatch: mocks.compliance,
}))

vi.mock('@/lib/device-exception-summary-store', () => ({
  resolveDeviceExceptionSummaries: mocks.exceptions,
}))

import {
  getCustomerInventory,
  getDeviceTypeInventory,
  getInventoryOverview,
  getSiteInventory,
} from './inventory-explorer-store'

const vendor = { id: 'vendor-1', name: 'Cisco' }
const type = { id: 'type-1', name: 'Switch' }
const model = {
  id: 'model-1',
  model: 'C9300-24P',
  vendor,
  deviceType: type,
}
const acme = { id: 'customer-a', name: 'Acme' }
const beta = { id: 'customer-b', name: 'Beta' }
const hq = { id: 'site-hq', name: 'HQ' }
const branch = { id: 'site-branch', name: 'Branch' }

function fact(
  id: string,
  customer = acme,
  site: { id: string; name: string } | null = hq,
) {
  return {
    id,
    name: id.toUpperCase(),
    customerId: customer.id,
    siteId: site?.id ?? null,
    deviceModelId: model.id,
    customer,
    site,
    deviceModel: model,
  }
}

function compact(row: ReturnType<typeof fact>) {
  return {
    id: row.id,
    name: row.name,
    hostname: row.name.toLowerCase(),
    currentFirmwareRawVersion: '17.12.5',
    currentFirmwareNormalizedVersion: '17.12.5',
    currentFirmwareRelease: null,
    customer: row.customer,
    site: row.site,
    deviceModel: {
      model: row.deviceModel.model,
      deviceType: row.deviceModel.deviceType,
    },
  }
}

function noException(): DeviceExceptionSummary {
  return {
    state: 'NONE',
    effective: null,
    activeCount: 0,
    inheritedCount: 0,
    historyCount: 0,
    reviewDueAt: null,
  }
}

function query(values: Record<string, string> = {}) {
  return parseInventoryQuery(new URLSearchParams(values))
}

describe('inventory explorer read model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindMany.mockResolvedValue([{ id: vendor.id, name: vendor.name }])
    mocks.modelFindMany.mockResolvedValue([
      { id: model.id, model: model.model, vendor: { name: vendor.name } },
    ])
    mocks.typeFindMany.mockResolvedValue([{ id: type.id, name: type.name }])
    mocks.typeFindFirst.mockResolvedValue(type)
    mocks.contractFindMany.mockResolvedValue([])
    mocks.customerFindFirst.mockResolvedValue(acme)
    mocks.siteFindFirst.mockResolvedValue(hq)
    mocks.exceptions.mockImplementation(
      async (devices: Array<{ id: string }>) =>
        new Map(devices.map((device) => [device.id, noException()])),
    )
  })

  it('rolls attention from devices to customers and sorts attention first', async () => {
    const rows = [
      fact('healthy-a', acme, hq),
      fact('required-b', beta, branch),
    ]
    mocks.deviceFindMany.mockResolvedValue(rows)
    mocks.compliance.mockResolvedValue(
      new Map([
        [
          'healthy-a',
          complianceResult({
            compliance: 'PREFERRED',
            recommendation: 'NO_ACTION',
          }),
        ],
        [
          'required-b',
          complianceResult({
            compliance: 'BELOW_MINIMUM',
            recommendation: 'UPDATE_REQUIRED',
            preferredTarget: complianceRelease('17.15.5'),
          }),
        ],
      ]),
    )

    const result = await getInventoryOverview(query())

    expect(result.counts).toMatchObject({
      total: 2,
      attention: 1,
      critical: 0,
    })
    expect(result.customers.map((row) => row.id)).toEqual([
      'customer-b',
      'customer-a',
    ])
    expect(result.customers[0]).toMatchObject({
      deviceCount: 1,
      attentionCount: 1,
    })
    expect(result.customers[1]).toMatchObject({
      deviceCount: 1,
      attentionCount: 0,
    })
  })

  it('rolls attention through customer sites and site device types', async () => {
    const rows = [
      fact('required-hq', acme, hq),
      fact('healthy-branch', acme, branch),
    ]
    mocks.deviceFindMany.mockResolvedValue(rows)
    mocks.compliance.mockResolvedValue(
      new Map([
        [
          'required-hq',
          complianceResult({
            compliance: 'BELOW_MINIMUM',
            recommendation: 'UPDATE_REQUIRED',
          }),
        ],
        [
          'healthy-branch',
          complianceResult({
            compliance: 'PREFERRED',
            recommendation: 'NO_ACTION',
          }),
        ],
      ]),
    )

    const customerResult = await getCustomerInventory(acme.id, query())
    expect(customerResult?.sites.map((row) => row.id)).toEqual([
      hq.id,
      branch.id,
    ])
    expect(customerResult?.sites[0].attentionCount).toBe(1)

    mocks.deviceFindMany.mockResolvedValue([rows[0]])
    const siteResult = await getSiteInventory(acme.id, hq.id, query())
    expect(siteResult?.deviceTypes).toEqual([
      expect.objectContaining({
        id: type.id,
        deviceCount: 1,
        attentionCount: 1,
      }),
    ])
  })

  it('keeps the device query bounded and problems-first, with an attention-only scope', async () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      fact('device-' + String(index + 1).padStart(2, '0')),
    )
    const statusMap = new Map(
      rows.map((row, index) => [
        row.id,
        complianceResult(
          index === 29
            ? {
                compliance: 'BELOW_MINIMUM',
                recommendation: 'UPDATE_REQUIRED',
              }
            : {
                compliance: 'PREFERRED',
                recommendation: 'NO_ACTION',
              },
        ),
      ]),
    )
    mocks.compliance.mockResolvedValue(statusMap)
    mocks.deviceFindMany.mockImplementation(async (args: { select?: Record<string, unknown>; where?: { id?: { in?: string[] } } }) => {
      if (args.select?.hostname) {
        const ids = new Set(args.where?.id?.in ?? [])
        return rows.filter((row) => ids.has(row.id)).map(compact)
      }
      return rows
    })
    const result = await getDeviceTypeInventory(
      acme.id,
      hq.id,
      type.id,
      query({ pageSize: '25' }),
    )
    expect(result?.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 30,
      totalPages: 2,
    })
    expect(result?.devices).toHaveLength(25)
    expect(result?.devices[0].id).toBe('device-30')

    const attentionOnly = await getDeviceTypeInventory(
      acme.id,
      hq.id,
      type.id,
      query({ attention: '1' }),
    )
    expect(attentionOnly?.pagination.total).toBe(1)
    expect(attentionOnly?.devices.map((row) => row.id)).toEqual(['device-30'])
  })
})
