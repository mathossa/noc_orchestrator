import { describe, expect, it } from 'vitest'
import { buildContractReportSections, contractReportCategory } from './inventory-contract-report'
import type { InventoryExportRecord } from './inventory-explorer-store'

const testDevice = (deviceId: string, contract: string): InventoryExportRecord => ({
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
  source: 'API',
  externalProvider: 'Auvik',
  externalId: 'source-' + deviceId,
  lastSynchronizedAt: '',
})

describe('internal contract report categories', () => {
  it('recognizes pro-active, active and absent contracts without vendor-license inference', () => {
    expect(contractReportCategory('Pro-Active')).toBe('PRO_ACTIVE')
    expect(contractReportCategory('Proactief beheer')).toBe('PRO_ACTIVE')
    expect(contractReportCategory('ACTIVE')).toBe('ACTIVE')
    expect(contractReportCategory('Actief')).toBe('ACTIVE')
    expect(contractReportCategory('')).toBe('NO_CONTRACT')
    expect(contractReportCategory('Geen contract')).toBe('NO_CONTRACT')
    expect(contractReportCategory('FortiCare Premium')).toBe('OTHER')
  })

  it('creates three sheets by default, grouped by customer within each', () => {
    const sections = buildContractReportSections([
      testDevice('fg-01', 'Pro-active'),
      testDevice('fg-02', 'Active'),
      testDevice('fg-03', ''),
    ])
    expect(sections.map((section) => section.title)).toEqual([
      'Pro-active', 'Active', 'No contract',
    ])
    expect(sections.map((section) => section.report.deviceCount)).toEqual([1, 1, 1])
    expect(sections[0].report.customers[0].name).toBe('Acme')
  })

  it('never mislabels another configured contract as having no contract', () => {
    const sections = buildContractReportSections([
      testDevice('fg-01', 'Full management'),
      testDevice('fg-02', ''),
    ])
    expect(sections.map((section) => section.title)).toEqual([
      'Pro-active', 'Active', 'No contract', 'Other contracts',
    ])
    expect(sections[2].report.devices.map((device) => device.name)).toEqual(['fg-02'])
    expect(sections[3].report.devices.map((device) => device.name)).toEqual(['fg-01'])
  })
})
