import { describe, expect, it } from 'vitest'
import { inventoryExportCsv } from './inventory-export'
import type { InventoryExportRecord } from './inventory-explorer-store'

function record(overrides: Partial<InventoryExportRecord> = {}): InventoryExportRecord {
  return {
    customer: 'Acme',
    site: 'HQ',
    deviceType: 'Switch',
    name: 'HQ-SW-01',
    hostname: 'hq-sw-01',
    vendor: 'Cisco',
    model: 'C9300-24P',
    serialNumber: 'SER-1',
    managementAddress: '10.0.0.1',
    currentFirmware: '17.12.5',
    effectiveTarget: '17.15.5',
    targetPlatform: 'IOS-XE',
    targetTrain: '17.15',
    policyContext: 'Site override',
    policyTrack: 'Stable',
    primaryStatus: 'Update required',
    statusReason: 'Below minimum',
    technicalCompliance: 'BELOW_MINIMUM',
    recommendation: 'UPDATE_REQUIRED',
    exceptionState: 'NONE',
    exceptionReason: '',
    workflow: '',
    contract: 'Full management',
    source: 'API',
    externalProvider: 'Auvik',
    externalId: 'device-1',
    lastSynchronizedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('inventory export CSV', () => {
  it('exports effective policy context and UTF-8 BOM for spreadsheet punctuation', () => {
    const csv = inventoryExportCsv([record({ statusReason: 'Accepted — update recommended.' })])
    const bytes = new TextEncoder().encode(csv)
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191])
    expect(new TextDecoder().decode(bytes)).toContain('Accepted — update recommended.')
    expect(csv).toContain('Effective target,Target platform,Target train,Policy source / scope,Policy track')
    expect(csv).toContain('17.15.5,IOS-XE,17.15,Site override,Stable')
  })

  it('exports detailed inventory fields and quotes CSV-sensitive values', () => {
    const csv = inventoryExportCsv([
      record({ customer: 'Acme, North', statusReason: 'Needs "review"' }),
    ])
    expect(csv).toContain('Primary inventory status')
    expect(csv).toContain('"Acme, North"')
    expect(csv).toContain('"Needs ""review"""')
    expect(csv).toContain('BELOW_MINIMUM')
    expect(csv).toContain('Auvik')
  })
})
