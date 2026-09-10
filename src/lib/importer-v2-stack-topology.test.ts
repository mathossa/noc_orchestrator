import { describe, expect, it } from 'vitest'
import {
  automaticImporterV2StackTopologyDecisions,
  detectImporterV2StackGroups,
  importerV2PublicationIdentityFields,
  importerV2TopologyFromDecisions,
} from '@/lib/importer-v2-stack-topology'

function row(input: {
  id: string
  rowNumber: number
  name: string
  type?: string
  customer?: string
  site?: string
  serial?: string
}) {
  return {
    id: input.id,
    rowNumber: input.rowNumber,
    sourceName: input.name,
    customer: input.customer ?? 'Bouwmaatschappij Van Mierlo',
    site: input.site ?? 'Maasdijk',
    deviceType: input.type ?? 'Switch',
    evaluated: {
      rawValues: {
        deviceName: input.name,
        customer: input.customer ?? 'Bouwmaatschappij Van Mierlo',
        site: input.site ?? 'Maasdijk',
        deviceType: input.type ?? 'Switch',
        serialNumber: input.serial ?? null,
      },
      proposedCanonicalValues: {},
    },
  }
}

describe('Importer v2 stack topology', () => {
  it('detects Auvik stack parent and all Member N rows as one logical group', () => {
    const rows = [
      row({ id: 'p', rowNumber: 5, name: '071SWI0004.vmierlo.local', type: 'Stack', serial: 'FOC2036S1HV' }),
      row({ id: 'm1', rowNumber: 6, name: '071SWI0004.vmierlo.local Member 1', serial: 'FOC2036S1HV' }),
      row({ id: 'm2', rowNumber: 7, name: '071SWI0004.vmierlo.local Member 2', serial: 'FOC2036S1HX' }),
      row({ id: 'other', rowNumber: 8, name: 'ordinary-switch', serial: 'ABC' }),
    ]

    expect(detectImporterV2StackGroups({ provider: 'Auvik', rows })).toEqual([
      expect.objectContaining({
        parentRowNumber: 5,
        parentName: '071SWI0004.vmierlo.local',
        source: 'AUVIK_MEMBER_NAMING',
        memberRows: [
          { rowNumber: 6, memberIndex: 1, name: '071SWI0004.vmierlo.local Member 1' },
          { rowNumber: 7, memberIndex: 2, name: '071SWI0004.vmierlo.local Member 2' },
        ],
      }),
    ])
  })

  it('does not group a similarly named member from another customer/site', () => {
    const rows = [
      row({ id: 'p', rowNumber: 5, name: 'core-01', type: 'Stack', site: 'Maasdijk' }),
      row({ id: 'm1', rowNumber: 6, name: 'core-01 Member 1', site: 'Rotterdam' }),
    ]
    expect(detectImporterV2StackGroups({ provider: 'Auvik', rows })).toEqual([])
  })

  it('refuses ambiguous duplicate member positions', () => {
    const rows = [
      row({ id: 'p', rowNumber: 1, name: 'stack-a', type: 'Stack' }),
      row({ id: 'm1', rowNumber: 2, name: 'stack-a Member 1' }),
      row({ id: 'm1b', rowNumber: 3, name: 'stack-a Member 1' }),
    ]
    expect(detectImporterV2StackGroups({ provider: 'Auvik', rows })).toEqual([])
  })

  it('builds explicit parent/member topology decisions', () => {
    const rows = [
      row({ id: 'p', rowNumber: 9, name: '071SWI0005.vmierlo.local', type: 'Stack' }),
      row({ id: 'm1', rowNumber: 10, name: '071SWI0005.vmierlo.local Member 1' }),
    ]
    const result = automaticImporterV2StackTopologyDecisions({ provider: 'Auvik', rows })
    expect(result.groups).toHaveLength(1)
    expect(result.decisions).toHaveLength(2)
    expect(result.decisions[0]).toMatchObject({
      rowNumber: 9,
      action: 'TOPOLOGY_STACK_PARENT',
      value: { role: 'STACK', memberRows: [{ rowNumber: 10, memberIndex: 1 }] },
    })
    expect(result.decisions[1]).toMatchObject({
      rowNumber: 10,
      action: 'TOPOLOGY_STACK_MEMBER',
      value: { role: 'STACK_MEMBER', parentRowNumber: 9, memberIndex: 1 },
    })
    expect(importerV2TopologyFromDecisions(result.decisions.slice(1))).toMatchObject({
      role: 'STACK_MEMBER',
      parentRowNumber: 9,
      memberIndex: 1,
    })
  })

  it('uses only provider source ID as logical stack identity', () => {
    expect(importerV2PublicationIdentityFields({
      topology: {
        role: 'STACK',
        groupKey: 'g',
        parentRowNumber: 5,
        memberIndex: null,
        memberRows: [{ rowNumber: 6, memberIndex: 1 }],
        source: 'AUVIK_MEMBER_NAMING',
      },
      sourceId: 'auvik-stack-1',
      serialNumber: 'FOC2036S1HV',
      macAddress: '001122334455',
    })).toEqual({
      sourceId: 'auvik-stack-1',
      serialNumber: null,
      macAddress: null,
    })
  })
})
