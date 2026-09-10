import type { Prisma } from '../generated/prisma/client'
import type { ImporterV2FieldIssue } from '@/lib/importer-v2-evaluator'
import { importerV2ObservedFirmwareVerificationValue } from '@/lib/importer-v2-firmware-verification-policy'
import { importerV2WorkspaceIdentityNeedsReview } from '@/lib/importer-v2-workspace-identity-state'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceActionPreview,
  ImporterV2WorkspaceFieldChange,
} from '@/lib/importer-v2-workspace'

type WorkspaceDecision = {
  field: string | null
  action: string
  value?: unknown
  explanation?: string
}

type EvaluatedSnapshot = {
  rawValues?: Record<string, string | null>
  proposedCanonicalValues?: Record<
    string,
    { id?: string | null; label?: string } | null
  >
  fields?: Record<string, Record<string, unknown>>
  issues?: ImporterV2FieldIssue[]
  firmware?: {
    runningVersion?: string | null
    proposedSoftwarePlatform?: string | null
    compatibility?: {
      status?: string
      ruleId?: string | null
      allowedPlatforms?: string[]
      explanation?: string
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

function targetFromAction(action: ImporterV2WorkspaceAction) {
  switch (action.type) {
    case 'SET_FIELD':
    case 'LINK_FIELD':
    case 'REMEMBER_EXACT':
      return action.value
    case 'CREATE_SCOPED_RULE':
      return action.value
    case 'CLEAR_FIELD':
    case 'IGNORE_FIELD':
      return null
    case 'CHANGE_SET':
    case 'EXCLUDE_ROW':
      return undefined
  }
}

function targetFromDecision(decision: WorkspaceDecision) {
  if (
    decision.action === 'CLEAR_FIELD' ||
    decision.action === 'IGNORE_FIELD'
  ) {
    return null
  }
  if (
    decision.action === 'SET_FIELD' ||
    decision.action === 'LINK_FIELD' ||
    decision.action === 'REMEMBER_EXACT' ||
    decision.action === 'CREATE_SCOPED_RULE'
  ) {
    const value = decision.value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as { id?: unknown; label?: unknown }
      if (typeof candidate.label === 'string') {
        return {
          id: typeof candidate.id === 'string' ? candidate.id : null,
          label: candidate.label,
        }
      }
    }
  }
  return undefined
}

function decisionResolvesIssue(
  issue: ImporterV2FieldIssue,
  decision: WorkspaceDecision,
) {
  if (decision.action === 'EXCLUDE_ROW') return true
  if (!decision.field || issue.field !== decision.field) return false

  switch (decision.action) {
    case 'SET_FIELD':
    case 'LINK_FIELD':
    case 'REMEMBER_EXACT':
      return targetFromDecision(decision) !== undefined
    case 'CREATE_SCOPED_RULE':
      return targetFromDecision(decision) !== undefined
        ? true
        : issue.code === 'AMBIGUOUS_DECISION'
    case 'VERIFY_OBSERVED_FIRMWARE':
      return issue.field === 'currentFirmware'
    case 'IGNORE_FIELD':
      return (
        issue.code === 'OPTIONAL_FIELD_UNRESOLVED' ||
        issue.code === 'AMBIGUOUS_DECISION'
      )
    case 'CLEAR_FIELD':
      return issue.code === 'AMBIGUOUS_DECISION'
    default:
      return false
  }
}

export function importerV2WorkspaceIssueState(input: {
  evaluated: unknown
  inclusion: string
  decisions: readonly WorkspaceDecision[]
}) {
  const evaluated = input.evaluated as EvaluatedSnapshot
  const issues = Array.isArray(evaluated.issues) ? evaluated.issues : []
  const excluded =
    input.inclusion === 'EXCLUDED' ||
    input.decisions.some((decision) => decision.action === 'EXCLUDE_ROW')

  const activeIssues: ImporterV2FieldIssue[] = []
  const resolvedIssues: ImporterV2FieldIssue[] = []
  for (const issue of issues) {
    const resolved =
      excluded ||
      input.decisions.some((decision) =>
        decisionResolvesIssue(issue, decision),
      )
    if (resolved) resolvedIssues.push(issue)
    else activeIssues.push(issue)
  }

  return {
    activeIssues,
    resolvedIssues,
    activeErrorCount: activeIssues.filter((issue) => issue.severity === 'ERROR')
      .length,
    activeWarningCount: activeIssues.filter(
      (issue) => issue.severity === 'WARNING',
    ).length,
  }
}

function verifiedObservedFirmwareOverlay(
  evaluated: EvaluatedSnapshot,
  decisions: readonly WorkspaceDecision[],
) {
  const verification = importerV2ObservedFirmwareVerificationValue(decisions)
  if (!verification) return evaluated.firmware

  const current = evaluated.firmware ?? {}
  const compatibility = current.compatibility ?? {}
  // A bulk verification is never allowed to override an explicit incompatible
  // interpretation. Keep that state defensive even if malformed decision data
  // somehow reaches this overlay.
  if (compatibility.status === 'INCOMPATIBLE') return current

  return {
    ...current,
    runningVersion: verification.runningVersion,
    proposedSoftwarePlatform: verification.softwarePlatform,
    observedVerification: {
      status: 'VERIFIED',
      scope: verification.verificationScope,
      runningVersion: verification.runningVersion,
      softwarePlatform: verification.softwarePlatform,
      originalCompatibilityStatus: verification.originalCompatibilityStatus,
    },
    compatibility: {
      ...compatibility,
      status: 'COMPATIBLE',
      ruleId: 'engineer-observed-current-firmware-verification',
      allowedPlatforms:
        compatibility.allowedPlatforms?.length
          ? compatibility.allowedPlatforms
          : [verification.softwarePlatform],
      explanation:
        `Engineer verified “${verification.runningVersion}” on “${verification.softwarePlatform}” as the observed current firmware for this device. ` +
        'This row-scoped verification permits canonical current-firmware publication only; it does not make the release globally model-compatible, preferred, recommended, desired, or policy-eligible.',
    },
  }
}

export function importerV2WorkspaceEffectiveEvaluated(input: {
  evaluated: unknown
  inclusion: string
  decisions: readonly WorkspaceDecision[]
}) {
  const evaluated = input.evaluated as EvaluatedSnapshot
  const issueState = importerV2WorkspaceIssueState(input)
  const proposedCanonicalValues = {
    ...(evaluated.proposedCanonicalValues ?? {}),
  }
  const fields = { ...(evaluated.fields ?? {}) }

  for (const decision of input.decisions) {
    if (!decision.field || decision.action === 'EXCLUDE_ROW') continue
    const target = targetFromDecision(decision)
    if (target === undefined) continue

    proposedCanonicalValues[decision.field] = target
    const existingField = fields[decision.field]
    if (existingField) {
      fields[decision.field] = {
        ...existingField,
        proposedValue: target,
        decision: {
          source: 'MANUAL_OVERRIDE',
          confidence: 'HIGH',
          explanation:
            decision.explanation ?? 'Confirmed engineer reconciliation decision.',
          requiresConfirmation: false,
          matchedRuleId: null,
          matchedRuleVersion: null,
          matchedParserId: null,
          matchedParserVersion: null,
          matchedCatalogValueId: null,
          matchedCatalogVersion: null,
          matchedSuggestionId: null,
          matchedSuggestionVersion: null,
        },
        issues: issueState.activeIssues.filter(
          (issue) => issue.field === decision.field,
        ),
      }
    }
  }

  const firmwareVerification = importerV2ObservedFirmwareVerificationValue(
    input.decisions,
  )
  if (firmwareVerification) {
    const currentTarget = proposedCanonicalValues.currentFirmware
    if (!currentTarget?.label) {
      proposedCanonicalValues.currentFirmware = {
        id: null,
        label: firmwareVerification.runningVersion,
      }
    }
    const platformTarget = proposedCanonicalValues.softwarePlatform
    if (!platformTarget?.label) {
      proposedCanonicalValues.softwarePlatform = {
        id: null,
        label: firmwareVerification.softwarePlatform,
      }
    }
  }

  return {
    evaluated: {
      ...evaluated,
      proposedCanonicalValues,
      fields,
      issues: issueState.activeIssues,
      firmware: verifiedObservedFirmwareOverlay(evaluated, input.decisions),
    },
    resolvedIssues: issueState.resolvedIssues,
    activeErrorCount: issueState.activeErrorCount,
    activeWarningCount: issueState.activeWarningCount,
  }
}

export function importerV2WorkspaceDirectOverlay(
  action: ImporterV2WorkspaceAction,
): Prisma.ImporterV2WorkspaceRowUpdateManyMutationInput | null {
  if (action.type === 'CHANGE_SET') {
    const combined: Prisma.ImporterV2WorkspaceRowUpdateManyMutationInput = {}
    for (const change of action.changes) {
      const overlay = importerV2WorkspaceDirectOverlay(change)
      if (overlay) Object.assign(combined, overlay)
    }
    return Object.keys(combined).length > 0 ? combined : null
  }

  if (action.type === 'EXCLUDE_ROW' || action.type === 'IGNORE_FIELD') {
    return null
  }

  const target = targetFromAction(action)
  if (target === undefined) return null
  const value = target?.label ?? null

  switch (action.field) {
    case 'customer':
      return { customer: value }
    case 'businessUnit':
      return { businessUnit: value }
    case 'site':
      return { site: value }
    case 'deviceName':
      return { sourceName: value }
    case 'hostname':
      return { hostname: value }
    case 'vendor':
      return { vendor: value }
    case 'productFamily':
      return { productFamily: value }
    case 'softwarePlatform':
      return { softwarePlatform: value }
    case 'model':
      return { canonicalModel: value }
    case 'deviceType':
      return { deviceType: value }
    case 'currentFirmware':
      return { interpretedFirmware: value }
    default:
      // Raw source evidence, durable identifiers and notes stay immutable in
      // the denormalized grid. Their confirmed decision is layered over the
      // immutable evaluation instead of rewriting source evidence.
      return null
  }
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    businessUnit: 'Subdomain',
    deviceName: 'Device name',
    sourceId: 'Source ID',
    serialNumber: 'Serial number',
    macAddress: 'MAC address',
    productFamily: 'Product family',
    softwarePlatform: 'Software platform',
    deviceType: 'Device type',
    managementAddress: 'Management address',
    currentFirmware: 'Running firmware',
    firmwareVersion: 'Raw Firmware Version',
    softwareVersion: 'Raw Software Version',
  }
  return (
    labels[field] ??
    field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase())
  )
}

