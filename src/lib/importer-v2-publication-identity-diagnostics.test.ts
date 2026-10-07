import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

import {
  findImporterV2StagedIdentityCollisions,
  formatImporterV2IdentityConflictMessage,
} from '@/lib/importer-v2-publication-identity-diagnostics'
import {
  importerV2WorkspaceEffectiveEvaluated,
  importerV2WorkspaceEffectiveText,
} from '@/lib/importer-v2-workspace-effective-overlay'

function row(input: {
  rowNumber: number
  name: string
  sourceId?: string | null
  serialNumber?: string | null
  macAddress?: string | null
}) {
  const sourceIdentifiers = {
    sourceId: input.sourceId ?? null,
    serialNumber: input.serialNumber ?? null,
    macAddress: input.macAddress ?? null,
  }
  return {
    rowNumber: input.rowNumber,
    sourceName: input.name,
    hostname: input.name,
    customer: 'Example customer',
    organizationUnit: null,
    site: 'Zwolle',
    vendor: 'Cisco',
    model: 'C9300-24P',
    selectedCanonicalDeviceId: null,
    sourceIdentifiers,
    normalized: {
      sourceId: sourceIdentifiers.sourceId,
      serialNumber: sourceIdentifiers.serialNumber?.toUpperCase() ?? null,
      macAddress: sourceIdentifiers.macAddress?.replace(/[^0-9a-f]/gi, '').toUpperCase() ?? null,
    },
  }
}

describe('Importer v2 publication identity diagnostics', () => {
  it('finds duplicate durable identity inside the staged publication set', () => {
    const collisions = findImporterV2StagedIdentityCollisions([
      row({ rowNumber: 5, name: 'switch-a', serialNumber: 'SER-001' }),
      row({ rowNumber: 8, name: 'switch-b', serialNumber: 'ser-001' }),
      row({ rowNumber: 9, name: 'switch-c', serialNumber: 'SER-009' }),
    ])

    expect(collisions.get(5)?.get(8)?.matchingIdentifiers).toEqual([
      { field: 'serialNumber', value: 'SER-001' },
    ])
    expect(collisions.get(8)?.get(5)?.matchingIdentifiers).toEqual([
      { field: 'serialNumber', value: 'ser-001' },
    ])
    expect(collisions.has(9)).toBe(false)
  })

  it('allows distinct Auvik APs to keep separate source IDs when a duplicated serial is explicitly ignored', () => {
    const effectiveAp = (sourceId: string) =>
      importerV2WorkspaceEffectiveEvaluated({
        evaluated: {
          rawValues: {
            sourceId,
            serialNumber: 'CNJMK9T1SV',
            macAddress: null,
          },
          proposedCanonicalValues: {
            sourceId: { id: null, label: sourceId },
            serialNumber: { id: null, label: 'CNJMK9T1SV' },
            macAddress: null,
          },
          issues: [],
        },
        inclusion: 'INCLUDED',
        decisions: [
          {
            field: 'serialNumber',
            action: 'IGNORE_FIELD',
            explanation:
              'Auvik reports the same serial on two distinct AP-303 devices.',
          },
        ],
      }).evaluated

    const ap01 = effectiveAp('auvik-ap01')
    const ap02 = effectiveAp('auvik-ap02')

    expect(ap01.rawValues?.serialNumber).toBe('CNJMK9T1SV')
    expect(ap02.rawValues?.serialNumber).toBe('CNJMK9T1SV')

    const collisions = findImporterV2StagedIdentityCollisions([
      row({
        rowNumber: 1,
        name: '7811KK44-AP01',
        sourceId: importerV2WorkspaceEffectiveText(ap01, 'sourceId'),
        serialNumber: importerV2WorkspaceEffectiveText(ap01, 'serialNumber'),
      }),
      row({
        rowNumber: 3,
        name: '7811KK44-AP02',
        sourceId: importerV2WorkspaceEffectiveText(ap02, 'sourceId'),
        serialNumber: importerV2WorkspaceEffectiveText(ap02, 'serialNumber'),
      }),
    ])

    expect(collisions.size).toBe(0)
  })

  it('formats staged row numbers and device names instead of a generic collision message', () => {
    const message = formatImporterV2IdentityConflictMessage([
      {
        rowNumber: 5,
        sourceName: 'switch-a',
        hostname: 'switch-a.local',
        selectedCanonicalDeviceId: null,
        sourceIdentifiers: {
          sourceId: null,
          serialNumber: 'SER-001',
          macAddress: null,
        },
        conflicts: [],
        stagedConflicts: [
          {
            rowNumber: 8,
            sourceName: 'switch-b',
            hostname: 'switch-b.local',
            customer: 'Example customer',
            organizationUnit: null,
            site: 'Zwolle',
            vendor: 'Cisco',
            model: 'C9300-24P',
            selectedCanonicalDeviceId: null,
            matchingIdentifiers: [
              { field: 'serialNumber', value: 'SER-001' },
            ],
          },
        ],
      },
    ])

    expect(message).toContain('Row #5 “switch-a”')
    expect(message).toContain('serial “SER-001”')
    expect(message).toContain('staged row #8 “switch-b”')
    expect(message).not.toBe('Durable source identity is now associated with another canonical device.')
  })
})
