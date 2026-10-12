import { describe, expect, it } from 'vitest'
import { suggestAuvikTenantHierarchy } from '@/lib/auvik-tenant-matching'
import type { AuvikTenantResource } from '@/lib/auvik-api-client'

const customer = {
  name: 'Northwind',
  organizationUnits: [{ id: 'ou-1', name: 'Corporate', isActive: true }],
  sites: [
    { name: 'Headquarters', isActive: true, organizationUnitId: 'ou-1' },
    { name: 'Warehouse', isActive: true, organizationUnitId: null },
  ],
}

const tenant = (attributes: AuvikTenantResource['attributes']): AuvikTenantResource => ({
  id: '12345', type: 'tenant', attributes,
})

describe('Auvik tenant hierarchy suggestions', () => {
  it('matches an unambiguous customer, site, and optional business unit', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: '12345xyz', tenantType: 'client',
      clientName: ' NORTHWIND ', siteName: 'headquarters',
    }), [customer])).toEqual({
      customer: 'Northwind', businessUnit: 'Corporate', site: 'Headquarters',
      status: 'CUSTOMER_AND_SITE',
    })
  })

  it('suggests only the customer without explicit matching site evidence', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'northwind', tenantType: 'client', clientName: 'Northwind',
    }), [customer])).toEqual({
      customer: 'Northwind', businessUnit: null, site: null, status: 'CUSTOMER',
    })
  })

  it('does not mistake an opaque domain prefix for a customer', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'Northwind', tenantType: 'client',
    }), [customer])).toBeNull()
  })

  it('refuses ambiguous duplicate canonical customer names', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'unimportant', tenantType: 'client', name: 'Northwind',
    }), [customer, { ...customer, name: 'northwind' }])).toBeNull()
  })

  it('does not choose between two same-name sites', () => {
    expect(suggestAuvikTenantHierarchy(tenant({
      domainPrefix: 'prefix', tenantType: 'client',
      clientName: 'Northwind', siteName: 'Warehouse',
    }), [{ ...customer, sites: [...customer.sites, { ...customer.sites[1] }] }]))
      .toMatchObject({ customer: 'Northwind', site: null, status: 'CUSTOMER' })
  })
})
