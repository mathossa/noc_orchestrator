import { describe, expect, it } from 'vitest'
import {
  buildImporterV2PublicationQa,
  importerV2OwnedDeviceScalarPatch,
  selectImporterV2PublicationRows,
  type ImporterV2PublicationQaRowInput,
} from '@/lib/importer-v2-publication'

function row(
  rowNumber: number,
  patch: Partial<ImporterV2PublicationQaRowInput> = {},
): ImporterV2PublicationQaRowInput {
  return {
    id: `row-${rowNumber}`,
    rowNumber,
    sourceFingerprint: `fingerprint-${rowNumber}`,
    inclusion: 'INCLUDED',
    statuses: ['VALID', 'NEW'],
    primaryStatus: 'VALID',
    repeatClassification: 'NEW',
    needsReevaluation: false,
    reviewRevision: 1,
    publishedAt: null,
    publicationAttemptId: null,
    firmwareEvidencePattern: 'Cisco IOS-XE · software evidence',
    evaluated: {
      rawValues: {
        customer: 'DHL',
        businessUnit: 'eCom',
        site: 'Alkmaar',
        deviceName: `switch-${rowNumber}`,
        sourceId: `source-${rowNumber}`,
        vendor: 'Cisco',
        deviceType: 'Switch',
        model: 'C9300-24P',
        softwarePlatform: 'IOS-XE',
        firmwareVersion: '17.12.05',
        softwareVersion: '17.12.5',
      },
      proposedCanonicalValues: {
        customer: { id: 'customer-dhl', label: 'DHL' },
        businessUnit: { id: 'unit-ecom', label: 'eCom' },
        site: { id: 'site-alkmaar', label: 'Alkmaar' },
        vendor: { id: 'vendor-cisco', label: 'Cisco' },
        deviceType: { id: 'type-switch', label: 'Switch' },
        model: { id: 'model-c9300', label: 'C9300-24P' },
        softwarePlatform: { id: null, label: 'IOS-XE' },
        currentFirmware: { id: 'release-171205', label: '17.12.05' },
      },
      fields: {
        currentFirmware: { decision: { source: 'DETERMINISTIC_PARSER' } },
        model: { decision: { source: 'EXACT_CATALOG_MATCH' } },
      },
      issues: [],
      firmware: { compatibility: { status: 'COMPATIBLE' }, warnings: [] },
    },
    identityResolution: {
      kind: 'NEW',
      requiresConfirmation: true,
      candidates: [],
      options: ['CREATE_NEW'],
      explanation: 'No durable crosswalk match exists.',
    },
    repeatDiff: null,
    decisions: [
      {
        field: null,
        action: 'IDENTITY_RESOLUTION',
        value: { kind: 'CREATE_NEW', canonicalDeviceId: null },
        explanation: 'Confirmed creation of a new canonical device.',
      },
    ],
    ...patch,
  }
}

function qa(rows: ImporterV2PublicationQaRowInput[]) {
  return buildImporterV2PublicationQa({
    batch: {
      id: 'batch-1',
      name: 'devices.xlsx',
      provider: 'Auvik',
      sourceAdapterId: 'xlsx-v1',
      profileId: 'profile-1',
      profileVersion: '3',
      evaluationFingerprint: 'evaluation-1',
      status: 'RECONCILING',
      rowCount: rows.length,
      publishedRowCount: 0,
    },
    rows,
  })
}

describe('Importer v2 final QA and publication selection', () => {
  it('invalidates the QA fingerprint when a reviewed row revision changes', () => {
    const first = qa([row(1, { reviewRevision: 2 })])
    const changed = qa([row(1, { reviewRevision: 3 })])
    expect(first.qaFingerprint).not.toBe(changed.qaFingerprint)
  })

  it('keeps unresolved rows staged when valid-only publication is selected', () => {
    const result = qa([
      row(1),
      row(2, {
        primaryStatus: 'NEEDS_REVIEW',
        statuses: ['NEEDS_REVIEW'],
        evaluated: {
          ...(row(2).evaluated as Record<string, unknown>),
          issues: [
            {
              rowNumber: 2,
              rowFingerprint: 'fingerprint-2',
              field: 'model',
              severity: 'ERROR',
              code: 'REQUIRED_FIELD_UNRESOLVED',
              message: 'Model must be resolved.',
            },
          ],
        },
      }),
    ])

    expect(selectImporterV2PublicationRows(result, 'VALID_ONLY')).toEqual([1])
    expect(result.publication.unresolvedRows).toEqual([
      expect.objectContaining({ rowNumber: 2 }),
    ])
    expect(() =>
      selectImporterV2PublicationRows(result, 'ALL_RESOLVED'),
    ).toThrow('Resolve every included row')
  })

  it('lists new canonical values as explicit approval proposals', () => {
    const source = row(1)
    const evaluated = structuredClone(source.evaluated) as {
      proposedCanonicalValues: Record<
        string,
        { id: string | null; label: string }
      >
    }
    evaluated.proposedCanonicalValues.model = {
      id: null,
      label: 'C9300-24P',
    }
    const result = qa([row(1, { evaluated })])

    expect(result.catalogProposals).toContainEqual(
      expect.objectContaining({
        field: 'model',
        label: 'C9300-24P',
        rowNumbers: [1],
      }),
    )
  })

  it('keeps intentionally excluded rows separate from unresolved rows', () => {
    const result = qa([
      row(1, {
        inclusion: 'EXCLUDED',
        primaryStatus: 'EXCLUDED',
        statuses: ['EXCLUDED'],
      }),
      row(2),
    ])
    expect(result.counts.excluded).toBe(1)
    expect(result.publication.excludedRows).toEqual([1])
    expect(result.publication.unresolvedRows).toEqual([])
    expect(selectImporterV2PublicationRows(result, 'ALL_RESOLVED')).toEqual([2])
  })

  it('only produces scalar updates for import-owned inventory fields', () => {
    const patch = importerV2OwnedDeviceScalarPatch({
      allowedFields: new Set([
        'deviceName',
        'hostname',
        'serialNumber',
        'managementAddress',
        'notes',
      ]),
      values: {
        deviceName: 'switch-1',
        hostname: 'switch-1.example',
        serialNumber: 'SER-1',
        managementAddress: '10.0.0.1',
        notes: 'Observed from source',
      },
    })

    expect(patch).toEqual({
      name: 'switch-1',
      hostname: 'switch-1.example',
      serialNumber: 'SER-1',
      managementAddress: '10.0.0.1',
      notes: 'Observed from source',
    })
    expect(patch).not.toHaveProperty('desiredFirmware')
    expect(patch).not.toHaveProperty('lifecycle')
    expect(patch).not.toHaveProperty('firmwarePolicies')
    expect(patch).not.toHaveProperty('plannedFor')
  })
})
