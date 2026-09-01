import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  vendorFindUnique: vi.fn(),
  contractFindUnique: vi.fn(),
  modelFindMany: vi.fn(),
  releaseFindMany: vi.fn(),
  policyFindMany: vi.fn(),
}))

vi.mock('@/lib/device-store', () => ({ listDevices: mocks.listDevices }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vendor: { findUnique: mocks.vendorFindUnique },
    contractType: { findUnique: mocks.contractFindUnique },
    deviceModel: { findMany: mocks.modelFindMany },
    firmwareRelease: { findMany: mocks.releaseFindMany },
    firmwarePolicy: { findMany: mocks.policyFindMany },
  },
}))

import { FirmwareDrilldownNotFoundError, getContractDrilldown, getVendorDrilldown } from '@/lib/firmware-drilldown-store'

const now = new Date('2026-09-01T08:00:00Z')
const desired = { id: 'fw-new', version: '17.15.5', platform: 'IOS XE', status: 'APPROVED', isActive: true }

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    customerId: 'customer-1',
    siteId: null,
    deviceModelId: 'model-1',
    name: 'SW-01',
    hostname: null,
    serialNumber: null,
    managementAddress: null,
    notes: null,
    currentFirmwareReleaseId: 'fw-old',
    currentFirmwareObservedAt: now.toISOString(),
    currentFirmwareAgeDays: 0,
    currentFirmwareSource: 'MANUAL',
    isActive: true,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    customer: { id: 'customer-1', code: 'A', name: 'Customer A', isActive: true, contractType: { id: 'contract-1', code: 'FULL', name: 'Full', firmwareManagementEnabled: true, isActive: true } },
    site: null,
    effectiveContractType: { id: 'contract-1', code: 'FULL', name: 'Full', firmwareManagementEnabled: true, isActive: true },
    contractSource: 'CUSTOMER',
    deviceModel: { id: 'model-1', model: 'C9300', platform: 'IOS XE', isActive: true, vendor: { id: 'vendor-1', code: 'CISCO', name: 'Cisco', isActive: true }, deviceType: { id: 'type-1', code: 'SWITCH', name: 'Switch', isActive: true } },
    currentFirmwareRelease: null,
    lifecycle: { id: 'lc-1', state: 'PLANNED', reason: null, notes: null, plannedFor: null, reviewAt: null, decidedAt: now.toISOString(), completedAt: null, decidedBy: null, targetFirmwareRelease: { id: 'fw-new', version: '17.15.5', platform: 'IOS XE' } },
    ...overrides,
  }
}

describe('firmware drill-down aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vendorFindUnique.mockResolvedValue({ id: 'vendor-1', code: 'CISCO', name: 'Cisco', websiteUrl: null, isActive: true, createdAt: now, updatedAt: now })
    mocks.contractFindUnique.mockResolvedValue({ id: 'contract-1', code: 'FULL', name: 'Full', description: null, firmwareManagementEnabled: true, isActive: true, createdAt: now, updatedAt: now, _count: { customers: 1, sites: 1 } })
    mocks.modelFindMany.mockResolvedValue([{ id: 'model-1', model: 'C9300', platform: 'IOS XE', isActive: true, source: 'MANUAL', lastSynchronizedAt: null, deviceType: { id: 'type-1', name: 'Switch' } }])
    mocks.releaseFindMany.mockResolvedValue([
      { id: 'fw-old', platform: 'IOS XE', version: '17.12.5', status: 'AVAILABLE', isActive: true, source: 'MANUAL', lastSynchronizedAt: null, firmwareTrain: null },
      { id: 'fw-new', platform: 'IOS XE', version: '17.15.5', status: 'APPROVED', isActive: true, source: 'API', lastSynchronizedAt: now, firmwareTrain: { id: 'train-1', name: '17.15.x' } },
    ])
    mocks.policyFindMany.mockResolvedValue([{ deviceModelId: 'model-1', targetFirmwareRelease: desired }])
  })

  it('summarizes vendor device compliance, workflow, model desired state, and release usage', async () => {
    mocks.listDevices.mockResolvedValue([device(), device({ id: 'device-2', name: 'SW-02', currentFirmwareReleaseId: 'fw-new', source: 'API', lastSynchronizedAt: now.toISOString(), lifecycle: null })])

    const result = await getVendorDrilldown('vendor-1')

    expect(result.deviceCount).toBe(2)
    expect(result.technicalStateCounts).toMatchObject({ current: 1, actionRequired: 1, unknown: 0, noPolicy: 0 })
    expect(result.workflowCounts).toMatchObject({ planned: 1, undecided: 1 })
    expect(result.models[0]).toMatchObject({ deviceCount: 2, desiredFirmwareRelease: desired })
    expect(result.releases.find((release) => release.id === 'fw-new')).toMatchObject({ currentDeviceCount: 1, desiredDeviceCount: 2 })
    expect(result.sourceSummary).toMatchObject({ manual: 1, api: 1, latestSynchronizedAt: now.toISOString() })
  })

  it('uses already-resolved effective contract assignments for contract lifecycle counts', async () => {
    mocks.listDevices.mockResolvedValue([
      device(),
      device({ id: 'device-2', customer: { id: 'customer-2', code: 'B', name: 'Customer B', isActive: true, contractType: null }, siteId: 'site-1', site: { id: 'site-1', code: 'HQ', name: 'HQ', isActive: true, contractType: { id: 'contract-1', code: 'FULL', name: 'Full', firmwareManagementEnabled: true, isActive: true } }, contractSource: 'SITE', source: 'IMPORT', lifecycle: { ...device().lifecycle, state: 'CUSTOMER_DECLINED' } }),
      device({ id: 'device-3', effectiveContractType: { id: 'other', code: 'OTHER', name: 'Other', firmwareManagementEnabled: true, isActive: true } }),
    ])

    const result = await getContractDrilldown('contract-1')

    expect(result.effectiveDeviceCount).toBe(2)
    expect(result.defaultCustomerCount).toBe(1)
    expect(result.siteOverrideCount).toBe(1)
    expect(result.workflowCounts).toMatchObject({ planned: 1, customerDeclined: 1 })
    expect(result.customers.map((customer) => customer.name)).toEqual(['Customer A', 'Customer B'])
    expect(result.sites).toEqual([{ id: 'site-1', name: 'HQ', customerId: 'customer-2', customerName: 'Customer B', deviceCount: 1 }])
  })

  it('returns explicit not-found errors for missing drill-down records', async () => {
    mocks.vendorFindUnique.mockResolvedValue(null)
    await expect(getVendorDrilldown('missing')).rejects.toBeInstanceOf(FirmwareDrilldownNotFoundError)
  })
})
