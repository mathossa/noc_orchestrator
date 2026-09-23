import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SiteWorkspace } from './site-detail'
import type { SiteDetailRecord } from '@/lib/sites'

function siteFixture(overrides: Partial<SiteDetailRecord> = {}): SiteDetailRecord {
  return {
    id: 'site-1',
    customerId: 'customer-1',
    organizationUnitId: null,
    organizationUnit: null,
    contractTypeId: null,
    customer: {
      id: 'customer-1',
      code: 'CUST',
      name: 'Example Customer',
      isActive: true,
      contractType: null,
    },
    contractType: null,
    effectiveContractType: null,
    contractSource: 'NONE',
    name: 'Amsterdam HQ',
    code: 'AMS-HQ',
    addressLine1: 'Keizersgracht 177',
    addressLine2: null,
    postalCode: '1016 DR',
    city: 'Amsterdam',
    region: 'Noord-Holland',
    country: 'Netherlands',
    notes: 'Primary office',
    isActive: true,
    source: 'API',
    externalProvider: 'Auvik',
    externalId: 'auvik-site-id-123',
    lastSynchronizedAt: '2026-09-23T12:00:00Z',
    deviceCount: 42,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-09-23T12:00:00Z',
    ...overrides,
  }
}

function render(site = siteFixture()) {
  return renderToStaticMarkup(createElement(SiteWorkspace, { site }))
}

describe('site workspace', () => {
  it('renders the location workspace and preserves the #107 inventory route', () => {
    const html = render()

    for (const text of [
      'Overview',
      'Network',
      'Inventory',
      'Notes',
      'History',
      'Site information',
      'Inventory summary',
      'Contract &amp; source',
      'Network drawing',
      'Keizersgracht 177',
      'Noord-Holland',
      'Amsterdam',
      '1016 DR',
      'Netherlands',
      '42',
    ]) {
      expect(html).toContain(text)
    }

    expect(html).toContain('/devices/customers/customer-1/sites/site-1')
    expect(html).not.toContain('https://auvik.com/site/')
    expect(html).not.toContain('Auvik URL')
  })

  it('includes a business unit in breadcrumbs only when the site has one', () => {
    const withoutUnit = render()
    expect(withoutUnit).not.toContain('Operations')

    const withUnit = render(
      siteFixture({
        organizationUnitId: 'unit-1',
        organizationUnit: {
          id: 'unit-1',
          customerId: 'customer-1',
          parentId: null,
          name: 'Operations',
          isActive: true,
        },
      }),
    )

    expect(withUnit).toContain('Operations')
    expect(withUnit).toContain('organizationUnit=unit-1')
  })

  it('does not treat externalId as a canonical Auvik URL', () => {
    const html = render(siteFixture({ externalId: 'https://example.auvik.com/site/123' }))
    expect(html).not.toContain('Auvik URL')
    expect(html).not.toContain('href="https://example.auvik.com/site/123"')
  })
})
