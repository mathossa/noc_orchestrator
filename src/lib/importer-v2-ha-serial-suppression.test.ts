import { describe, expect, it } from 'vitest'
import {
  importerV2ConfirmedIdentityCorrections,
  importerV2SourceIdentityForCrosswalk,
  normalizeImporterV2Identity,
} from '@/lib/importer-v2-identity'

describe('importer HA source serial suppression', () => {
  it('uses a confirmed real member serial instead of a copied cluster alias', () => {
    const correctedSourceFields = importerV2ConfirmedIdentityCorrections([
      { field: 'serialNumber', action: 'SET_FIELD' },
      { field: 'currentFirmware', action: 'SET_FIELD' },
    ])

    expect(correctedSourceFields).toEqual(['serialNumber'])

    const identity = importerV2SourceIdentityForCrosswalk({
      rawIdentifiers: {
        sourceId: 'source-peer-b',
        serialNumber: 'CLUSTER-ALIAS',
        macAddress: null,
      },
      effectiveIdentifiers: {
        sourceId: 'source-peer-b',
        serialNumber: 'VERIFIED-SECONDARY-SERIAL',
        macAddress: null,
      },
      correctedSourceFields,
    })

    expect(identity).toEqual({
      sourceId: 'source-peer-b',
      serialNumber: 'VERIFIED-SECONDARY-SERIAL',
      macAddress: null,
    })
    expect(normalizeImporterV2Identity(identity)).toEqual({
      sourceId: 'source-peer-b',
      serialNumber: 'VERIFIED-SECONDARY-SERIAL',
      macAddress: null,
    })
  })

  it('does not resurrect a corrected source alias after the field is ignored', () => {
    const correctedSourceFields = importerV2ConfirmedIdentityCorrections([
      { field: 'serialNumber', action: 'SET_FIELD' },
      { field: 'serialNumber', action: 'IGNORE_FIELD' },
    ])

    expect(correctedSourceFields).toEqual([])

    const identity = importerV2SourceIdentityForCrosswalk({
      rawIdentifiers: {
        sourceId: 'source-peer-b',
        serialNumber: 'CLUSTER-ALIAS',
        macAddress: null,
      },
      effectiveIdentifiers: {
        sourceId: 'source-peer-b',
        serialNumber: null,
        macAddress: null,
      },
      suppressedSourceFields: ['serialNumber'],
      correctedSourceFields,
    })

    expect(identity).toEqual({
      sourceId: 'source-peer-b',
      serialNumber: null,
      macAddress: null,
    })
  })

  it('keeps ordinary raw aliases unless an operator explicitly corrected them', () => {
    const identity = importerV2SourceIdentityForCrosswalk({
      rawIdentifiers: {
        sourceId: 'source-peer-b',
        serialNumber: 'SOURCE-SERIAL',
        macAddress: null,
      },
      effectiveIdentifiers: {
        sourceId: 'source-peer-b',
        serialNumber: 'NORMALIZED-OR-CANONICAL-SERIAL',
        macAddress: null,
      },
    })

    expect(identity.serialNumber).toBe('SOURCE-SERIAL')
  })
})
