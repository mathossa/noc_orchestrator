import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindUnique: vi.fn(),
  contractFindUnique: vi.fn(),
  contractFindMany: vi.fn(),
  siteFindMany: vi.fn(),
  siteFindFirst: vi.fn(),
  siteCreate: vi.fn(),
  siteUpdate: vi.fn(),
  siteDelete: vi.fn(),
  deviceCount: vi.fn(),
  auditCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customer: { findUnique: mocks.customerFindUnique },
    contractType: { findUnique: mocks.contractFindUnique, findMany: mocks.contractFindMany },
    site: {
      findMany: mocks.siteFindMany,
      findFirst: mocks.siteFindFirst,
      create: mocks.siteCreate,
      update: mocks.siteUpdate,
      delete: mocks.siteDelete,
    },
    device: { count: mocks.deviceCount },
    auditEvent: { count: mocks.auditCount },
  },
}))

import {
  assertSiteBelongsToCustomer,
  createSite,
  deleteSite,
  listSites,
  SiteConflictError,
  SiteContractError,
  SiteCustomerError,
  SiteInUseError,
  updateSite,
} from '@/lib/site-store'

const customerContract = {
  id: 'contract-customer',
  code: 'FULL',
  name: 'Fully Managed',
  firmwareManagementEnabled: true,
  isActive: true,
}
const siteContract = {
  id: 'contract-site',
  code: 'FW',
  name: 'Firmware Management',
  firmwareManagementEnabled: true,
  isActive: true,
}
const customer = {
  id: 'customer-1',
  code: 'ACME',
  name: 'Acme',
  isActive: true,
  contractType: customerContract,
}
const storedSite = {
  id: 'site-1',
  customerId: 'customer-1',
  contractTypeId: null,
  customer,
  contractType: null,
  name: 'Head office',
  code: 'HQ',
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: 'Zwolle',
  region: null,
  country: 'Netherlands',
  notes: null,
  isActive: true,
  source: 'MANUAL',
  externalProvider: null,
  externalId: null,
  lastSynchronizedAt: null,
  _count: { devices: 0 },
}

describe('site persistence rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-1' })
    mocks.contractFindUnique.mockResolvedValue({ id: 'contract-site' })
    mocks.siteFindMany.mockResolvedValue([])
  })

  it('lists sites across customers and resolves the inherited customer contract', async () => {
    mocks.siteFindMany.mockResolvedValue([storedSite])

    const result = await listSites()

    expect(mocks.siteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ isActive: 'desc' }, { customer: { name: 'asc' } }, { name: 'asc' }],
    }))
    expect(result).toEqual([expect.objectContaining({
      id: 'site-1',
      customerId: 'customer-1',
      customer: expect.objectContaining({ name: 'Acme' }),
      effectiveContractType: customerContract,
      contractSource: 'CUSTOMER',
      deviceCount: 0,
    })])
  })

  it('creates customer-scoped site records without external identity or contract override', async () => {
    mocks.siteCreate.mockResolvedValue(storedSite)

    const result = await createSite('customer-1', { name: 'Head office', code: 'hq', city: 'Zwolle' })

    expect(mocks.siteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'customer-1',
        contractTypeId: null,
        name: 'Head office',
        code: 'HQ',
        source: 'MANUAL',
      }),
    }))
    expect(result).toMatchObject({ id: 'site-1', customerId: 'customer-1', contractSource: 'CUSTOMER' })
  })

  it('allows a site to override the customer default contract', async () => {
    mocks.siteCreate.mockResolvedValue({
      ...storedSite,
      contractTypeId: 'contract-site',
      contractType: siteContract,
    })

    const result = await createSite('customer-1', {
      name: 'Branch',
      contractTypeId: 'contract-site',
    })

    expect(mocks.contractFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'contract-site' } }))
    expect(result).toMatchObject({
      contractTypeId: 'contract-site',
      effectiveContractType: siteContract,
      contractSource: 'SITE',
    })
  })

  it('rejects an unknown site contract override', async () => {
    mocks.contractFindUnique.mockResolvedValue(null)

    await expect(createSite('customer-1', {
      name: 'Branch',
      contractTypeId: 'missing-contract',
    })).rejects.toBeInstanceOf(SiteContractError)
  })

  it('rejects normalized duplicate names and duplicate codes within one customer', async () => {
    mocks.siteFindMany.mockResolvedValue([{ id: 'existing', name: '  HEAD   OFFICE ', code: 'HQ' }])

    await expect(createSite('customer-1', { name: 'head office', code: 'OTHER' })).rejects.toBeInstanceOf(SiteConflictError)
    await expect(createSite('customer-1', { name: 'Branch', code: 'hq' })).rejects.toBeInstanceOf(SiteConflictError)
    expect(mocks.siteCreate).not.toHaveBeenCalled()
  })

  it('allows the same site name for a different customer', async () => {
    mocks.customerFindUnique.mockResolvedValue({ id: 'customer-2' })
    mocks.siteFindMany.mockResolvedValue([])
    mocks.siteCreate.mockResolvedValue({
      ...storedSite,
      id: 'site-2',
      customerId: 'customer-2',
      customer: { ...customer, id: 'customer-2' },
    })

    await createSite('customer-2', { name: 'Head office', code: 'HQ' })

    expect(mocks.siteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'customer-2' } }))
    expect(mocks.siteCreate).toHaveBeenCalled()
  })

  it('supports archive-only updates without changing site identity or contract', async () => {
    mocks.siteFindFirst.mockResolvedValue({
      ...storedSite,
      customer: undefined,
      contractType: undefined,
      _count: undefined,
    })
    mocks.siteFindMany.mockResolvedValue([{ id: 'site-1', name: 'Head office', code: 'HQ' }])
    mocks.siteUpdate.mockResolvedValue({ ...storedSite, isActive: false })

    await updateSite('customer-1', 'site-1', { isActive: false })

    expect(mocks.siteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'site-1' },
      data: expect.objectContaining({ name: 'Head office', code: 'HQ', contractTypeId: null, isActive: false }),
    }))
  })

  it('rejects a site assignment when the site belongs to another customer', async () => {
    mocks.siteFindFirst.mockResolvedValue(null)

    await expect(assertSiteBelongsToCustomer('site-other', 'customer-1')).rejects.toBeInstanceOf(SiteCustomerError)
    expect(mocks.siteFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'site-other', customerId: 'customer-1' } }))
  })

  it('blocks permanent deletion while devices or history reference the site', async () => {
    mocks.siteFindFirst.mockResolvedValue({ id: 'site-1', name: 'Head office' })
    mocks.deviceCount.mockResolvedValue(1)
    mocks.auditCount.mockResolvedValue(0)

    await expect(deleteSite('customer-1', 'site-1')).rejects.toBeInstanceOf(SiteInUseError)
    expect(mocks.siteDelete).not.toHaveBeenCalled()
  })
})
