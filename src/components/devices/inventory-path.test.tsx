import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { InventoryPath } from './inventory-path'
import { InventoryOverview, CustomerInventory, SiteInventory, DeviceTypeInventory } from './inventory-explorer'
import { parseInventoryQuery } from '@/lib/inventory-explorer'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const query = parseInventoryQuery(new URLSearchParams('q=router&status=UPDATE_REQUIRED&page=4'))
const common = {
  counts: { total: 4, attention: 2, critical: 0, issues: 0, unknown: 0 },
  filters: { customers: [], sites: [], vendors: [], models: [], deviceTypes: [], contracts: [] },
  hierarchyMatches: [],
  searchHits: [],
}

describe('inventory drill-down', () => {
  it('renders resolved selection names while keeping future steps generic', () => {
    const html = renderToStaticMarkup(createElement(InventoryPath, {
      current: 2,
      selections: { customers: 'Unica Groep', sites: 'Zwolle' },
    }))
    expect(html).toContain('Unica Groep')
    expect(html).toContain('Zwolle')
    expect(html).toContain('Select a type')
    expect(html).not.toContain('Select a customer')
    expect(html).not.toContain('Select a site')
  })

  it('renders four stages with only previous levels linked and a current step', () => {
    const html = renderToStaticMarkup(
      createElement(InventoryPath, {
        current: 2,
        links: { customers: '/devices?q=router', sites: '/devices/customers/c-1?q=router' },
      }),
    )
    expect(html).toContain('aria-label="Inventory exploration steps"')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('Device types')
    expect(html).toContain('View devices')
    expect(html).toContain('href="/devices?q=router"')
    expect(html).toContain('href="/devices/customers/c-1?q=router"')
  })

  it('begins with customer inventory rather than an isolated customer manager and preserves filters', () => {
    const html = renderToStaticMarkup(
      createElement(InventoryOverview, {
        query,
        model: {
          ...common,
          customers: [{
            id: 'c-1', name: 'Customer One', siteCount: 1, deviceCount: 4,
            attentionCount: 2, issueCount: 0, criticalCount: 0, highestStatus: 'UPDATE_REQUIRED',
          }],
        },
      }),
    )
    expect(html).toContain('Manage customers')
    expect(html).toContain('href="/customers"')
    expect(html).toContain('href="/devices/customers/c-1?q=router&amp;status=UPDATE_REQUIRED"')
    expect(html).toContain('aria-current="step"')
  })

  it('retains search and status context while browsing sites and returning to customers', () => {
    const html = renderToStaticMarkup(
      createElement(CustomerInventory, {
        query,
        model: {
          ...common,
          customer: { id: 'c-1', name: 'Customer One' },
          sites: [{
            id: 's-1', name: 'Site One', deviceCount: 4,
            attentionCount: 2, issueCount: 0, criticalCount: 0, highestStatus: 'UPDATE_REQUIRED',
          }],
        },
      }),
    )
    expect(html).toContain('href="/devices?q=router&amp;status=UPDATE_REQUIRED"')
    expect(html).toContain('href="/devices/customers/c-1/sites/s-1?q=router&amp;status=UPDATE_REQUIRED"')
  })
  it('displays the selected customer on its site-selection step', () => {
    const html = renderToStaticMarkup(createElement(CustomerInventory, {
      query,
      model: { ...common, customer: { id: 'c-1', name: 'Unica Groep' }, sites: [] },
    }))
    expect(html).toContain('Unica Groep')
    expect(html).not.toContain('Select a customer')
    expect(html).toContain('Select a site')
  })

  it('displays the selected customer and site at the type-selection step', () => {
    const html = renderToStaticMarkup(createElement(SiteInventory, {
      query,
      model: {
        ...common,
        customer: { id: 'c-1', name: 'Unica Groep' },
        site: { id: 's-1', name: 'Zwolle', unassigned: false },
        deviceTypes: [],
      },
    }))
    expect(html).toContain('Unica Groep')
    expect(html).toContain('Zwolle')
    expect(html).not.toContain('Select a customer')
    expect(html).not.toContain('Select a site')
    expect(html).toContain('Select a type')
  })

  it('displays all selected levels on the device-selection step', () => {
    const html = renderToStaticMarkup(createElement(DeviceTypeInventory, {
      query,
      model: {
        ...common,
        customer: { id: 'c-1', name: 'Unica Groep' },
        site: { id: 's-1', name: 'Zwolle', unassigned: false },
        deviceType: { id: 't-1', name: 'Switches' },
        devices: [],
        pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
      },
    }))
    expect(html).toContain('Unica Groep')
    expect(html).toContain('Zwolle')
    expect(html).toContain('Switches')
    expect(html).not.toContain('Select a type')
    expect(html).toContain('View devices')
  })

})
