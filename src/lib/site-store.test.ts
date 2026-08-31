import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customerFindUnique: vi.fn(),
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
  SiteConflictError,
  SiteCustomerError,
  SiteInUseError,
  updateSite,
} from '@/lib/site-store'

const customer = { id: 'customer-1', code: 'ACME', name: 'Acme', isActive: true }
const storedSite = {
  id: 'site-1',
  customerId: 'customer-1',
  customer,
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
    mocks.siteFindMany.mockResolvedValue([])
  })

  it('creates multiple customer-scoped site records without external identity', async () => {
    mocks.siteCreate.mockResolvedValue(storedSite)

    const result = await createSite('customer-1', { name: 'Head office', code: 'hq', city: 'Zwolle' })

    expect(mocks.siteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'customer-1',
        name: 'Head office',
        code: 'HQ',
        source: 'MANUAL',
      }),
    }))
    expect(result).toMatchObject({ id: 'site-1', customerId: 'customer-1', deviceCount: 0 })
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
    mocks.siteCreate.mockResolvedValue({ ...storedSite, id: 'site-2', customerId: 'customer-2', customer: { ...customer, id: 'customer-2' } })

    await createSite('customer-2', { name: 'Head office', code: 'HQ' })

    expect(mocks.siteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'customer-2' } }))
    expect(mocks.siteCreate).toHaveBeenCalled()
  })

  it('supports archive-only updates without changing site identity', async () => {
    mocks.siteFindFirst.mockResolvedValue({ ...storedSite, customer: undefined, _count: undefined })
    mocks.siteFindMany.mockResolvedValue([{ id: 'site-1', name: 'Head office', code: 'HQ' }])
    mocks.siteUpdate.mockResolvedValue({ ...storedSite, isActive: false })

    await updateSite('customer-1', 'site-1', { isActive: false })

    expect(mocks.siteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'site-1' },
      data: expect.objectContaining({ name: 'Head office', code: 'HQ', isActive: false }),
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
