import { describe, expect, it } from 'vitest'
import { diffImporterV2RepeatImport } from '@/lib/importer-v2-repeat-diff'

const previous = {
  rowNumber: 2,
  canonicalDeviceId: 'device-1',
  identifiers: {
    sourceId: 'source-1',
    serialNumber: 'SER-1',
    macAddress: 'aa:bb:cc:dd:ee:01',
  },
  values: {
    customer: 'DHL',
    businessUnit: 'eCom',
    site: 'Alkmaar',
    deviceName: 'old-name',
    hostname: 'old-name',
    managementAddress: '10.0.0.1',
    currentFirmware: '10.13.1000',
  },
} as const

describe('Importer v2 repeat-import diff', () => {
  it('keeps unchanged rows visible and requiring confirmation', () => {
    const result = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [
        {
          rowNumber: 5,
          canonicalDeviceId: 'device-1',
          identityStatus: 'MATCHED',
          identifiers: previous.identifiers,
          values: previous.values,
          canonicalValues: previous.values,
        },
      ],
      isFullInventoryExport: true,
    })

    expect(result.items[0]).toMatchObject({
      classification: 'UNCHANGED',
      requiresConfirmation: true,
      previousRowNumber: 2,
    })
  })

  it('classifies a durable device move and rename without creating a new identity', () => {
    const result = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [
        {
          rowNumber: 5,
          canonicalDeviceId: 'device-1',
          identityStatus: 'MATCHED',
          identifiers: previous.identifiers,
          values: {
            ...previous.values,
            site: 'Amersfoort',
            deviceName: 'new-name',
            hostname: 'new-name',
          },
          canonicalValues: previous.values,
        },
      ],
      isFullInventoryExport: false,
    })

    expect(result.items[0]).toMatchObject({
      classification: 'MOVED',
      canonicalDeviceId: 'device-1',
      changeKinds: ['MOVED', 'RENAMED'],
    })
  })

  it('allows source-owned and observed-firmware proposals while protecting manual values', () => {
    const result = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [
        {
          rowNumber: 5,
          canonicalDeviceId: 'device-1',
          identityStatus: 'MATCHED',
          identifiers: previous.identifiers,
          values: {
            ...previous.values,
            hostname: 'source-new-name',
            managementAddress: '10.0.0.2',
            currentFirmware: '10.13.1100',
          },
          canonicalValues: {
            ...previous.values,
            hostname: 'manually-maintained-name',
          },
        },
      ],
      isFullInventoryExport: false,
    })

    const proposals = result.items[0]?.proposals ?? []
    expect(proposals.find((proposal) => proposal.field === 'hostname')).toMatchObject({
      allowed: false,
      reason: 'MANUAL_VALUE_PROTECTED',
    })
    expect(
      proposals.find((proposal) => proposal.field === 'managementAddress'),
    ).toMatchObject({ allowed: true, reason: 'SOURCE_OWNED_VALUE' })
    expect(
      proposals.find((proposal) => proposal.field === 'currentFirmware'),
    ).toMatchObject({ allowed: true, reason: 'OBSERVED_CURRENT_FIRMWARE' })
  })

  it('never deletes missing devices and only proposes inactivity for a full inventory export', () => {
    const partial = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [],
      isFullInventoryExport: false,
    })
    const full = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [],
      isFullInventoryExport: true,
    })

    expect(partial.items[0]?.inactiveProposal).toMatchObject({
      proposed: false,
      allowed: false,
      reason: 'NOT_FULL_INVENTORY_EXPORT',
    })
    expect(full.items[0]?.inactiveProposal).toMatchObject({
      proposed: true,
      allowed: true,
      requiresConfirmation: true,
      reason: 'FULL_INVENTORY_CONFIRMATION_REQUIRED',
    })
  })

  it('suppresses unsafe inactivity proposals when an ambiguous row could be the missing device', () => {
    const result = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [
        {
          rowNumber: 8,
          canonicalDeviceId: null,
          identityStatus: 'AMBIGUOUS',
          identifiers: { serialNumber: 'SER-1' },
          values: { deviceName: 'maybe-device-1' },
        },
      ],
      isFullInventoryExport: true,
    })

    expect(result.items.map((item) => item.classification)).toEqual([
      'AMBIGUOUS',
      'MISSING',
    ])
    expect(result.items[1]?.inactiveProposal).toMatchObject({
      proposed: false,
      allowed: false,
      reason: 'AMBIGUOUS_IDENTITY_OVERLAP',
    })
  })

  it('classifies source devices with no previous confirmed identity as new', () => {
    const result = diffImporterV2RepeatImport({
      previousRows: [previous],
      currentRows: [
        {
          rowNumber: 7,
          canonicalDeviceId: null,
          identityStatus: 'NEW',
          identifiers: { sourceId: 'source-2' },
          values: { deviceName: 'new-device' },
        },
      ],
      isFullInventoryExport: false,
    })

    expect(result.items[0]?.classification).toBe('NEW')
    expect(result.items[1]?.classification).toBe('MISSING')
  })

  it('does not create an inactivity proposal for a snapshot-only row without a canonical device', () => {
    const result = diffImporterV2RepeatImport({
      previousRows: [
        {
          rowNumber: 11,
          canonicalDeviceId: null,
          identifiers: { sourceId: 'intentionally-ignored' },
          values: { deviceName: 'ignored-device-type' },
        },
      ],
      currentRows: [],
      isFullInventoryExport: true,
    })

    expect(result.items).toEqual([])
    expect(result.summary.MISSING).toBe(0)
  })
})
