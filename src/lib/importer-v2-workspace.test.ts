import { describe, expect, it } from 'vitest'
import {
  importerV2WorkspaceActionNeedsReevaluation,
  importerV2WorkspaceCommonValues,
  importerV2WorkspaceScopeToken,
  parseImporterV2WorkspaceQuery,
  type ImporterV2WorkspaceAction,
} from '@/lib/importer-v2-workspace'

describe('Importer v2 reconciliation workspace', () => {
  it('parses hierarchy/repeat filters and caps server page size', () => {
    const query = parseImporterV2WorkspaceQuery(new URLSearchParams({
      page: '3',
      pageSize: '9999',
      groupBy: 'businessUnit',
      businessUnit: 'eCom',
      repeat: 'MOVED',
      issue: 'ERROR',
    }))

    expect(query).toEqual({
      page: 3,
      pageSize: 200,
      groupBy: 'businessUnit',
      filters: expect.objectContaining({
        businessUnit: 'eCom',
        repeatClassification: 'MOVED',
        issue: 'ERROR',
      }),
    })
  })

  it('makes preview tokens deterministic regardless of row-version order', () => {
    const action: ImporterV2WorkspaceAction = {
      type: 'SET_FIELD',
      field: 'model',
      value: { id: 'model-515', label: 'AP-515' },
      explanation: 'Confirmed exact model for this source pattern.',
    }
    const base = {
      batchId: 'batch-1',
      selection: { mode: 'ROWS' as const, rowNumbers: [8, 3] },
      action,
    }
    const first = importerV2WorkspaceScopeToken({
      ...base,
      rowVersions: [
        { rowNumber: 8, reviewRevision: 2 },
        { rowNumber: 3, reviewRevision: 1 },
      ],
    })
    const second = importerV2WorkspaceScopeToken({
      ...base,
      rowVersions: [
        { rowNumber: 3, reviewRevision: 1 },
        { rowNumber: 8, reviewRevision: 2 },
      ],
    })
    expect(first).toBe(second)
  })

  it('invalidates a preview token when any selected row revision changes', () => {
    const action: ImporterV2WorkspaceAction = {
      type: 'IGNORE_FIELD',
      field: 'firmwareVersion',
      explanation: 'The provider field is boot firmware, not running software.',
    }
    const token = (reviewRevision: number) => importerV2WorkspaceScopeToken({
      batchId: 'batch-1',
      selection: { mode: 'QUERY', filters: { vendor: 'Aruba' } },
      action,
      rowVersions: [{ rowNumber: 5, reviewRevision }],
    })
    expect(token(1)).not.toBe(token(2))
  })

  it('invalidates a preview token when the attached rule-book revision changes', () => {
    const action: ImporterV2WorkspaceAction = {
      type: 'CREATE_SCOPED_RULE',
      field: 'model',
      sourceValue: 'AP515',
      value: { id: 'model-515', label: 'AP-515' },
      scope: { vendor: ['Aruba'] },
      explanation: 'Normalize this exact source model inside the Aruba scope.',
    }
    const token = (contextVersion: string) => importerV2WorkspaceScopeToken({
      batchId: 'batch-1',
      selection: { mode: 'ROWS', rowNumbers: [5] },
      action,
      contextVersion,
      rowVersions: [{ rowNumber: 5, reviewRevision: 1 }],
    })

    expect(token('revision-a:3')).not.toBe(token('revision-b:4'))
  })

  it('reports common versus mixed proposed values for multi-row review', () => {
    const rows = [
      { evaluated: { proposedCanonicalValues: { vendor: { id: 'aruba', label: 'Aruba' }, site: { id: 'a', label: 'Alkmaar' } } } },
      { evaluated: { proposedCanonicalValues: { vendor: { id: 'aruba', label: 'Aruba' }, site: { id: 'b', label: 'Amersfoort' } } } },
    ]
    const common = importerV2WorkspaceCommonValues(rows)
    expect(common.vendor).toBe('Aruba')
    expect(common.site).toBe('MIXED')
    expect(common.currentFirmware).toBeNull()
  })

  it('keeps field corrections separate from explicit row exclusion', () => {
    expect(importerV2WorkspaceActionNeedsReevaluation({
      type: 'IGNORE_FIELD',
      field: 'firmwareVersion',
      explanation: 'Ignore only this source field.',
    })).toBe(true)
    expect(importerV2WorkspaceActionNeedsReevaluation({
      type: 'EXCLUDE_ROW',
      explanation: 'This source row is intentionally out of inventory scope.',
    })).toBe(false)
  })
})
