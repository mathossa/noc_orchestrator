import { describe, expect, it } from 'vitest'
import { buildInventoryReport, filterInventoryReportRows } from './inventory-report'
import type { InventoryExportRecord } from './inventory-explorer-store'

function row(overrides: Partial<InventoryExportRecord> = {}): InventoryExportRecord {
  return {
    deviceId: 'device-1',
    customerId: 'customer-1',
    siteId: 'site-1',
    customer: 'Customer A',
    site: 'HQ',
    deviceType: 'Firewall',
    name: 'FG-100F-01',
    hostname: 'fg-100f-01',
    vendor: 'Fortinet',
    model: 'FortiGate-100F',
    serialNumber: 'FG100FA0001',
    managementAddress: '10.0.0.1',
    currentFirmware: '7.4.8',
    effectiveTarget: '7.4.9',
    targetPlatform: 'FortiOS',
    targetTrain: '7.4',
    policyContext: 'Customer default',
    policyTrack: 'Stable',
    primaryStatus: 'Update recommended',
    statusReason: 'Preferred target differs',
    technicalCompliance: 'ACCEPTED',
    recommendation: 'UPDATE_RECOMMENDED',
    exceptionState: 'NONE',
    exceptionReason: '',
    issueReason: '',
    workflow: '',
    contract: 'Managed',
    source: 'API',
    externalProvider: 'Auvik',
    externalId: 'ext-1',
    lastSynchronizedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  }
}

describe('cross-customer inventory report aggregation', () => {
  it('groups by canonical Customer/Site identity, not display name, with accurate distributions', () => {
    const report = buildInventoryReport([
      row({ deviceId: 'dev-3', customerId: 'customer-2', customer: 'Acme', siteId: null, site: 'Unassigned', currentFirmware: '', contract: '', name: 'FG03' }),
      row({ deviceId: 'dev-2', customerId: 'customer-1', customer: 'Acme', siteId: 'site-2', site: 'Branch', currentFirmware: '7.2.11', contract: 'Basic', name: 'FG02' }),
      row({ deviceId: 'dev-1', customerId: 'customer-1', customer: 'Acme', siteId: 'site-1', site: 'HQ', currentFirmware: '7.4.8', contract: 'Managed', name: 'FG01' }),
    ])
    expect(report.deviceCount).toBe(3)
    expect(report.customerCount).toBe(2)
    expect(report.siteCount).toBe(3)
    expect(report.customers).toHaveLength(2)
    expect(report.customers.map((customer) => customer.id)).toEqual(['customer-1', 'customer-2'])
    expect(report.customers[0].sites.map((site) => site.name)).toEqual(['Branch', 'HQ'])
    expect(report.customers[1].sites[0].id).toBeNull()
    expect(report.unknownFirmwareCount).toBe(1)
    expect(report.missingContractCount).toBe(1)
    expect(report.firmwareDistribution).toEqual([
      { label: '7.2.11', count: 1 },
      { label: '7.4.8', count: 1 },
      { label: 'Unknown', count: 1 },
    ])
    expect(report.contractDistribution).toContainEqual({
      label: 'No management contract', count: 1,
    })
  })

  it('counts repeated versions and status independently without changing technical state', () => {
    const report = buildInventoryReport([
      row({ deviceId: 'dev-1', currentFirmware: '7.4.8' }),
      row({ deviceId: 'dev-2', currentFirmware: '7.4.8' }),
      row({ deviceId: 'dev-3', currentFirmware: '7.2.11', primaryStatus: 'Critical attention' }),
    ])
    expect(report.firmwareDistribution[0]).toEqual({ label: '7.4.8', count: 2 })
    expect(report.statusDistribution).toContainEqual({ label: 'Critical attention', count: 1 })
    expect(report.statusDistribution).toContainEqual({ label: 'Update recommended', count: 2 })
  })

  it('filters by running-version text but never infers advisory applicability', () => {
    const rows = [
      row({ deviceId: 'dev-1', currentFirmware: '7.4.8' }),
      row({ deviceId: 'dev-2', currentFirmware: '7.2.11' }),
      row({ deviceId: 'dev-3', currentFirmware: '' }),
    ]
    expect(filterInventoryReportRows(rows, ' 7.4 ')).toEqual([rows[0]])
    expect(filterInventoryReportRows(rows, '')).toEqual(rows)
    expect(filterInventoryReportRows(rows, '9.99')).toEqual([])
    expect(buildInventoryReport([])).toMatchObject({
      deviceCount: 0, customerCount: 0, siteCount: 0,
    })
  })
})
