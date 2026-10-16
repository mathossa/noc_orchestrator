import { describe, expect, it } from 'vitest'
import { findImporterV2HaSerialReviewCandidates } from '@/lib/importer-v2-ha-identity-review'
import type { ImporterV2IdentityConflictDiagnostic } from '@/lib/importer-v2-publication-identity-diagnostics'

function diagnostics(input: {
  duplicateSourceId?: boolean
  duplicateName?: boolean
  duplicateMac?: boolean
  differentSite?: boolean
  vendor?: string
  canonicalConflict?: boolean
} = {}) {
  const shared = [{ field: 'serialNumber' as const, value: 'SHARED-ALIAS' }]
  const identifiers = (sourceId: string) => ({
    sourceId, serialNumber: 'SHARED-ALIAS', macAddress: null,
  })
  const first: ImporterV2IdentityConflictDiagnostic = {
    rowNumber: 11,
    sourceName: 'fw-member-a',
    hostname: 'fw-member-a',
    selectedCanonicalDeviceId: null,
    sourceIdentifiers: identifiers('source-device-a'),
    conflicts: input.canonicalConflict ? [{
      canonicalDeviceId: 'existing-1', provider: 'monitoring',
      sourceId: 'source-device-3', name: 'old-member', hostname: null,
      serialNumber: 'SHARED-ALIAS', customer: null, site: null, organizationUnit: null,
      vendor: null, model: null, matchingIdentifiers: shared,
    }] : [],
    stagedConflicts: [{
      rowNumber: 12, sourceName: input.duplicateName ? 'fw-member-a' : 'fw-member-b',
      hostname: null, customer: 'customer',
      organizationUnit: null, site: 'site',
      vendor: input.vendor ?? 'Fortinet', model: 'model',
      selectedCanonicalDeviceId: null,
      matchingIdentifiers: input.duplicateMac
        ? [...shared, { field: 'macAddress' as const, value: '001122334455' }]
        : shared,
    }],
  }
  const second: ImporterV2IdentityConflictDiagnostic = {
    ...first, rowNumber: 12,
    sourceName: input.duplicateName ? 'fw-member-a' : 'fw-member-b',
    sourceIdentifiers: identifiers(input.duplicateSourceId ? 'source-device-a' : 'source-device-b'),
    conflicts: [],
    stagedConflicts: [{
      ...first.stagedConflicts[0],
      rowNumber: 11, sourceName: 'fw-member-a',
      site: input.differentSite ? 'different-site' : 'site',
    }],
  }
  return [first, second]
}

describe('manual HA serial-alias review candidate safety', () => {
  it('offers only both separate named members with distinct Source IDs', () => {
    expect(findImporterV2HaSerialReviewCandidates(diagnostics())).toEqual([{
      rowNumbers: [11, 12],
      deviceNames: ['fw-member-a', 'fw-member-b'],
      sourceIds: ['source-device-a', 'source-device-b'],
      reason: expect.stringContaining('Verify'),
    }])
  })
  it.each([
    { duplicateSourceId: true },
    { duplicateName: true },
    { duplicateMac: true },
    { differentSite: true },
    { vendor: 'Aruba' },
    { canonicalConflict: true },
  ])('never suggests unsafe automatic serial repair for %j', (input) => {
    expect(findImporterV2HaSerialReviewCandidates(diagnostics(input))).toEqual([])
  })
  it('does not offer a shortcut for a row already conflicting on canonical name', () => {
    expect(findImporterV2HaSerialReviewCandidates(diagnostics(), [11])).toEqual([])
  })
})
