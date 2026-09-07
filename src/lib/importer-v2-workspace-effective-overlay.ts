import type { Prisma } from '../generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ImporterV2FieldIssue } from '@/lib/importer-v2-evaluator'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceActionPreview,
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

  return {
    evaluated: {
      ...evaluated,
      proposedCanonicalValues,
      fields,
      issues: issueState.activeIssues,
    },
    resolvedIssues: issueState.resolvedIssues,
    activeErrorCount: issueState.activeErrorCount,
    activeWarningCount: issueState.activeWarningCount,
  }
}

export function importerV2WorkspaceDirectOverlay(
  action: ImporterV2WorkspaceAction,
): Prisma.ImporterV2WorkspaceRowUpdateManyMutationInput | null {
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

function identityNeedsReview(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const status = (value as { status?: unknown }).status
  return typeof status === 'string' && status.includes('REVIEW')
}

function actionFieldLabel(action: ImporterV2WorkspaceAction) {
  if (action.type === 'EXCLUDE_ROW') return 'Row inclusion'
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
    labels[action.field] ??
    action.field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase())
  )
}

function previewAfterValue(action: ImporterV2WorkspaceAction) {
  if (action.type === 'EXCLUDE_ROW') return 'Excluded'
  if (action.type === 'IGNORE_FIELD') return 'Ignored'
  if (action.type === 'CLEAR_FIELD') return 'Cleared'
  return action.value?.label ?? 'Cleared'
}

export function importerV2WorkspacePreviewChangeReason(
  preview: ImporterV2WorkspaceActionPreview,
  action: ImporterV2WorkspaceAction,
) {
  if (action.type === 'EXCLUDE_ROW') {
    return 'Change: Row inclusion · Included → Excluded.'
  }
  const current = preview.commonValues[action.field]
  const before =
    current === 'MIXED'
      ? 'Different values'
      : current == null || current === ''
        ? '—'
        : current
  return `Change: ${actionFieldLabel(action)} · ${before} → ${previewAfterValue(action)}.`
}

export async function applyImporterV2WorkspaceEffectiveOverlay(input: {
  batchId: string
  scopeToken: string
  action: ImporterV2WorkspaceAction
}) {
  const scopedDecisions = await prisma.importerV2WorkspaceDecision.findMany({
    where: {
      batchId: input.batchId,
      scopeToken: input.scopeToken,
      action: input.action.type,
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

    let primaryStatus: string
    let statuses: string[]
    if (row.inclusion === 'EXCLUDED') {
      primaryStatus = 'EXCLUDED'
      statuses = ['EXCLUDED']
    } else if (
      issueState.activeErrorCount > 0 ||
      identityNeedsReview(row.identityResolution)
    ) {
      primaryStatus = 'NEEDS_REVIEW'
      statuses = row.needsReevaluation
        ? ['NEEDS_REVIEW', 'RECHECK_REQUIRED']
        : ['NEEDS_REVIEW']
    } else if (issueState.activeWarningCount > 0) {
      // A live warning is more useful as the primary status than the fact that
      // a downstream deterministic re-evaluation is also pending.
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
