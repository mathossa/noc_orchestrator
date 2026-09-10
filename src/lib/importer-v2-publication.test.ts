import { describe, expect, it } from 'vitest'
import {
  buildImporterV2PublicationQa,
  importerV2OwnedDeviceScalarPatch,
  importerV2PublicationRowsIncludingStackMembers,
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

  it('publishes a detected stack as one logical device while carrying member source rows with it', () => {
    const parent = row(5, {
      statuses: ['VALID', 'NEW', 'STACK'],
      primaryStatus: 'VALID',
      decisions: [
        ...row(5).decisions,
        {
          field: null,
          action: 'TOPOLOGY_STACK_PARENT',
          value: {
            role: 'STACK',
            groupKey: 'auvik|customer|site|stack-a',
            parentRowNumber: 5,
            memberIndex: null,
            memberRows: [{ rowNumber: 6, memberIndex: 1 }],
            source: 'AUVIK_MEMBER_NAMING',
          },
        },
      ],
    })
    const member = row(6, {
      statuses: ['STACK_MEMBER'],
      primaryStatus: 'STACK_MEMBER',
      repeatClassification: 'NEW',
      decisions: [
        {
          field: null,
          action: 'TOPOLOGY_STACK_MEMBER',
          value: {
            role: 'STACK_MEMBER',
            groupKey: 'auvik|customer|site|stack-a',
            parentRowNumber: 5,
            memberIndex: 1,
            memberRows: [],
            source: 'AUVIK_MEMBER_NAMING',
          },
        },
      ],
    })

    const result = qa([parent, member])
    expect(result.counts.stacks).toBe(1)
    expect(result.counts.stackMembers).toBe(1)
    expect(result.topology.stackGroups).toEqual([
      expect.objectContaining({
        parentRowNumber: 5,
        memberRows: [expect.objectContaining({ rowNumber: 6, memberIndex: 1 })],
      }),
    ])
    expect(selectImporterV2PublicationRows(result, 'ALL_RESOLVED')).toEqual([5])
    expect(
      [...importerV2PublicationRowsIncludingStackMembers(result, [5])].sort(
        (left, right) => left - right,
      ),
    ).toEqual([5, 6])
  })

  it('blocks the logical stack when a physical member still has a field error', () => {
    const parent = row(5, {
      decisions: [
        ...row(5).decisions,
        {
          field: null,
          action: 'TOPOLOGY_STACK_PARENT',
          value: {
            role: 'STACK',
            groupKey: 'stack-a',
            parentRowNumber: 5,
            memberIndex: null,
            memberRows: [{ rowNumber: 6, memberIndex: 1 }],
            source: 'AUVIK_MEMBER_NAMING',
          },
        },
      ],
    })
    const memberSource = row(6)
    const memberEvaluated = structuredClone(memberSource.evaluated) as Record<string, unknown>
    memberEvaluated.issues = [
      {
        field: 'model',
        severity: 'ERROR',
        code: 'REQUIRED_FIELD_UNRESOLVED',
        message: 'Model must be resolved.',
      },
    ]
    const member = row(6, {
      primaryStatus: 'NEEDS_REVIEW',
      statuses: ['NEEDS_REVIEW'],
      evaluated: memberEvaluated,
      decisions: [
        {
          field: null,
          action: 'TOPOLOGY_STACK_MEMBER',
          value: {
            role: 'STACK_MEMBER',
            groupKey: 'stack-a',
            parentRowNumber: 5,
            memberIndex: 1,
            memberRows: [],
            source: 'AUVIK_MEMBER_NAMING',
          },
        },
      ],
    })

    const result = qa([parent, member])
    expect(result.publication.unresolvedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 5 }),
        expect.objectContaining({ rowNumber: 6 }),
      ]),
    )
    expect(result.publication.allResolvedCandidateRows).not.toContain(5)
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
