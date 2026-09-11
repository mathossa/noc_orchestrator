import { describe, expect, it } from 'vitest'
import { resolveImporterV2Identity } from '@/lib/importer-v2-identity'

describe('Importer v2 confirmed crosswalk reuse', () => {
  it('automatically reuses a unique confirmed serial alias on repeat import', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Auvik',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: { serialNumber: 'FOC2231V3CX' },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          crosswalkId: 'crosswalk-1',
          identifiers: { serialNumber: 'FOC2231V3CX' },
        },
      ],
    )

    expect(result).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: false,
    })
    expect(result.candidates[0]?.confidence).toBe('HIGH')
  })

  it('keeps a fresh serial-only guess reviewable when no confirmed crosswalk exists', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Inventory',
        sourceAdapterId: 'api-v1',
        identifiers: { serialNumber: 'FOC2231V3CX' },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          identifiers: { serialNumber: 'FOC2231V3CX' },
        },
      ],
    )

    expect(result).toMatchObject({
      kind: 'MATCH_SUGGESTED',
      requiresConfirmation: true,
    })
    expect(result.candidates[0]?.confidence).toBe('MEDIUM')
  })

  it('does not auto-reuse a confirmed alias when another durable identifier conflicts', () => {
    const result = resolveImporterV2Identity(
      {
        provider: 'Auvik',
        sourceAdapterId: 'xlsx-tabular-v1',
        identifiers: {
          serialNumber: 'FOC2231V3CX',
          macAddress: '00:11:22:33:44:55',
        },
      },
      [
        {
          canonicalDeviceId: 'device-1',
          crosswalkId: 'crosswalk-1',
          identifiers: {
            serialNumber: 'FOC2231V3CX',
            macAddress: '00:11:22:33:44:66',
          },
        },
      ],
    )

    expect(result.kind).toBe('AMBIGUOUS')
    expect(result.requiresConfirmation).toBe(true)
  })
})
