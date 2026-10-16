import { describe, expect, it } from 'vitest'
import { importerV2SourceIdentityForCrosswalk, normalizeImporterV2Identity } from '@/lib/importer-v2-identity'
import {
  importerV2WorkspaceEffectiveEvaluated,
  importerV2WorkspaceEffectiveText,
} from '@/lib/importer-v2-workspace-effective-overlay'

describe('importer HA source serial suppression', () => {
  it('retains a unique provider source identity and firmware override without publishing a copied serial', () => {
    const rawValues = {
      sourceId: 'provider-member-b',
      serialNumber: 'CLUSTER-ALIAS',
      currentFirmware: '7.4.0',
    }
    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: {
        rawValues,
        proposedCanonicalValues: {
          sourceId: { id: null, label: 'provider-member-b' },
          currentFirmware: { id: 'release-verified', label: '7.4.12' },
        },
        issues: [],
      },
      inclusion: 'INCLUDED',
      decisions: [{
        field: 'serialNumber', action: 'IGNORE_FIELD',
        explanation: 'Engineer verified the alias is not the device serial.',
      }, {
        field: 'currentFirmware', action: 'SET_FIELD',
        value: { id: 'release-verified', label: '7.4.12' },
        explanation: 'Verified running version for this physical member.',
      }],
    }).evaluated
    expect(importerV2WorkspaceEffectiveText(snapshot, 'serialNumber')).toBeNull()
    expect(importerV2WorkspaceEffectiveText(snapshot, 'currentFirmware')).toBe('7.4.12')
    const ids = importerV2SourceIdentityForCrosswalk({
      rawIdentifiers: rawValues,
      effectiveIdentifiers: {
        sourceId: importerV2WorkspaceEffectiveText(snapshot, 'sourceId'),
        serialNumber: importerV2WorkspaceEffectiveText(snapshot, 'serialNumber'),
        macAddress: null,
      },
      suppressedSourceFields: snapshot.suppressedSourceFields,
    })
    expect(ids).toEqual({ sourceId: 'provider-member-b', serialNumber: null, macAddress: null })
    expect(normalizeImporterV2Identity(ids)).toEqual({
      sourceId: 'provider-member-b', serialNumber: null, macAddress: null,
    })
    expect(snapshot.rawValues?.serialNumber).toBe('CLUSTER-ALIAS')
  })
})