function previewAfterValue(action: ImporterV2WorkspaceFieldChange) {
  switch (action.type) {
    case 'IGNORE_FIELD':
      return 'Ignored'
    case 'CLEAR_FIELD':
      return 'Cleared'
    case 'SET_FIELD':
    case 'LINK_FIELD':
      return action.value.label
  }
}

function singleFieldChangeReason(
  preview: ImporterV2WorkspaceActionPreview,
  action: ImporterV2WorkspaceFieldChange,
) {
  const current = preview.commonValues[action.field]
  const before =
    current === 'MIXED'
      ? 'Different values'
      : current == null || current === ''
        ? '—'
        : current
  return `${fieldLabel(action.field)} · ${before} → ${previewAfterValue(action)}`
}

export function importerV2WorkspacePreviewChangeReason(
  preview: ImporterV2WorkspaceActionPreview,
  action: ImporterV2WorkspaceAction,
) {
  if (action.type === 'EXCLUDE_ROW') {
    return 'Change: Row inclusion · Included → Excluded.'
  }
  if (action.type === 'CHANGE_SET') {
    return `Changes: ${action.changes
      .map((change) => singleFieldChangeReason(preview, change))
      .join('; ')}.`
  }
  if (
    action.type === 'REMEMBER_EXACT' ||
    action.type === 'CREATE_SCOPED_RULE'
  ) {
    const current = preview.commonValues[action.field]
    const before =
      current === 'MIXED'
        ? 'Different values'
        : current == null || current === ''
          ? '—'
          : current
    const after = action.value?.label ?? 'Cleared'
    return `Change: ${fieldLabel(action.field)} · ${before} → ${after}.`
  }
  return `Change: ${singleFieldChangeReason(preview, action)}.`
}

