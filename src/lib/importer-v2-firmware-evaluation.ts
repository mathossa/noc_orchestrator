import { createHash } from 'node:crypto'
import {
  evaluateImporterV2,
  type ImporterV2EvaluatedRow,
  type ImporterV2EvaluationInput,
  type ImporterV2EvaluationResult,
  type ImporterV2FieldDecision,
  type ImporterV2FieldIssue,
  type ImporterV2ProposedValue,
  type ImporterV2RowStatus,
} from '@/lib/importer-v2-evaluator'
import {
  IMPORTER_V2_FIRMWARE_INTERPRETER_VERSION,
  groupImporterV2FirmwareProofs,
  interpretImporterV2Firmware,
  type ImporterV2FirmwareInterpretation,
  type ImporterV2FirmwareInterpretationContext,
  type ImporterV2FirmwareProofGroup,
  type ImporterV2FirmwareProofRow,
} from '@/lib/importer-v2-firmware'

export type ImporterV2FirmwareEvaluationInput = ImporterV2EvaluationInput & {
  firmwareContext: ImporterV2FirmwareInterpretationContext
  providerMetadataByRow?: Readonly<
    Record<number, Readonly<Record<string, unknown>> | null>
  >
}

export type ImporterV2FirmwareEvaluatedRow = ImporterV2EvaluatedRow & {
  firmware: ImporterV2FirmwareInterpretation
}

export type ImporterV2FirmwareEvaluationResult = Omit<
  ImporterV2EvaluationResult,
  'evaluationFingerprint' | 'rows'
