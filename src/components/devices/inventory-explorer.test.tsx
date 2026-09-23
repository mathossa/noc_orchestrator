import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CustomerInventory, DeviceTypeInventory, InventoryOverview, SiteInventory } from './inventory-explorer'
import { parseInventoryQuery } from '@/lib/inventory-explorer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
const query = parseInventoryQuery(new URLSearchParams())
const counts = { total: 6, attention: 5, critical: 1, issues: 0, unknown: 0 }
const filters = { vendors: [], models: [], deviceTypes: [], contracts: [] }
const common = { counts, filters, searchHits: [], hierarchyMatches: [] }
const row = { id: 'scope', name: 'Scope', deviceCount: 6, attentionCount: 5, criticalCount: 1, issueCount: 0, highestStatus: 'CRITICAL_ATTENTION' as const }
const customer = { id: 'customer', name: 'Customer' }
const site = { id: 'site', name: 'Site', unassigned: false }

describe('inventory operational rendering', () => {
  it('shows critical and ordinary counts without double-counting on every aggregate screen', () => {
    const pages = [
      createElement(InventoryOverview, { query, model: { ...common, customers: [{ ...row, siteCount: 1 }] } }),
      createElement(CustomerInventory, { query, model: { ...common, customer, sites: [row] } }),
      createElement(SiteInventory, { query, model: { ...common, customer, site, deviceTypes: [row] } }),
    ]
    for (const page of pages) {
      const html = renderToStaticMarkup(page)
      expect(html).toContain('1 critical · 4 attention')
      expect(html).toContain('5 devices need attention; 1 critical')
      expect(html).toContain('bg-[var(--danger-soft)]')
      expect(html).not.toContain('1 critical · 5 attention')
    }
  })

  it('retains healthy rows and does not label healthy inventory critical', () => {
    const html = renderToStaticMarkup(createElement(InventoryOverview, { query, model: { ...common, customers: [{ ...row, siteCount: 1, attentionCount: 0, criticalCount: 0, highestStatus: 'CURRENT' }] } }))
    expect(html).toContain('No devices need attention')
    expect(html).toContain('Healthy')
  })

  it('shows effective target and policy decisions at device-group level', () => {
    const html = renderToStaticMarkup(createElement(DeviceTypeInventory, { query, model: {
      ...common, customer, site, deviceType: { id: 'ap', name: 'Access Point' },
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      devices: [{ id: 'device', name: 'AP001', hostname: null, model: 'AP-505', currentFirmware: '8.10.0', effectiveTarget: '10.5.5', targetPlatform: 'AOS-10', targetTrain: '10.5', policyContext: 'Site override', issueReason: null, decision: 'Planned', customer, site, deviceType: { id: 'ap', name: 'Access Point' }, status: { code: 'UPDATE_RECOMMENDED', label: 'Migration recommended', attention: true, severity: 200, reason: 'Platform migration', tone: 'recommended' } }],
    } }))
    for (const text of ['8.10.0', '10.5.5', 'AOS-10', 'Site override', 'Planned', 'Migration recommended']) expect(html).toContain(text)
    expect(html).not.toContain('Serial number')
  })
})