export async function applyImporterV2WorkspaceEffectiveOverlay(input: {
  batchId: string
  scopeToken: string
  action: ImporterV2WorkspaceAction
}) {
  // Keep the pure overlay/preview helpers importable in unit tests without
  // requiring DATABASE_URL. Runtime persistence is loaded only for apply.
  const { prisma } = await import('@/lib/prisma')

  const scopedDecisions = await prisma.importerV2WorkspaceDecision.findMany({
    where: {
      batchId: input.batchId,
      scopeToken: input.scopeToken,
    },
    select: { rowId: true },
  })
  const rowIds = [...new Set(scopedDecisions.map((decision) => decision.rowId))]
  if (rowIds.length === 0) {
    return {
      activeErrorCount: 0,
      activeWarningCount: 0,
      recheckRequiredCount: 0,
    }
  }

  const rows = await prisma.importerV2WorkspaceRow.findMany({
    where: { id: { in: rowIds } },
    select: {
      id: true,
      inclusion: true,
      needsReevaluation: true,
      evaluated: true,
      identityResolution: true,
      decisions: {
        orderBy: { createdAt: 'asc' },
        select: {
          field: true,
          action: true,
          value: true,
          explanation: true,
        },
      },
    },
  })

  const overlay = importerV2WorkspaceDirectOverlay(input.action)
  const grouped = new Map<
    string,
    {
      ids: string[]
      issueCount: number
      hasErrors: boolean
      primaryStatus: string
      statuses: string[]
    }
  >()
  let activeErrorCount = 0
  let activeWarningCount = 0
  let recheckRequiredCount = 0

  for (const row of rows) {
    const issueState = importerV2WorkspaceIssueState({
      evaluated: row.evaluated,
      inclusion: row.inclusion,
      decisions: row.decisions,
    })
    activeErrorCount += issueState.activeErrorCount
    activeWarningCount += issueState.activeWarningCount

    const identityNeedsReview = importerV2WorkspaceIdentityNeedsReview({
      identityResolution: row.identityResolution,
      decisions: row.decisions,
    })

    let primaryStatus: string
    let statuses: string[]
    if (row.inclusion === 'EXCLUDED') {
      primaryStatus = 'EXCLUDED'
      statuses = ['EXCLUDED']
    } else if (
      issueState.activeErrorCount > 0 ||
      identityNeedsReview
    ) {
      primaryStatus = 'NEEDS_REVIEW'
      statuses = row.needsReevaluation
        ? ['NEEDS_REVIEW', 'RECHECK_REQUIRED']
        : ['NEEDS_REVIEW']
    } else if (issueState.activeWarningCount > 0) {
      primaryStatus = 'WARNING'
      statuses = row.needsReevaluation
        ? ['WARNING', 'RECHECK_REQUIRED']
        : ['WARNING']
    } else if (row.needsReevaluation) {
      primaryStatus = 'RECHECK_REQUIRED'
      statuses = ['RECHECK_REQUIRED']
    } else {
      primaryStatus = 'VALID'
      statuses = ['VALID']
    }

    if (statuses.includes('RECHECK_REQUIRED')) recheckRequiredCount += 1

    const key = `${primaryStatus}|${statuses.join(',')}|${issueState.activeIssues.length}|${issueState.activeErrorCount > 0}`
    const current = grouped.get(key)
    if (current) current.ids.push(row.id)
    else {
      grouped.set(key, {
        ids: [row.id],
        issueCount: issueState.activeIssues.length,
        hasErrors: issueState.activeErrorCount > 0,
        primaryStatus,
        statuses,
      })
    }
  }

  await prisma.$transaction(async (tx) => {
    if (overlay) {
      await tx.importerV2WorkspaceRow.updateMany({
        where: { id: { in: rowIds } },
        data: overlay,
      })
    }
    for (const group of grouped.values()) {
      await tx.importerV2WorkspaceRow.updateMany({
        where: { id: { in: group.ids } },
        data: {
          issueCount: group.issueCount,
          hasErrors: group.hasErrors,
          statuses: group.statuses,
          primaryStatus: group.primaryStatus,
        },
      })
    }
  })

  return { activeErrorCount, activeWarningCount, recheckRequiredCount }
}
