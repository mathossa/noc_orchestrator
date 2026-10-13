import { describe, expect, it } from 'vitest'
import { buildContractReportSections } from './inventory-contract-report'
import type { InventoryExportRecord } from './inventory-explorer-store'

const testDevice = (
  deviceId: string,
  contract: string,
  contractShowInReport = false,
): InventoryExportRecord => ({
  deviceId,
  customerId: 'customer-a',
  siteId: 'site-a',
  customer: 'Acme',
  site: 'HQ',
  deviceType: 'Firewall',
  name: deviceId,
  hostname: deviceId,
  vendor: 'Fortinet',
  model: 'FortiGate 100F',
  serialNumber: 'serial-' + deviceId,
  managementAddress: '',
  effectiveTarget: '7.4.8',
  targetPlatform: 'FortiOS',
  targetTrain: '7.4',
  policyContext: 'Customer policy',
  policyTrack: 'Accepted',
  currentFirmware: '7.4.6',
  primaryStatus: 'Update recommended',
  statusReason: '',
  technicalCompliance: 'ACCEPTED',
  recommendation: 'UPDATE_RECOMMENDED',
  exceptionState: 'NONE',
  exceptionReason: '',
  issueReason: '',
  workflow: '',
  contract,
  contractShowInReport,
  source: 'API',
  externalProvider: 'Auvik',
  externalId: 'source-' + deviceId,
  lastSynchronizedAt: '',
})

describe('internal contract report sections', () => {
  it('uses configured Contract Type names as report sections', () => {
    const sections = buildContractReportSections(
      [
        testDevice('fg-01', 'Pro-active', true),
        testDevice('fg-02', 'Active', true),
        testDevice('fg-03', ''),
      ],
      [
        { name: 'Pro-active', showInReport: true },
        { name: 'Active', showInReport: true },
      ],
    )

    expect(sections.map((section) => section.title)).toEqual([
      'Active',
      'Pro-active',
      'No contract',
    ])
    expect(sections.map((section) => section.report.deviceCount)).toEqual([1, 1, 1])
  })

  it('omits named contracts that are not marked Show in report', () => {
    const sections = buildContractReportSections([
      testDevice('fg-01', 'Premium management', false),
      testDevice('fg-02', 'Active', true),
      testDevice('fg-03', ''),
    ])

    expect(sections.map((section) => section.title)).toEqual([
      'Active',
      'No contract',
    ])
    expect(sections.flatMap((section) => section.report.devices).map((row) => row.name))
      .not.toContain('fg-01')
  })

  it('keeps configured report tabs even when the current filter has no matching devices', () => {
    const sections = buildContractReportSections(
      [],
      [
        { name: 'Pro-active', showInReport: true },
        { name: 'Active', showInReport: false },
      ],
    )

    expect(sections.map((section) => section.title)).toEqual([
      'Pro-active',
      'No contract',
    ])
    expect(sections.every((section) => section.report.deviceCount === 0)).toBe(true)
  })

  it('keeps No contract separate from any named Contract Type', () => {
    const sections = buildContractReportSections([
      testDevice('fg-01', 'No contract', true),
      testDevice('fg-02', ''),
    ])

    expect(sections.map((section) => section.title)).toEqual([
      'No contract',
      'No contract',
    ])
    expect(sections[0].key).toBe('contract:No contract')
    expect(sections[1].key).toBe('no-contract')
  })
})
