import { describe, expect, it } from 'vitest'
import {
  excelSheetNames,
  inventoryWorkbookParts,
  inventoryReportXlsx,
} from './inventory-report-xlsx'
import type { InventoryExportRecord } from './inventory-explorer-store'

function device(
  id: string,
  customer: string,
  contract: string,
  contractShowInReport = false,
): InventoryExportRecord {
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
    contractShowInReport,
    source: 'API',
    externalProvider: 'Auvik',
    externalId: id,
    lastSynchronizedAt: '',
  }
}

describe('multi-sheet Excel inventory report', () => {
  const generated = '2026-10-12T15:30:00.000Z'

  it('uses report-enabled Contract Type names as worksheet names', () => {
    const parts = inventoryWorkbookParts(
      [
        device('fg-01', 'Acme', 'Pro-active', true),
        device('fg-02', 'Beta', 'Active', true),
        device('fg-03', 'Charlie', ''),
      ],
      generated,
      'Vendor: Fortinet',
      [
        { name: 'Pro-active', showInReport: true },
        { name: 'Active', showInReport: true },
      ],
    )
    const workbook = parts.find((part) => part.name === 'xl/workbook.xml')!.content
    const active = parts.find((part) => part.name === 'xl/worksheets/sheet1.xml')!.content
    const proactive = parts.find((part) => part.name === 'xl/worksheets/sheet2.xml')!.content

    expect(workbook).toContain('sheet name="Active"')
    expect(workbook).toContain('sheet name="Pro-active"')
    expect(workbook).toContain('sheet name="No contract"')
    expect(workbook).not.toContain('Other contracts')
    expect(parts.filter((part) => part.name.startsWith('xl/worksheets/sheet'))).toHaveLength(3)

    expect(active).toContain('Firmware inventory report — Active')
    expect(active).toContain('Beta')
    expect(active).toContain('fg-02')
    expect(active).not.toContain('fg-01')

    expect(proactive).toContain('Firmware inventory report — Pro-active')
    expect(proactive).toContain('Acme')
    expect(proactive).toContain('fg-01')
    expect(proactive).toContain('mergeCell ref="A1:H1"')
    expect(proactive).toContain('Running firmware')
  })

  it('omits contracts not marked Show in report and keeps cell content safe', () => {
    const parts = inventoryWorkbookParts([
      device('=cmd|danger', 'Alpha & Sons <HQ>', 'Managed Plus', true),
      device('hidden-device', 'Hidden Customer', 'Monitoring only', false),
    ], generated, 'All Customers')

    const workbook = parts.find((part) => part.name === 'xl/workbook.xml')!.content
    const managed = parts.find((part) => part.name === 'xl/worksheets/sheet1.xml')!.content

    expect(workbook).toContain('sheet name="Managed Plus"')
    expect(workbook).toContain('sheet name="No contract"')
    expect(workbook).not.toContain('Monitoring only')
    expect(managed).toContain('Alpha &amp; Sons &lt;HQ&gt;')
    expect(managed).toContain('<t xml:space="preserve">=cmd|danger</t>')
    expect(managed).toContain('t="inlineStr"')
    expect(managed).not.toContain('<f>')
    expect(managed).not.toContain('hidden-device')
  })

  it('creates one filterable Excel table per Customer block', () => {
    const parts = inventoryWorkbookParts(
      [
        device('fg-a1', 'Acme', 'Managed', true),
        device('fg-a2', 'Acme', 'Managed', true),
        device('fg-b1', 'Beta', 'Managed', true),
      ],
      generated,
      'Vendor: Fortinet',
      [{ name: 'Managed', showInReport: true }],
    )

    const sheet = parts.find((part) => part.name === 'xl/worksheets/sheet1.xml')!.content
    const rels = parts.find(
      (part) => part.name === 'xl/worksheets/_rels/sheet1.xml.rels',
    )!.content
    const table1 = parts.find((part) => part.name === 'xl/tables/table1.xml')!.content
    const table2 = parts.find((part) => part.name === 'xl/tables/table2.xml')!.content
    const contentTypes = parts.find((part) => part.name === '[Content_Types].xml')!.content

    expect(sheet).toContain('<tableParts count="2">')
    expect(sheet).toContain('<tablePart r:id="rId1"/>')
    expect(sheet).toContain('<tablePart r:id="rId2"/>')
    expect(rels).toContain('Target="../tables/table1.xml"')
    expect(rels).toContain('Target="../tables/table2.xml"')

    // Customer heading row stays outside each table. Filters/sorts are bounded
    // to the rows belonging to that one customer.
    expect(table1).toContain('ref="A6:H8"')
    expect(table1).toContain('<autoFilter ref="A6:H8"/>')
    expect(table2).toContain('ref="A11:H12"')
    expect(table2).toContain('<autoFilter ref="A11:H12"/>')
    expect(table1).toContain('name="Running firmware"')
    expect(table1).toContain('name="Site"')
    expect(table2).toContain('name="Running firmware"')
    expect(contentTypes).toContain('/xl/tables/table1.xml')
    expect(contentTypes).toContain('/xl/tables/table2.xml')
  })

  it('sanitizes dynamic Contract Type names for Excel while keeping them unique', () => {
    const names = excelSheetNames([
      'Managed / Premium',
      'Managed : Premium',
      'A very long contract type name that exceeds the Excel worksheet limit',
    ])

    expect(names[0]).toBe('Managed - Premium')
    expect(names[1]).toBe('Managed - Premium (2)')
    expect(names[2].length).toBeLessThanOrEqual(31)
  })

  it('returns an Excel-compatible ZIP workbook, including configured empty tabs', async () => {
    const xlsx = await inventoryReportXlsx(
      [],
      generated,
      'All inventory',
      [{ name: 'Pro-active', showInReport: true }],
    )
    expect(xlsx.subarray(0, 4).toString('hex')).toBe('504b0304')
    expect(xlsx.length).toBeGreaterThan(3000)
  })
})
