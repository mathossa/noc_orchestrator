import { describe, expect, it } from 'vitest'
import { inventoryWorkbookParts, inventoryReportXlsx } from './inventory-report-xlsx'
import type { InventoryExportRecord } from './inventory-explorer-store'

function device(id: string, customer: string, contract: string): InventoryExportRecord {
  return {
    deviceId: id,
    customerId: 'customer-' + customer,
    siteId: 'site-' + customer,
    issueReason: '',
    customer,
    site: 'HQ',
    deviceType: 'Firewall',
    name: id,
    hostname: id,
    vendor: 'Fortinet',
    model: 'FG-100F',
    serialNumber: 'Serial-' + id,
    managementAddress: '',
    effectiveTarget: '7.4.8',
    targetPlatform: 'FortiOS',
    targetTrain: '7.4',
    policyContext: '',
    policyTrack: '',
    currentFirmware: '7.4.6',
    primaryStatus: 'Update recommended',
    statusReason: '',
    technicalCompliance: 'ACCEPTED',
    recommendation: 'UPDATE_RECOMMENDED',
    exceptionState: 'NONE',
    exceptionReason: '',
    workflow: '',
    contract,
    source: 'API',
    externalProvider: 'Auvik',
    externalId: id,
    lastSynchronizedAt: '',
  }
}

describe('multi-sheet Excel inventory report', () => {
  const generated = '2026-10-12T15:30:00.000Z'
  it('creates exactly three standard contract sheets with merged report title and Customer subtitles', () => {
    const parts = inventoryWorkbookParts([
      device('fg-01', 'Acme', 'Pro-Active'),
      device('fg-02', 'Beta', 'Active'),
      device('fg-03', 'Charlie', ''),
    ], generated, 'Vendor: Fortinet')
    const workbook = parts.find((part) => part.name === 'xl/workbook.xml')!.content
    const proactive = parts.find((part) => part.name === 'xl/worksheets/sheet1.xml')!.content
    expect(workbook).toContain('sheet name="Pro-active"')
    expect(workbook).toContain('sheet name="Active"')
    expect(workbook).toContain('sheet name="No contract"')
    expect(workbook).not.toContain('Other contracts')
    expect(parts.filter((part) => part.name.startsWith('xl/worksheets/sheet'))).toHaveLength(3)
    expect(proactive).toContain('Firmware inventory report — Pro-active')
    expect(proactive).toContain('Acme')
    expect(proactive).toContain('fg-01')
    expect(proactive).not.toContain('fg-02')
    expect(proactive).toContain('mergeCell ref="A1:H1"')
    expect(proactive).toContain('Running firmware')
  })

  it('keeps unknown named contracts, escaping Excel XML and preventing formula evaluation', () => {
    const parts = inventoryWorkbookParts([
      device('=cmd|danger', 'Alpha & Sons <HQ>', 'Managed Plus'),
    ], generated, 'All Customers')
    const workbook = parts.find((part) => part.name === 'xl/workbook.xml')!.content
    const other = parts.find((part) => part.name === 'xl/worksheets/sheet4.xml')!.content
    expect(workbook).toContain('sheet name="Other contracts"')
    expect(other).toContain('Alpha &amp; Sons &lt;HQ&gt;')
    expect(other).toContain('<t xml:space="preserve">=cmd|danger</t>')
    expect(other).toContain('t="inlineStr"')
    expect(other).not.toContain('<f>')
  })

  it('returns an Excel-compatible ZIP workbook, including empty contract tabs', async () => {
    const xlsx = await inventoryReportXlsx([], generated, 'All inventory')
    expect(xlsx.subarray(0, 4).toString('hex')).toBe('504b0304')
    expect(xlsx.length).toBeGreaterThan(3000)
  })
})
