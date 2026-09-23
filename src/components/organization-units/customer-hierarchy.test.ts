import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildCustomerHierarchy, SiteTable } from './customer-hierarchy'
import type { OrganizationUnitRecord } from '@/lib/organization-units'
import type { SiteRecord } from '@/lib/sites'

function unit(id: string, name = id): OrganizationUnitRecord {
  return {
    id,
    customerId: 'customer-1',
    parentId: null,
    name,
    code: name.toUpperCase(),
    notes: null,
    isActive: true,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    sourceMetadata: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    siteCount: 0,
    deviceCount: 0,
  }
}

function site(id: string, organizationUnitId: string | null): SiteRecord {
  return {
    id,
    customerId: 'customer-1',
    organizationUnitId,
    organizationUnit: null,
    contractTypeId: null,
    customer: {
      id: 'customer-1',
      code: 'CUST',
      name: 'Customer',
      isActive: true,
      contractType: null,
    },
    contractType: null,
    effectiveContractType: null,
    contractSource: 'NONE',
    name: id,
    code: id.toUpperCase(),
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    region: null,
    country: null,
    notes: null,
    isActive: true,
    source: 'MANUAL',
    externalProvider: null,
    externalId: null,
    lastSynchronizedAt: null,
    deviceCount: 2,
  }
}

describe('customer hierarchy derivation', () => {
  it('goes directly to sites when the customer has no business units', () => {
    const result = buildCustomerHierarchy([], [site('site-1', null), site('site-2', null)])

    expect(result.usesBusinessUnits).toBe(false)
    expect(result.directSites).toHaveLength(2)
    expect(result.visibleUnits).toHaveLength(0)
  })

  it('groups sites under business units when units exist', () => {
    const operations = unit('operations', 'Operations')
    const result = buildCustomerHierarchy(
      [operations],
      [site('site-1', operations.id)],
    )

    expect(result.usesBusinessUnits).toBe(true)
    expect(result.visibleUnits).toHaveLength(1)
    expect(result.visibleUnits[0]?.children).toHaveLength(1)
    expect(result.directSites).toHaveLength(0)
  })

  it('keeps direct sites separate only for a genuinely mixed customer', () => {
    const operations = unit('operations', 'Operations')
    const result = buildCustomerHierarchy(
      [operations],
      [site('grouped-site', operations.id), site('direct-site', null)],
    )

    expect(result.usesBusinessUnits).toBe(true)
    expect(result.visibleUnits[0]?.children.map((record) => record.id)).toEqual(['grouped-site'])
    expect(result.directSites.map((record) => record.id)).toEqual(['direct-site'])
  })


  it('renders a site edit action using the existing site manager flow', () => {
    const html = renderToStaticMarkup(
      createElement(SiteTable, {
        customerId: 'customer-1',
        sites: [site('site-1', null)],
        caption: 'Customer sites',
      }),
    )

    expect(html).toContain('Edit')
    expect(html).toContain('/customers/customer-1/sites?edit=site-1')
    expect(html).not.toContain('border-l')
  })

  it('searches business-unit and site codes within the customer', () => {
    const operations = unit('operations', 'Operations')
    const direct = site('direct-site', null)
    direct.code = 'ZW-001'

    expect(buildCustomerHierarchy([operations], [direct], 'OPERATIONS').visibleUnits).toHaveLength(1)
    expect(buildCustomerHierarchy([operations], [direct], 'ZW-001').matchingDirectSites).toHaveLength(1)
  })
})