> & {
  evaluationFingerprint: string
  firmwareInterpreterVersion: string
  firmwareCompatibilityVersion: string
  rows: readonly ImporterV2FirmwareEvaluatedRow[]
  firmwareProofGroups: readonly ImporterV2FirmwareProofGroup[]
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

function fingerprint(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function parserDecision(
  firmware: ImporterV2FirmwareInterpretation,
  value: string | null,
  explanation: string,
): ImporterV2FieldDecision {
  return {
    source: value ? 'DETERMINISTIC_PARSER' : 'UNRESOLVED',
    confidence: firmware.confidence,
    explanation,
    requiresConfirmation: Boolean(value),
    matchedRuleId: null,
    matchedRuleVersion: null,
    matchedParserId: value ? firmware.interpreterId : null,
    matchedParserVersion: value ? firmware.interpreterVersion : null,
    matchedCatalogValueId: null,
    matchedCatalogVersion: null,
    matchedSuggestionId: null,
    matchedSuggestionVersion: null,
  }
}

function proposedValue(value: string | null): ImporterV2ProposedValue | null {
  return value ? { id: null, label: value } : null
}

function firmwareIssues(
  row: ImporterV2EvaluatedRow,
  firmware: ImporterV2FirmwareInterpretation,
  input: ImporterV2FirmwareEvaluationInput,
): ImporterV2FieldIssue[] {
  const issues: ImporterV2FieldIssue[] = []

  if (!firmware.runningVersion) {
    issues.push({
      rowNumber: row.rowNumber,
      rowFingerprint: row.sourceFingerprint,
      field: 'currentFirmware',
      severity: 'WARNING',
      code: 'OPTIONAL_FIELD_UNRESOLVED',
      message:
        'Observed running firmware is unknown. The device remains importable and the evidence must be reviewed.',
    })
  }

  if (
    input.profile.requiredFields.includes('softwarePlatform') &&
    !firmware.proposedSoftwarePlatform
  ) {
    issues.push({
      rowNumber: row.rowNumber,
      rowFingerprint: row.sourceFingerprint,
      field: 'softwarePlatform',
      severity: 'ERROR',
      code: 'REQUIRED_FIELD_UNRESOLVED',
      message:
        'softwarePlatform must be resolved before this row can be published.',
    })
  } else if (
    input.profile.warnWhenUnresolvedFields.includes('softwarePlatform') &&
    !firmware.proposedSoftwarePlatform
  ) {
    issues.push({
      rowNumber: row.rowNumber,
      rowFingerprint: row.sourceFingerprint,
      field: 'softwarePlatform',
      severity: 'WARNING',
      code: 'OPTIONAL_FIELD_UNRESOLVED',
      message: 'softwarePlatform is unknown and remains available for review.',
    })
  }

  return issues
}

function firmwareStatuses(
  row: ImporterV2EvaluatedRow,
  firmware: ImporterV2FirmwareInterpretation,
  issues: readonly ImporterV2FieldIssue[],
): readonly ImporterV2RowStatus[] {
  if (row.inclusion === 'EXCLUDED') return ['EXCLUDED']

  const statuses = new Set(row.statuses)
  statuses.delete('VALID')
  statuses.add('NEEDS_REVIEW')
  if (
    firmware.warnings.length > 0 ||
    issues.some((issue) => issue.severity === 'WARNING')
  ) {
    statuses.add('WARNING')
  }
  return [...statuses]
}

function proofRow(
  row: ImporterV2FirmwareEvaluatedRow,
): ImporterV2FirmwareProofRow {
  return {
    rowNumber: row.rowNumber,
    rowFingerprint: row.sourceFingerprint,
    customer: row.normalizedValues.customer,
    model: row.normalizedValues.model,
    deviceName:
      row.normalizedValues.deviceName ?? row.normalizedValues.hostname,
    interpretation: row.firmware,
  }
}

/**
 * Canonical Importer v2 evaluation boundary for any stage that consumes firmware.
 *
 * The lower-level evaluateImporterV2 function remains responsible for generic
 * field resolution. Running firmware and software-platform interpretation must
 * come through this facade so staging, validation, preview and publication use
 * the same proof-producing interpreter.
 */
export function evaluateImporterV2WithFirmware(
  input: ImporterV2FirmwareEvaluationInput,
): ImporterV2FirmwareEvaluationResult {
  const profileWithoutCompetingFirmwareResolution = {
    ...input.profile,
    requiredFields: input.profile.requiredFields.filter(
      (field) => field !== 'currentFirmware' && field !== 'softwarePlatform',
    ),
    warnWhenUnresolvedFields: input.profile.warnWhenUnresolvedFields.filter(
      (field) => field !== 'currentFirmware' && field !== 'softwarePlatform',
    ),
  }

  const {
    firmwareContext: _firmwareContext,
    providerMetadataByRow: _providerMetadataByRow,
    ...genericInput
  } = input
  const base = evaluateImporterV2({
    ...genericInput,
    profile: profileWithoutCompetingFirmwareResolution,
  })

  const rows = base.rows.map((row, index) => {
    const stagedRow = input.rows[index]
    const firmware = interpretImporterV2Firmware(
      {
        provider: input.profile.provider,
        vendor: stagedRow.rawValues.vendor,
        model: stagedRow.rawValues.model,
        productFamily: stagedRow.rawValues.productFamily,
        softwarePlatform: stagedRow.rawValues.softwarePlatform,
        sourceDeviceType: stagedRow.rawValues.deviceType,
        firmwareVersion: stagedRow.rawValues.firmwareVersion,
        softwareVersion: stagedRow.rawValues.softwareVersion,
        providerMetadata:
          input.providerMetadataByRow?.[stagedRow.rowNumber] ?? null,
      },
      input.firmwareContext,
    )

    const currentFirmwareIssues: ImporterV2FieldIssue[] = []
    const softwarePlatformIssues: ImporterV2FieldIssue[] = []
    const fields = {
      ...row.fields,
      currentFirmware: {
        ...row.fields.currentFirmware,
        proposedValue: proposedValue(firmware.runningVersion),
        decision: parserDecision(
          firmware,
          firmware.runningVersion,
          firmware.explanation,
        ),
        issues: currentFirmwareIssues,
      },
      softwarePlatform: {
        ...row.fields.softwarePlatform,
        proposedValue: proposedValue(firmware.proposedSoftwarePlatform),
        decision: parserDecision(
          firmware,
          firmware.proposedSoftwarePlatform,
          firmware.proposedSoftwarePlatform
            ? `${firmware.explanation} Platform evidence: ${firmware.platformEvidence}.`
            : 'No deterministic software platform could be proposed from source, deployment or version evidence.',
        ),
        issues: softwarePlatformIssues,
      },
    }

    const inheritedIssues = row.issues.filter(
      (issue) =>
        issue.field !== 'currentFirmware' && issue.field !== 'softwarePlatform',
    )
    const interpretedIssues = firmwareIssues(row, firmware, input)
    for (const issue of interpretedIssues) {
      if (issue.field === 'currentFirmware') currentFirmwareIssues.push(issue)
      if (issue.field === 'softwarePlatform') softwarePlatformIssues.push(issue)
    }
    const issues = [...inheritedIssues, ...interpretedIssues]

    const proposedCanonicalValues = {
      ...row.proposedCanonicalValues,
      currentFirmware: proposedValue(firmware.runningVersion),
      softwarePlatform: proposedValue(firmware.proposedSoftwarePlatform),
    }

    const evaluated = {
      ...row,
      fields,
      issues,
      statuses: firmwareStatuses(row, firmware, issues),
      proposedCanonicalValues,
      firmware,
    } satisfies ImporterV2FirmwareEvaluatedRow

    return evaluated
  })

  const includedProofRows = rows
    .filter((row) => row.inclusion === 'INCLUDED')
    .map(proofRow)
  const firmwareProofGroups = groupImporterV2FirmwareProofs(includedProofRows)

  return {
    ...base,
    evaluationFingerprint: fingerprint({
      baseEvaluationFingerprint: base.evaluationFingerprint,
      firmwareContext: input.firmwareContext,
      interpretations: rows.map((row) => ({
        rowNumber: row.rowNumber,
        sourceFingerprint: row.sourceFingerprint,
        firmware: row.firmware,
      })),
    }),
    firmwareInterpreterVersion:
      rows[0]?.firmware.interpreterVersion ??
      IMPORTER_V2_FIRMWARE_INTERPRETER_VERSION,
    firmwareCompatibilityVersion: input.firmwareContext.compatibilityVersion,
    rows,
    firmwareProofGroups,
  }
}
