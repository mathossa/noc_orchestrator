import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildFirmwareCampaigns } from '@/lib/dashboard-firmware-campaigns'
import type { WorkPackageFinding } from '@/lib/dashboard-work-packages'
import { campaignDashboardHref, campaignDetailHref, FirmwareCampaignOverview } from './firmware-campaign-overview'

const scope = { customer: '', vendor: '', contract: '', focus: '' as const, page: 1 }
const filters = {
  customers: [{ id: 'cust-a', name: 'Acme' }, { id: 'cust-b', name: 'Beta' }],
  sites: [],
  vendors: [{ id: 'fortinet', name: 'Fortinet' }],
  models: [],
  deviceTypes: [],
  contracts: [{ id: 'pro', name: 'Pro-active' }],
}

function row(id: string): WorkPackageFinding {
  return {
    deviceId: id, deviceName: id,
    customer: { id: id === 'b' ? 'cust-b' : 'cust-a', name: id === 'b' ? 'Beta' : 'Acme' },
    site: { id: 'site', name: 'Main' },
    deviceTypeId: 'firewall',
    vendor: { id: 'fortinet', name: 'Fortinet' },
    model: { id: 'FG-60F', name: 'FortiGate 60F' },
    currentFirmwareVersion: id === 'b' ? '7.4.7' : '7.4.5',
    currentTrain: '7.4',
    currentPlatform: 'FortiOS',
    targetVersion: '7.4.13',
    targetPlatform: 'FortiOS',
    targetTrain: '7.4',
    firmwareKey: id,
    status: 'UPDATE_REQUIRED',
    reason: 'Below approved minimum',
    managementContractId: 'pro',
    plan: null,
  }
}

describe('release-centric Werkoverzicht', () => {
  it('shows one campaign spanning two customers instead of one row per customer', () => {
    const campaigns = buildFirmwareCampaigns([row('a'), row('b')])
    const html = renderToStaticMarkup(createElement(FirmwareCampaignOverview, { campaigns, filters, scope }))
    expect(html).toContain('1 campagnes')
    expect(html).toContain('2 devices')
    expect(html).toContain('2 klanten')
    expect(html).toContain('7.4.5 (1)')
    expect(html).toContain('7.4.7 (1)')
    expect(html).toContain('7.4.13')
    expect(html.match(/Bekijk impact/g)).toHaveLength(1)
  })

  it('removes broad customer/device search from the operational dashboard', () => {
    const html = renderToStaticMarkup(createElement(FirmwareCampaignOverview, {
      campaigns: buildFirmwareCampaigns([row('a')]), filters, scope,
    }))
    expect(html).not.toContain('type="search"')
    expect(html).not.toContain('name="q"')
    expect(html).toContain('name="vendor"')
    expect(html).toContain('name="contract"')
  })

  it('links an exact campaign while carrying the dashboard scope separately', () => {
    const id = 'aabbcc'
    expect(campaignDetailHref(id, {
      customer: 'cust-a', vendor: 'fortinet', contract: 'pro',
    })).toBe('/dashboard/campaigns/aabbcc?scopeCustomer=cust-a&scopeVendor=fortinet&scopeContract=pro')
    expect(campaignDashboardHref({
      customer: 'cust-a', vendor: 'fortinet', contract: 'pro', focus: 'required', page: 1,
    })).toBe('/dashboard?customer=cust-a&vendor=fortinet&contract=pro&focus=required')
  })

  it('can filter campaigns by required devices without inventing advisory severity', () => {
    const campaigns = buildFirmwareCampaigns([row('a')])
    const html = renderToStaticMarkup(createElement(FirmwareCampaignOverview, {
      campaigns, filters, scope: { ...scope, focus: 'critical' as const },
    }))
    expect(html).toContain('Geen firmwarecampagnes in deze selectie.')
    expect(html).not.toContain('CVE-')
  })
})
