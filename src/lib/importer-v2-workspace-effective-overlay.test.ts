import { describe, expect, it } from 'vitest'
import {
  importerV2WorkspaceDirectOverlay,
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

  it('turns explicit observed firmware verification into a row-scoped publication compatibility override', () => {
    const result = importerV2WorkspaceEffectiveEvaluated({
      evaluated: {
        issues: [firmwareWarning],
        proposedCanonicalValues: {
          currentFirmware: { id: null, label: '15.2(7)E2' },
          softwarePlatform: { id: null, label: 'IOS' },
        },
        firmware: {
          runningVersion: '15.2(7)E2',
          proposedSoftwarePlatform: 'IOS',
          compatibility: {
            status: 'UNKNOWN',
            ruleId: null,
            allowedPlatforms: [],
            explanation: 'No model-platform rule exists.',
          },
          warnings: [],
        },
      },
      inclusion: 'INCLUDED',
      decisions: [
        {
          field: 'currentFirmware',
          action: 'VERIFY_OBSERVED_FIRMWARE',
          value: {
            runningVersion: '15.2(7)E2',
            softwarePlatform: 'IOS',
            originalCompatibilityStatus: 'UNKNOWN',
            verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
          },
          explanation: 'Engineer verified observed current firmware.',
        },
      ],
    })

    expect(result.activeWarningCount).toBe(0)
    expect(result.resolvedIssues).toEqual([firmwareWarning])
    expect(result.evaluated.firmware).toMatchObject({
      runningVersion: '15.2(7)E2',
      proposedSoftwarePlatform: 'IOS',
      observedVerification: {
        status: 'VERIFIED',
        scope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
        originalCompatibilityStatus: 'UNKNOWN',
      },
      compatibility: {
        status: 'COMPATIBLE',
        ruleId: 'engineer-observed-current-firmware-verification',
      },
    })
  })

  it('does not let a verification decision overwrite an incompatible firmware interpretation', () => {
    const result = importerV2WorkspaceEffectiveEvaluated({
      evaluated: {
        proposedCanonicalValues: {
          currentFirmware: { id: null, label: '17.12.5' },
          softwarePlatform: { id: null, label: 'IOS-XE' },
        },
        firmware: {
          runningVersion: '17.12.5',
          proposedSoftwarePlatform: 'IOS-XE',
          compatibility: {
            status: 'INCOMPATIBLE',
            explanation: 'Explicit incompatible model/platform rule.',
          },
          warnings: [],
        },
      },
      inclusion: 'INCLUDED',
      decisions: [
        {
          field: 'currentFirmware',
          action: 'VERIFY_OBSERVED_FIRMWARE',
          value: {
            runningVersion: '17.12.5',
            softwarePlatform: 'IOS-XE',
            originalCompatibilityStatus: 'INCOMPATIBLE',
            verificationScope: 'OBSERVED_CURRENT_FIRMWARE_ONLY',
          },
        },
      ],
    })

    expect(result.evaluated.firmware).toMatchObject({
      compatibility: { status: 'INCOMPATIBLE' },
    })
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

  it('shows and overlays several queued field changes together', () => {
    const action = {
      type: 'CHANGE_SET' as const,
      explanation: 'Correct model and hierarchy together.',
      changes: [
        {
          type: 'SET_FIELD' as const,
          field: 'model' as const,
          value: { id: 'ap-515-test', label: 'AP-515-TEST' },
          explanation: 'Correct model.',
        },
        {
          type: 'SET_FIELD' as const,
          field: 'site' as const,
          value: { id: 'site-zwolle', label: 'Zwolle' },
          explanation: 'Correct site.',
        },
      ],
    }
    const preview: ImporterV2WorkspaceActionPreview = {
      scopeToken: 'scope',
      affectedRowCount: 4,
      sample: [],
      action,
      requiresConfirmation: true,
      commonValues: { model: 'AP-515', site: 'Amersfoort' },
      confirmationReasons: [],
      contextVersion: null,
    }

    expect(importerV2WorkspacePreviewChangeReason(preview, action)).toBe(
      'Changes: Model · AP-515 → AP-515-TEST; Site · Amersfoort → Zwolle.',
    )
    expect(importerV2WorkspaceDirectOverlay(action)).toEqual({
      canonicalModel: 'AP-515-TEST',
      site: 'Zwolle',
    })
  })
})
