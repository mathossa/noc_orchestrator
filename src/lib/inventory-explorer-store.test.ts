import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  result as complianceResult,
  release as complianceRelease,
} from './test-fixtures/firmware-compliance'
import type { DeviceExceptionSummary } from './device-exception-summary-store'
import { parseInventoryQuery } from './inventory-explorer'

const mocks = vi.hoisted(() => ({
  planning: vi.fn().mockResolvedValue(new Map()),
  deviceFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
  modelFindMany: vi.fn(),
  typeFindMany: vi.fn(),
  typeFindFirst: vi.fn(),
  contractFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  customerFindFirst: vi.fn(),
  siteFindMany: vi.fn(),
  siteFindFirst: vi.fn(),
  compliance: vi.fn(),
  exceptions: vi.fn(),
}))

vi.mock('@/lib/firmware-work-plan-query-store', () => ({ resolveDeviceWorkPlanning: mocks.planning }))

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
    customer: {
      findMany: mocks.customerFindMany,
      findFirst: mocks.customerFindFirst,
    },
    site: {
      findMany: mocks.siteFindMany,
      findFirst: mocks.siteFindFirst,
    },
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
  getInventoryExportRecords,
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
    mocks.customerFindMany.mockResolvedValue([acme, beta])
    mocks.customerFindFirst.mockResolvedValue(acme)
    mocks.siteFindMany.mockResolvedValue([
      { ...hq, customerId: acme.id, customer: { name: acme.name } },
      { ...branch, customerId: beta.id, customer: { name: beta.name } },
    ])
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

  it('preserves critical counts through every aggregate alongside normal attention and healthy inventory', async () => {
    const rows = [fact('critical'), ...Array.from({ length: 4 }, (_, i) => fact('attention-' + i)), fact('healthy', beta, branch)]
    mocks.deviceFindMany.mockResolvedValue(rows)
    mocks.compliance.mockResolvedValue(new Map(rows.map((row) => [row.id, complianceResult(
      row.id === 'critical' ? { compliance: 'BLOCKED_RELEASE', recommendation: 'REVIEW_REQUIRED' }
        : row.id === 'healthy' ? { compliance: 'PREFERRED', recommendation: 'NO_ACTION' }
        : { compliance: 'ACCEPTED', recommendation: 'UPDATE_RECOMMENDED' },
    )])))
    const overview = await getInventoryOverview(query())
    expect(overview.customers[0]).toMatchObject({ id: acme.id, criticalCount: 1, attentionCount: 5 })
    expect(overview.customers[1]).toMatchObject({ id: beta.id, criticalCount: 0, attentionCount: 0 })
    mocks.deviceFindMany.mockResolvedValue(rows.slice(0, 5))
    const customer = await getCustomerInventory(acme.id, query())
    expect(customer?.sites[0]).toMatchObject({ criticalCount: 1, attentionCount: 5 })
    const site = await getSiteInventory(acme.id, hq.id, query())
    expect(site?.deviceTypes[0]).toMatchObject({ criticalCount: 1, attentionCount: 5 })
  })

  it('exposes direct site code matches while preserving query scope and bounded results', async () => {
    const row = { ...fact('matched'), site: { ...hq, code: '1012DB45' } }
    mocks.deviceFindMany.mockImplementation(async (args: { select: { hostname?: boolean } }) => args.select.hostname ? [compact(row)] : [row])
    mocks.compliance.mockResolvedValue(new Map([[row.id, complianceResult()]]))
    const root = await getInventoryOverview(query({ q: '1012DB45' }))
    expect(root.hierarchyMatches).toContainEqual({ kind: 'Site', label: 'Acme / HQ', href: '/devices/customers/customer-a/sites/site-hq' })
    await getCustomerInventory(acme.id, query({ q: '1012DB45' }))
    expect(mocks.deviceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([{ customerId: acme.id }]) } }))
    const site = await getSiteInventory(acme.id, hq.id, query({ q: '1012DB45' }))
    expect(site?.hierarchyMatches).toEqual([])
    expect(mocks.deviceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([{ customerId: acme.id }, { siteId: hq.id }]) } }))
  })

  it('uses resolved preferred target and actual override scope in group rows', async () => {
    const row = fact('migration')
    mocks.deviceFindMany.mockImplementation(async (args: { select: { hostname?: boolean } }) => args.select.hostname ? [{ ...compact(row), lifecycle: { state: 'PLANNED' } }] : [row])
    mocks.compliance.mockResolvedValue(new Map([[row.id, complianceResult({
      preferredTarget: complianceRelease('10.5.5', { platform: 'AOS-10', firmwareTrain: { id: '10.5', name: '10.5' } }),
      recommendation: 'PLATFORM_MIGRATION',
      policySource: { scope: 'SITE', scopeId: hq.id, subject: 'MODEL', subjectId: model.id, policyId: 'policy', policyVersion: 2, trackKey: 'default', trackName: 'Preferred', trackClass: 'PREFERRED', effectiveFrom: '2026-01-01' },
    })]]))
    const group = await getDeviceTypeInventory(acme.id, hq.id, type.id, query())
    expect(group?.devices[0]).toMatchObject({ currentFirmware: '17.12.5', effectiveTarget: '10.5.5', targetPlatform: 'AOS-10', targetTrain: '10.5', policyContext: 'Site override', decision: null })
  })

  it('rolls issue flags up separately without changing healthy firmware compliance', async () => {
    const flagged = { ...fact('flagged'), issueReason: 'Management unreachable' }
    const healthy = { ...fact('healthy', beta, branch), issueReason: null }
    mocks.deviceFindMany.mockImplementation(async (args: { select: { hostname?: boolean } }) => args.select.hostname ? [compact(flagged)] : [flagged, healthy])
    mocks.compliance.mockResolvedValue(new Map([flagged, healthy].map((row) => [row.id, complianceResult({ compliance: 'PREFERRED', recommendation: 'NO_ACTION' })])))
    const result = await getInventoryOverview(query({ flagged: '1' }))
    expect(result.counts).toMatchObject({ issues: 1, attention: 0, critical: 0 })
    expect(result.customers).toEqual([expect.objectContaining({ id: acme.id, issueCount: 1, attentionCount: 0, highestStatus: 'CURRENT' })])
    const customer = await getCustomerInventory(acme.id, query({ flagged: '1' }))
    expect(customer?.sites).toEqual([expect.objectContaining({ issueCount: 1, attentionCount: 0 })])
    const site = await getSiteInventory(acme.id, hq.id, query({ flagged: '1' }))
    expect(site?.deviceTypes[0]).toMatchObject({ issueCount: 1, attentionCount: 0 })
    const group = await getDeviceTypeInventory(acme.id, hq.id, type.id, query({ flagged: '1' }))
    expect(group?.devices).toEqual([expect.objectContaining({ issueReason: 'Management unreachable', status: expect.objectContaining({ code: 'CURRENT' }) })])
  })

  it('scans large root inventory in deterministic bounded batches', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) =>
      fact('batch-' + String(index + 1).padStart(4, '0')),
    )
    mocks.deviceFindMany.mockImplementation(
      async (args: { cursor?: { id: string }; take?: number }) =>
        args.cursor ? rows.slice(1000) : rows.slice(0, 1000),
    )
    mocks.compliance.mockImplementation(async (ids: string[]) =>
      new Map(
        ids.map((id) => [
          id,
          complianceResult({
            compliance: 'PREFERRED',
            recommendation: 'NO_ACTION',
          }),
        ]),
      ),
    )

    const result = await getInventoryOverview(query())

    expect(result.counts.total).toBe(1001)
    expect(mocks.deviceFindMany).toHaveBeenCalledTimes(2)
    expect(mocks.deviceFindMany.mock.calls[0][0]).toMatchObject({
      take: 1000,
      orderBy: { id: 'asc' },
    })
    expect(mocks.deviceFindMany.mock.calls[1][0]).toMatchObject({
      take: 1000,
      cursor: { id: 'batch-1000' },
      skip: 1,
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
  it('exports all Customers grouped by Site with effective internal contracts', async () => {
    const fortinet = { id: 'fortinet', name: 'Fortinet' }
    const firewall = { id: 'firewall', name: 'Firewall' }
    const firewallModel = { ...model, vendor: fortinet, deviceType: firewall }
    const inputs = [
      { ...fact('fg-b', beta, branch), deviceModel: firewallModel },
      { ...fact('fg-a', acme, hq), deviceModel: firewallModel },
    ]

    mocks.deviceFindMany.mockImplementation(
      async (args: { select: Record<string, unknown> }) => {
        if (!args.select.serialNumber) return inputs
        return inputs.map((row) => ({
          ...compact(row),
          serialNumber: 'SER-' + row.id,
          managementAddress: '10.0.0.1',
          currentFirmwareRelease: { version: '7.4.8' },
          source: 'API',
          externalProvider: 'AUVIK',
          externalId: row.id,
          lastSynchronizedAt: null,
          lifecycle: null,
          customer: {
            ...row.customer,
            contractType: { name: 'Standard management', showInReport: false },
          },
          site: {
            ...row.site,
            contractType:
              row.customer.id === acme.id
                ? { name: 'Premium management', showInReport: true }
                : null,
          },
          deviceModel: {
            model: firewallModel.model,
            vendor: fortinet,
            deviceType: firewall,
          },
        }))
      },
    )
    mocks.compliance.mockResolvedValue(
      new Map(inputs.map((row) => [row.id, complianceResult()])),
    )

    const result = await getInventoryExportRecords(
      { kind: 'all' },
      query({ vendor: fortinet.id, deviceType: firewall.id }),
    )

    expect(result.map((row) => row.customer)).toEqual(['Acme', 'Beta'])
    expect(result.map((row) => row.site)).toEqual(['HQ', 'Branch'])
    expect(result.map((row) => row.contract)).toEqual([
      'Premium management',
      'Standard management',
    ])
    expect(result.map((row) => row.contractShowInReport)).toEqual([
      true,
      false,
    ])
    expect(result.map((row) => row.currentFirmware)).toEqual(['7.4.8', '7.4.8'])
    expect(result.map((row) => row.vendor)).toEqual(['Fortinet', 'Fortinet'])
    expect(mocks.deviceFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        AND: expect.arrayContaining([
          { isActive: true },
          { deviceModel: { vendorId: fortinet.id } },
          { deviceModel: { deviceTypeId: firewall.id } },
        ]),
      },
    })
    expect(mocks.deviceFindMany.mock.calls[0][0].where.AND).not.toEqual(
      expect.arrayContaining([{ customerId: acme.id }]),
    )
  })

  it('applies exact Customer and Site filters to cross-customer reports and exports', async () => {
    const row = fact('filtered', acme, hq)
    mocks.deviceFindMany.mockResolvedValue([row])
    mocks.compliance.mockResolvedValue(
      new Map([[row.id, complianceResult()]]),
    )

    await getInventoryOverview(query({
      customer: acme.id,
      site: hq.id,
    }))

    expect(mocks.deviceFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        AND: expect.arrayContaining([
          { customerId: acme.id },
          { siteId: hq.id },
        ]),
      },
    })
  })

  it('preserves the customer and Site constraints on narrower exports', async () => {
    const row = fact('fg-a', acme, hq)
    mocks.deviceFindMany.mockImplementation(
      async (args: { select: Record<string, unknown> }) => {
        if (!args.select.serialNumber) return [row]
        return [{
          ...compact(row),
          serialNumber: 'SER-FG',
          managementAddress: '10.0.0.1',
          source: 'API',
          externalProvider: 'AUVIK',
          externalId: 'fg-a',
          lastSynchronizedAt: null,
          lifecycle: null,
          customer: {
            ...row.customer,
            contractType: { name: 'Standard', showInReport: true },
          },
          site: { ...row.site, contractType: null },
          deviceModel: {
            model: model.model,
            vendor: vendor,
            deviceType: type,
          },
        }]
      },
    )
    mocks.compliance.mockResolvedValue(
      new Map([[row.id, complianceResult()]]),
    )
    const result = await getInventoryExportRecords(
      { kind: 'site', customerId: acme.id, siteId: hq.id },
      query(),
    )
    expect(result).toHaveLength(1)
    expect(result[0].contract).toBe('Standard')
    expect(result[0].contractShowInReport).toBe(true)
    expect(mocks.deviceFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        AND: expect.arrayContaining([
          { customerId: acme.id },
          { siteId: hq.id },
        ]),
      },
    })
  })

})
