import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  listDeviceReferences: vi.fn(),
  policyFindMany: vi.fn(),
}))

vi.mock('@/lib/device-store', () => ({
  listDevices: mocks.listDevices,
  listDeviceReferences: mocks.listDeviceReferences,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { firmwarePolicy: { findMany: mocks.policyFindMany } },
}))

import { queryDevices } from '@/lib/device-query-store'
import { parseDeviceQuery } from '@/lib/device-query'

const contractCustomer = { id: 'contract-customer', code: 'FULL', name: 'Full management', firmwareManagementEnabled: true, isActive: true }
const contractSite = { id: 'contract-site', code: 'SITE', name: 'Site firmware', firmwareManagementEnabled: true, isActive: true }
const vendor = { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true }
const deviceType = { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true }
const model = { id: 'model-1', model: 'C9300-24P', platform: 'IOS XE', isActive: true, vendor, deviceType }
const oldRelease = { id: 'fw-old', vendorId: 'vendor-1', platform: 'IOS XE', version: '17.12.5', status: 'APPROVED', isActive: true, releasedAt: null, firmwareTrain: null }
const desiredRelease = { id: 'fw-new', vendorId: 'vendor-1', platform: 'IOS XE', version: '17.15.5', status: 'RECOMMENDED', isActive: true, firmwareTrain: null }
const customer = { id: 'customer-1', code: 'ACME', name: 'Acme', isActive: true, contractType: contractCustomer }
const site = { id: 'site-1', code: 'HQ', name: 'Head office', isActive: true, contractType: contractSite }

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1', customerId: 'customer-1', siteId: 'site-1', deviceModelId: 'model-1', name: 'HQ-SW-01',
    hostname: 'hq-sw-01', serialNumber: null, managementAddress: '10.0.0.1', notes: null,
    currentFirmwareReleaseId: 'fw-old', currentFirmwareObservedAt: null, currentFirmwareAgeDays: null,
    currentFirmwareSource: 'API', isActive: true, source: 'API', externalProvider: null, externalId: null,
    lastSynchronizedAt: null, customer, site, effectiveContractType: contractSite, contractSource: 'SITE',
    deviceModel: model, currentFirmwareRelease: oldRelease,
    lifecycle: { id: 'life-1', state: 'IGNORED', reason: 'Deferred internally', notes: null, plannedFor: null, reviewAt: null, decidedAt: '2026-09-01T00:00:00Z', completedAt: null, decidedBy: null, targetFirmwareRelease: { id: 'fw-new', version: '17.15.5', platform: 'IOS XE' } },
    ...overrides,
  }
}

const references = {
  customers: [customer],
  sites: [{ ...site, customerId: 'customer-1' }],
  models: [model],
  firmwareReleases: [oldRelease, desiredRelease],
}

describe('device cross-dimensional query service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listDeviceReferences.mockResolvedValue(references)
    mocks.policyFindMany.mockResolvedValue([{ deviceModelId: 'model-1', targetFirmwareRelease: desiredRelease }])
  })

  it('composes customer, site-override contract, technical, workflow and source filters', async () => {
    const customerDefaultDevice = record({
      id: 'device-2', siteId: null, site: null, effectiveContractType: contractCustomer, contractSource: 'CUSTOMER',
      currentFirmwareReleaseId: 'fw-new', currentFirmwareRelease: { ...oldRelease, id: 'fw-new', version: '17.15.5' },
      lifecycle: { ...record().lifecycle, state: 'DONE' }, source: 'MANUAL', currentFirmwareSource: 'MANUAL',
    })
    mocks.listDevices.mockResolvedValue([record(), customerDefaultDevice])

    const query = parseDeviceQuery(new URLSearchParams({
      customer: 'customer-1', site: 'site-1', contract: 'contract-site', technicalState: 'ACTION_REQUIRED', workflow: 'IGNORED', source: 'API',
    }))
    const result = await queryDevices(query)

    expect(result.data.map((item) => item.id)).toEqual(['device-1'])
    expect(result.data[0]).toMatchObject({
      desiredFirmwareRelease: { id: 'fw-new', version: '17.15.5' },
      technicalState: 'ACTION_REQUIRED',
      effectiveContractType: { id: 'contract-site' },
      contractSource: 'SITE',
    })
    expect(result.meta.pagination).toMatchObject({ total: 1, inventoryTotal: 2 })
    expect(mocks.policyFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.policyFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deviceModelId: { in: ['model-1'] } }) }))
  })

  it('uses customer contract fallback only when the site has no override', async () => {
    const noOverrideSite = { ...site, id: 'site-no-override', name: 'Branch', contractType: null }
    mocks.listDevices.mockResolvedValue([
      record(),
      record({ id: 'device-2', siteId: noOverrideSite.id, site: noOverrideSite, effectiveContractType: contractCustomer, contractSource: 'CUSTOMER' }),
    ])

    const siteContractResult = await queryDevices(parseDeviceQuery(new URLSearchParams({ contract: 'contract-site' })))
    const customerContractResult = await queryDevices(parseDeviceQuery(new URLSearchParams({ contract: 'contract-customer' })))

    expect(siteContractResult.data.map((item) => item.id)).toEqual(['device-1'])
    expect(customerContractResult.data.map((item) => item.id)).toEqual(['device-2'])
  })

  it('keeps ignored and customer-declined records queryable and groups filtered results by site', async () => {
    mocks.listDevices.mockResolvedValue([
      record(),
      record({ id: 'device-2', name: 'HQ-SW-02', lifecycle: { ...record().lifecycle, state: 'CUSTOMER_DECLINED', reason: 'Customer declined' } }),
      record({ id: 'device-3', name: 'NO-SITE', siteId: null, site: null, effectiveContractType: contractCustomer, contractSource: 'CUSTOMER', lifecycle: null }),
    ])

    const declined = await queryDevices(parseDeviceQuery(new URLSearchParams({ workflow: 'CUSTOMER_DECLINED' })))
    expect(declined.data.map((item) => item.id)).toEqual(['device-2'])

    const grouped = await queryDevices(parseDeviceQuery(new URLSearchParams({ groupBy: 'site', archive: 'all' })))
    expect(grouped.meta.groups).toEqual([
      { key: 'site-1', label: 'Head office', count: 2 },
      { key: 'none', label: 'Unassigned site', count: 1 },
    ])
    expect(grouped.data.map((item) => item.groupLabel)).toEqual(['Head office', 'Head office', 'Unassigned site'])
  })

  it('paginates after derived-state filtering with deterministic ordering', async () => {
    const records = Array.from({ length: 30 }, (_, index) => record({ id: `device-${String(index + 1).padStart(2, '0')}`, name: `SW-${String(index + 1).padStart(2, '0')}` }))
    mocks.listDevices.mockResolvedValue(records.reverse())

    const result = await queryDevices(parseDeviceQuery(new URLSearchParams({ page: '2', pageSize: '25', sort: 'name' })))

    expect(result.meta.pagination).toMatchObject({ page: 2, pageSize: 25, total: 30, totalPages: 2 })
    expect(result.data).toHaveLength(5)
    expect(result.data.map((item) => item.name)).toEqual(['SW-26', 'SW-27', 'SW-28', 'SW-29', 'SW-30'])
  })
})
