import { describe, expect, it } from 'vitest'
import {
  automaticImporterV2KnownHaTopologyDecisions,
  validateImporterV2ConfirmedHaPair,
} from '@/lib/importer-v2-ha-topology'

function row(input: {
  id: string
  rowNumber: number
  sourceId: string
  name: string
  serial?: string | null
  mac?: string | null
  customer?: string
  site?: string
  model?: string
}) {
  return {
    id: input.id,
    rowNumber: input.rowNumber,
    inclusion: 'INCLUDED',
    sourceName: input.name,
    hostname: input.name,
    decisions: [],
    evaluated: {
      rawValues: {
        sourceId: input.sourceId,
        deviceName: input.name,
        hostname: input.name,
        serialNumber: input.serial ?? null,
        macAddress: input.mac ?? null,
        customer: input.customer ?? 'Example customer',
        businessUnit: 'Network',
        site: input.site ?? 'Deventer',
        vendor: 'Fortinet',
        deviceType: 'Firewall',
        model: input.model ?? 'FortiGate-100F',
      },
      proposedCanonicalValues: {
        customer: { id: 'customer-1', label: input.customer ?? 'Example customer' },
        businessUnit: { id: 'unit-1', label: 'Network' },
        site: { id: 'site-1', label: input.site ?? 'Deventer' },
        vendor: { id: 'vendor-fortinet', label: 'Fortinet' },
        deviceType: { id: 'type-firewall', label: 'Firewall' },
        model: { id: 'model-100f', label: input.model ?? 'FortiGate-100F' },
      },
    },
  }
}

describe('Importer v2 confirmed HA topology', () => {
  it('accepts two differently named members with distinct Source IDs and one shared source alias', () => {
    const group = validateImporterV2ConfirmedHaPair({
      provider: 'AUVIK',
      rows: [
        row({
          id: 'row-a',
          rowNumber: 20,
          sourceId: 'source-b',
          name: 'FW02',
          serial: 'FG-CLUSTER-SERIAL',
        }),
        row({
          id: 'row-b',
          rowNumber: 10,
          sourceId: 'source-a',
          name: 'FW01',
          serial: 'FG-CLUSTER-SERIAL',
        }),
      ],
    })

    expect(group).toMatchObject({
      kind: 'HA',
      parentRowNumber: 10,
      sharedIdentifiers: ['serialNumber'],
      source: 'ENGINEER_CONFIRMED',
      memberRows: [
        {
          rowNumber: 10,
          memberIndex: 1,
          sourceId: 'source-a',
          name: 'FW01',
        },
        {
          rowNumber: 20,
          memberIndex: 2,
          sourceId: 'source-b',
          name: 'FW02',
        },
      ],
    })
    expect(group.groupKey).toMatch(/^ha:[0-9a-f]{32}$/)
  })

  it('rejects a pair that is not in the same canonical site/model context', () => {
    expect(() =>
      validateImporterV2ConfirmedHaPair({
        provider: 'AUVIK',
        rows: [
          row({
            id: 'row-a',
            rowNumber: 1,
            sourceId: 'source-a',
            name: 'FW01',
            serial: 'SHARED',
            site: 'Deventer',
          }),
          row({
            id: 'row-b',
            rowNumber: 2,
            sourceId: 'source-b',
            name: 'FW02',
            serial: 'SHARED',
            site: 'Zwolle',
          }),
        ],
      }),
    ).toThrow('same site')
  })

  it('rejects equal Source IDs and unrelated physical observations', () => {
    expect(() =>
      validateImporterV2ConfirmedHaPair({
        provider: 'AUVIK',
        rows: [
          row({
            id: 'row-a',
            rowNumber: 1,
            sourceId: 'same-source',
            name: 'FW01',
            serial: 'SHARED',
          }),
          row({
            id: 'row-b',
            rowNumber: 2,
            sourceId: 'same-source',
            name: 'FW02',
            serial: 'SHARED',
          }),
        ],
      }),
    ).toThrow('different provider Source IDs')

    expect(() =>
      validateImporterV2ConfirmedHaPair({
        provider: 'AUVIK',
        rows: [
          row({
            id: 'row-a',
            rowNumber: 1,
            sourceId: 'source-a',
            name: 'FW01',
            serial: 'SERIAL-A',
          }),
          row({
            id: 'row-b',
            rowNumber: 2,
            sourceId: 'source-b',
            name: 'FW02',
            serial: 'SERIAL-B',
          }),
        ],
      }),
    ).toThrow('share the serial or MAC alias')
  })

  it('rehydrates a persisted HA topology from member Source IDs on a later sync', () => {
    const result = automaticImporterV2KnownHaTopologyDecisions({
      rows: [
        row({
          id: 'new-row-b',
          rowNumber: 75,
          sourceId: 'source-b',
          name: 'FW02',
          serial: 'REAL-MEMBER-B',
        }),
        row({
          id: 'new-row-a',
          rowNumber: 42,
          sourceId: 'source-a',
          name: 'FW01',
          serial: 'REAL-MEMBER-A',
        }),
      ],
      topologies: [
        {
          sourceGroupKey: 'ha:existing',
          members: [
            { position: 1, sourceId: 'source-a' },
            { position: 2, sourceId: 'source-b' },
          ],
        },
      ],
    })

    expect(result.groups).toEqual([
      expect.objectContaining({
        groupKey: 'ha:existing',
        parentRowNumber: 42,
        source: 'PERSISTED_TOPOLOGY',
        memberRows: [
          expect.objectContaining({
            rowNumber: 42,
            memberIndex: 1,
            sourceId: 'source-a',
          }),
          expect.objectContaining({
            rowNumber: 75,
            memberIndex: 2,
            sourceId: 'source-b',
          }),
        ],
      }),
    ])
    expect(result.decisions).toEqual([
      expect.objectContaining({
        rowNumber: 42,
        action: 'TOPOLOGY_HA_PARENT',
        value: expect.objectContaining({
          role: 'HA',
          parentRowNumber: 42,
        }),
      }),
      expect.objectContaining({
        rowNumber: 75,
        action: 'TOPOLOGY_HA_MEMBER',
        value: expect.objectContaining({
          role: 'HA_MEMBER',
          parentRowNumber: 42,
          memberIndex: 2,
        }),
      }),
    ])
  })

  it('can keep the logical HA identity when only one known member is observed', () => {
    const result = automaticImporterV2KnownHaTopologyDecisions({
      rows: [
        row({
          id: 'row-b',
          rowNumber: 88,
          sourceId: 'source-b',
          name: 'FW02',
          serial: 'REAL-MEMBER-B',
        }),
      ],
      topologies: [
        {
          sourceGroupKey: 'ha:existing',
          members: [
            { position: 1, sourceId: 'source-a' },
            { position: 2, sourceId: 'source-b' },
          ],
        },
      ],
    })

    expect(result.groups[0]).toMatchObject({
      parentRowNumber: 88,
      memberRows: [
        expect.objectContaining({
          rowNumber: 88,
          memberIndex: 2,
        }),
      ],
    })
    expect(result.decisions[0]).toMatchObject({
      action: 'TOPOLOGY_HA_PARENT',
      value: expect.objectContaining({
        role: 'HA',
        memberRows: [{ rowNumber: 88, memberIndex: 2 }],
      }),
    })
  })
})
