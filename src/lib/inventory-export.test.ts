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
