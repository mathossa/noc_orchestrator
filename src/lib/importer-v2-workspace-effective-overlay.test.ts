import { describe, expect, it } from 'vitest'
import {
  importerV2WorkspaceEffectiveEvaluated,
  importerV2WorkspaceIssueState,
  importerV2WorkspacePreviewChangeReason,
} from '@/lib/importer-v2-workspace-effective-overlay'
import type { ImporterV2WorkspaceActionPreview } from '@/lib/importer-v2-workspace'

const modelError = {
  rowNumber: 7,
  rowFingerprint: 'row-7',
  field: 'model' as const,
  severity: 'ERROR' as const,
  code: 'REQUIRED_FIELD_UNRESOLVED' as const,
  message: 'Canonical model must be confirmed.',
}

const firmwareWarning = {
  rowNumber: 7,
  rowFingerprint: 'row-7',
  field: 'currentFirmware' as const,
  severity: 'WARNING' as const,
  code: 'OPTIONAL_FIELD_UNRESOLVED' as const,
  message: 'Running firmware needs review.',
}

const evaluated = {
  issues: [modelError, firmwareWarning],
  proposedCanonicalValues: {
    model: { id: 'ap-515', label: 'AP-515' },
  },
  fields: {
    model: {
      proposedValue: { id: 'ap-515', label: 'AP-515' },
      issues: [modelError],
    },
  },
}

describe('Importer v2 effective reconciliation overlay', () => {
  it('removes a confirmed field repair from active errors without deleting history', () => {
    const state = importerV2WorkspaceIssueState({
      evaluated,
      inclusion: 'INCLUDED',
      decisions: [
        {
          field: 'model',
          action: 'SET_FIELD',
          value: { id: 'ap-515-test', label: 'AP-515-TEST' },
          explanation: 'Confirmed corrected canonical model.',
        },
      ],
    })

    expect(state.activeIssues).toEqual([firmwareWarning])
    expect(state.resolvedIssues).toEqual([modelError])
    expect(state.activeErrorCount).toBe(0)
    expect(state.activeWarningCount).toBe(1)
  })

  it('keeps required-field errors active when a source field is merely ignored', () => {
    const state = importerV2WorkspaceIssueState({
      evaluated: { issues: [modelError] },
      inclusion: 'INCLUDED',
      decisions: [
        {
          field: 'model',
          action: 'IGNORE_FIELD',
          explanation: 'Ignore this source value.',
        },
      ],
    })

    expect(state.activeIssues).toEqual([modelError])
    expect(state.activeErrorCount).toBe(1)
  })

  it('overlays the confirmed value in row detail while leaving the stored snapshot concept intact', () => {
    const result = importerV2WorkspaceEffectiveEvaluated({
      evaluated,
      inclusion: 'INCLUDED',
      decisions: [
        {
          field: 'model',
          action: 'SET_FIELD',
          value: { id: 'ap-515-test', label: 'AP-515-TEST' },
          explanation: 'Confirmed corrected canonical model.',
        },
      ],
    })

    expect(result.evaluated.proposedCanonicalValues?.model).toEqual({
      id: 'ap-515-test',
      label: 'AP-515-TEST',
    })
    expect(result.evaluated.issues).toEqual([firmwareWarning])
    expect(result.resolvedIssues).toEqual([modelError])
  })

  it('puts the exact before-to-after change in the preview confirmation reasons', () => {
    const preview: ImporterV2WorkspaceActionPreview = {
      scopeToken: 'scope',
      affectedRowCount: 1,
      sample: [],
      action: {
        type: 'SET_FIELD',
        field: 'model',
        value: { id: 'ap-515-test', label: 'AP-515-TEST' },
        explanation: 'Confirmed corrected canonical model.',
      },
      requiresConfirmation: true,
      commonValues: { model: 'AP-515' },
      confirmationReasons: [],
      contextVersion: null,
    }

    expect(
      importerV2WorkspacePreviewChangeReason(preview, preview.action),
    ).toBe('Change: Model · AP-515 → AP-515-TEST.')
  })
})
