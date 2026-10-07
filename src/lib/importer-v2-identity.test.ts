import { describe, expect, it } from 'vitest'
import {
  analyzeImporterV2SourceRowIdentities,
  importerV2SourceIdentityForCrosswalk,
  normalizeImporterV2Identity,
  resolveImporterV2Identity,
} from '@/lib/importer-v2-identity'

describe('Importer v2 stable device identity', () => {
  it('automatically trusts a unique high-confidence provider source identity', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Auvik',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { sourceId: ' device-42 ' },
        context: { hostname: 'new-name', site: 'New site', model: 'AP-515' },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          crosswalkId: 'crosswalk-1',
          identifiers: { sourceId: 'device-42' },
          context: { hostname: 'old-name', site: 'Old site', model: 'AP-505' },
        },
      ],
    )

    expect(result.kind).toBe('MATCH_SUGGESTED')
    expect(result.requiresConfirmation).toBe(false)
    expect(result.candidates[0]?.confidence).toBe('HIGH')
    expect(result.candidates[0]?.contextDifferences.map((item) => item.field)).toEqual(
      expect.arrayContaining(['hostname', 'site', 'model']),
    )
  })

  it('keeps a unique provider source ID automatic when a stale serial changed', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Auvik',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { sourceId: 'device-42', serialNumber: 'AUVIK-WRONG-SERIAL' },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          crosswalkId: 'crosswalk-1',
          identifiers: { sourceId: 'device-42', serialNumber: 'CORRECTED-SERIAL' },
        },
      ],
    )

    expect(result.kind).toBe('MATCH_SUGGESTED')
    expect(result.requiresConfirmation).toBe(false)
    expect(result.candidates[0]).toMatchObject({
      canonicalDeviceId: 'device-1',
      confidence: 'HIGH',
    })
    expect(result.candidates[0]?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'SOURCE_ID', status: 'AGREE' }),
        expect.objectContaining({ kind: 'SERIAL_NUMBER', status: 'DISAGREE' }),
      ]),
    )
  })

  it('keeps raw source aliases for the crosswalk while allowing a corrected canonical serial', () => {
    expect(
      importerV2SourceIdentityForCrosswalk({
        rawIdentifiers: {
          sourceId: ' auvik-device-42 ',
          serialNumber: 'AUVIK-WRONG-SERIAL',
          macAddress: null,
        },
        effectiveIdentifiers: {
          sourceId: 'auvik-device-42',
          serialNumber: 'CORRECTED-SERIAL',
          macAddress: 'aa:bb:cc:dd:ee:ff',
        },
      }),
    ).toEqual({
      sourceId: 'auvik-device-42',
      serialNumber: 'AUVIK-WRONG-SERIAL',
      macAddress: 'aa:bb:cc:dd:ee:ff',
    })
  })

  it('does not restore an explicitly ignored raw serial into the durable crosswalk', () => {
    expect(
      importerV2SourceIdentityForCrosswalk({
        rawIdentifiers: {
          sourceId: 'auvik-ap01',
          serialNumber: 'CNJMK9T1SV',
          macAddress: null,
        },
        effectiveIdentifiers: {
          sourceId: 'auvik-ap01',
          serialNumber: null,
          macAddress: null,
        },
        suppressedSourceFields: ['serialNumber'],
      }),
    ).toEqual({
      sourceId: 'auvik-ap01',
      serialNumber: null,
      macAddress: null,
    })
  })

  it('proposes a valid unmatched durable identity as a new device without row-by-row confirmation', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Auvik',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { sourceId: 'new-device-42', serialNumber: 'CN42' },
      },
      [],
    )

    expect(result).toMatchObject({
      kind: 'NEW',
      requiresConfirmation: false,
      options: ['CREATE_NEW', 'MANUAL_OVERRIDE'],
    })
  })

  it('treats a unique serial-only match as medium confidence and keeps it reviewable', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Inventory',
        sourceAdapterId: 'api-v1',
        identifiers: { serialNumber: ' cn123 ' },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          identifiers: { serialNumber: 'CN123' },
        },
      ],
    )

    expect(result.kind).toBe('MATCH_SUGGESTED')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.candidates[0]?.confidence).toBe('MEDIUM')
  })

  it('keeps source-id and serial evidence pointing to different devices ambiguous', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Auvik',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { sourceId: 'source-7', serialNumber: 'SERIAL-7' },
      },
      [
        {
          canonicalDeviceId: 'device-a',
          identifiers: { sourceId: 'source-7', serialNumber: 'OTHER' },
        },
        {
          canonicalDeviceId: 'device-b',
          identifiers: { sourceId: 'other-source', serialNumber: 'SERIAL-7' },
        },
      ],
    )

    expect(result.kind).toBe('AMBIGUOUS')
    expect(result.candidates.map((candidate) => candidate.canonicalDeviceId)).toEqual([
      'device-a',
      'device-b',
    ])
    expect(result.options).toEqual([
      'CHOOSE_CANDIDATE',
      'CREATE_NEW',
      'MANUAL_OVERRIDE',
    ])
  })

  it('does not use customer or hierarchy context to resolve a cross-organization serial collision', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Inventory',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { serialNumber: 'SHARED-SERIAL' },
        context: { customer: 'Customer A', site: 'Amsterdam' },
      },
      [
        {
          canonicalDeviceId: 'customer-a-device',
          identifiers: { serialNumber: 'SHARED-SERIAL' },
          context: { customer: 'Customer A', site: 'Amsterdam' },
        },
        {
          canonicalDeviceId: 'customer-b-device',
          identifiers: { serialNumber: 'SHARED-SERIAL' },
          context: { customer: 'Customer B', site: 'Rotterdam' },
        },
      ],
    )

    expect(result.kind).toBe('AMBIGUOUS')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every((candidate) => candidate.confidence === 'MEDIUM')).toBe(
      true,
    )
  })

  it('does not auto-resolve reused serial evidence', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Inventory',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { serialNumber: 'STACK-SERIAL' },
      },
      [
        {
          canonicalDeviceId: 'logical-stack',
          identifiers: { serialNumber: 'STACK-SERIAL' },
        },
        {
          canonicalDeviceId: 'physical-member',
          identifiers: { serialNumber: 'STACK-SERIAL' },
        },
      ],
    )

    expect(result.kind).toBe('AMBIGUOUS')
    expect(result.candidates).toHaveLength(2)
  })

  it('requires at least one valid durable identifier before proposing a new device', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Inventory',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { macAddress: 'not-a-mac' },
        context: { hostname: 'looks-familiar', model: '6200F' },
      },
      [],
    )

    expect(result.kind).toBe('INVALID')
    expect(result.options).toEqual([])
  })

  it('never treats equal Source ID text from another provider as identity agreement', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-api-v1',
        identifiers: { sourceId: '123' },
      },
      [
        {
          canonicalDeviceId: 'device-auvik',
          matchScope: 'CROSS_PROVIDER',
          identifiers: { sourceId: '123' },
          evidence: [
            {
              kind: 'CROSSWALK',
              provider: 'AUVIK',
              sourceId: '123',
              serialNumber: null,
              macAddress: null,
            },
          ],
        },
      ],
    )

    expect(result.kind).toBe('NEW')
    expect(result.candidates).toEqual([])
  })

  it('automatically converges when a new provider agrees on serial and MAC', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-api-v1',
        identifiers: {
          sourceId: 'aruba-1',
          serialNumber: 'SERIAL1',
          macAddress: '00:11:22:33:44:55',
        },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          matchScope: 'CROSS_PROVIDER',
          identifiers: {
            serialNumber: 'SERIAL1',
            macAddress: '00:11:22:33:44:55',
          },
        },
      ],
    )

    expect(result).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: false,
    })
    expect(result.candidates[0]).toMatchObject({
      canonicalDeviceId: 'device-1',
      confidence: 'HIGH',
      matchScope: 'CROSS_PROVIDER',
    })
    expect(
      result.candidates[0]?.signals.find((signal) => signal.kind === 'SOURCE_ID'),
    ).toMatchObject({ status: 'MISSING', candidateValue: null })
  })

  it('accepts a unique canonical serial with compatible vendor/model context', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-api-v1',
        identifiers: { serialNumber: 'AP01-CORRECT' },
        context: {
          vendor: 'Aruba',
          model: 'AP-515',
          site: 'Zwolle',
        },
      },
      [
        {
          canonicalDeviceId: 'ap01',
          matchScope: 'CANONICAL',
          identifiers: { serialNumber: 'AP01-CORRECT' },
          context: {
            vendor: 'Aruba',
            model: 'AP-515',
            site: 'Zwolle',
          },
        },
      ],
    )

    expect(result).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: false,
    })
    expect(result.candidates[0]?.confidence).toBe('HIGH')
  })

  it('requires review when serial and MAC point to different canonical devices', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-api-v1',
        identifiers: {
          serialNumber: 'SERIAL-A',
          macAddress: '00:11:22:33:44:55',
        },
      },
      [
        {
          canonicalDeviceId: 'device-a',
          matchScope: 'CROSS_PROVIDER',
          identifiers: { serialNumber: 'SERIAL-A' },
        },
        {
          canonicalDeviceId: 'device-b',
          matchScope: 'CROSS_PROVIDER',
          identifiers: { macAddress: '00:11:22:33:44:55' },
        },
      ],
    )

    expect(result.kind).toBe('AMBIGUOUS')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.candidates.map((candidate) => candidate.canonicalDeviceId)).toEqual([
      'device-a',
      'device-b',
    ])
  })

  it('requires review when retained provider evidence conflicts with a canonical serial match', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'ARUBA',
        sourceAdapterId: 'aruba-api-v1',
        identifiers: { serialNumber: 'AP01-CORRECT' },
        context: { vendor: 'Aruba', model: 'AP-515' },
      },
      [
        {
          canonicalDeviceId: 'ap01',
          matchScope: 'CANONICAL',
          identifiers: { serialNumber: 'AP01-CORRECT' },
          context: { vendor: 'Aruba', model: 'AP-515' },
          hasConflictingDurableEvidence: true,
        },
      ],
    )

    expect(result.kind).toBe('AMBIGUOUS')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.candidates[0]?.evidenceConflict).toBe(true)
  })

  it('normalizes source ID, serial, and common MAC formats deterministically', () => {
    expect(
      normalizeImporterV2Identity({
        sourceId: '  AbC-123  ',
        serialNumber: ' cn 123 ',
        macAddress: 'aa:bb:cc:dd:ee:ff',
      }),
    ).toEqual({
      sourceId: 'AbC-123',
      serialNumber: 'CN 123',
      macAddress: 'AABBCCDDEEFF',
    })
  })

  it('detects differing duplicate source rows without silently merging them', () => {
    const analysis = analyzeImporterV2SourceRowIdentities([
      {
        rowNumber: 2,
        identifiers: { sourceId: 'device-1', serialNumber: 'SER-1' },
        values: { deviceName: 'switch-1', model: '2530' },
      },
      {
        rowNumber: 9,
        identifiers: { sourceId: 'device-1', serialNumber: 'SER-1' },
        values: { deviceName: 'switch-1', model: '2930F' },
      },
    ])

    expect(analysis.duplicateGroups).toHaveLength(1)
    expect(analysis.duplicateGroups[0]).toMatchObject({
      rowNumbers: [2, 9],
      hasConflicts: true,
    })
    expect(analysis.duplicateGroups[0]?.conflictingFields).toContain('model')
  })

  it('reports single-identifier stack/member reuse as a collision rather than a duplicate', () => {
    const analysis = analyzeImporterV2SourceRowIdentities([
      {
        rowNumber: 3,
        identifiers: { serialNumber: 'STACK-1' },
        values: { deviceType: 'Stack', model: 'C9300' },
      },
      {
        rowNumber: 4,
        identifiers: { serialNumber: 'STACK-1' },
        values: { deviceType: 'Switch', model: 'C9300-48P' },
      },
    ])

    expect(analysis.duplicateGroups).toEqual([])
    expect(analysis.identifierCollisions).toEqual([
      expect.objectContaining({
        kind: 'SERIAL_NUMBER',
        normalizedValue: 'STACK-1',
        rowNumbers: [3, 4],
      }),
    ])
  })
})
