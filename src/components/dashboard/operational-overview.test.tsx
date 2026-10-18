import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperationalOverview, dashboardHref, type DashboardScope } from './operational-overview'
import { buildCandidateWorkPackages, type WorkPackageFinding } from '@/lib/dashboard-work-packages'

const scope: DashboardScope = {
  q: '', customer: '', vendor: '', contract: '', kind: '', page: 1,
}
const filters = {
  customers: [{ id: 'customer', name: 'Customer A' }],
  sites: [],
  vendors: [{ id: 'fortinet', name: 'Fortinet' }],
  models: [],
  deviceTypes: [],
  contracts: [{ id: 'proactive', name: 'Pro-active' }],
}

function finding(i: number, status: WorkPackageFinding['status']): WorkPackageFinding {
  return {
    deviceId: 'device-' + i,
    customer: { id: 'customer', name: 'Customer A' },
    site: { id: 'site', name: 'Main site' },
    deviceTypeId: 'firewall',
    vendor: { id: 'fortinet', name: 'Fortinet' },
    model: { id: 'model-' + i, name: 'Firewall ' + i },
    firmwareKey: '7.4.' + i,
    status,
    reason: 'Observed firmware does not meet the approved policy.',
    managementContractId: 'proactive',
    plan: null,
  }
}
const render = (items: WorkPackageFinding[], nextScope = scope) =>
  renderToStaticMarkup(createElement(OperationalOverview, {
    scope: nextScope, filters, packages: buildCandidateWorkPackages(items),
  }))

describe('action-driven Werkoverzicht', () => {
  it('shows the four clickable work-package totals, not device totals', () => {
    const html = render([
      finding(1, 'CRITICAL_ATTENTION'),
      finding(2, 'UPDATE_REQUIRED'),
      finding(3, 'UNKNOWN'),
    ])
    for (const label of ['Werkoverzicht', 'Urgent', 'Te plannen', 'Geblokkeerd', 'Te controleren']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('href="/dashboard?kind=URGENT"')
    expect(html).toContain('href="/dashboard?kind=TO_PLAN"')
    expect(html).toContain('href="/dashboard?kind=BLOCKED"')
    expect(html).toContain('href="/dashboard?kind=CHECK"')
    expect(html).toContain('Alle klanten')
    expect(html).toContain('Customer A')
  })

  it('retains customer/vendor/contract filters when an KPI card is clicked', () => {
    const filtered = {
      ...scope,
      q: 'fortigate',
      customer: 'customer',
      vendor: 'fortinet',
      contract: 'proactive',
      kind: 'URGENT' as const,
    }
    expect(dashboardHref(filtered, { kind: 'CHECK' })).toBe(
      '/dashboard?q=fortigate&customer=customer&vendor=fortinet&contract=proactive&kind=CHECK',
    )
    const html = render([finding(1, 'CRITICAL_ATTENTION'), finding(2, 'UNKNOWN')], filtered)
    expect(html).toContain('href="/dashboard?q=fortigate&amp;customer=customer&amp;vendor=fortinet&amp;contract=proactive&amp;kind=CHECK"')
    expect(html).toContain('aria-current="true"')
    expect(html).not.toContain('Check firmware data ·')
  })

  it('limits initial action list to eight items with working pagination', () => {
    const html = render(Array.from({ length: 15 }, (_, i) => finding(i, 'UPDATE_REQUIRED')))
    expect(html).toContain('href="/dashboard?page=2"')
    expect(html).toContain('1 / 2')
    expect(html).toContain('Firewall 0')
    expect(html).not.toContain('Firewall 8')
  })

  it('does not invent week trends, assignees, CVEs or deadlines', () => {
    const html = render([finding(1, 'UPDATE_REQUIRED')])
    expect(html).not.toContain('Weekvoortgang')
    expect(html).not.toContain('Vandaag')
    expect(html).not.toContain('Deadline')
    expect(html).not.toContain('CVE-')
  })

  it('shows clear empty state rather than invented package counts', () => {
    const html = render([])
    expect(html).toContain('Geen werkzaamheden in deze selectie.')
    expect(html).toContain('0 werkpakketten')
  })
})
