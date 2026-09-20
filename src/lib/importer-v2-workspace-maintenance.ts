import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { ensureImporterV2WorkspaceRuleBook } from '@/lib/importer-v2-workspace-rule-book'
import type {
  ImporterV2Field,
  ImporterV2StagedRow,
} from '@/lib/importer-v2-evaluator'
import { compileImporterV2RuleSet } from '@/lib/importer-v2-rule-compiler'
import { evaluateImporterV2RuleRows } from '@/lib/importer-v2-rule-engine'
import { getActiveImporterV2RuleSet } from '@/lib/importer-v2-rule-store'
import {
  automaticImporterV2StackTopologyDecisions,
  importerV2TopologyFromDecisions,
} from '@/lib/importer-v2-stack-topology'
import {
  importerV2WorkspaceEffectiveEvaluated,
  importerV2WorkspaceIssueState,
} from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceIdentityNeedsReview } from '@/lib/importer-v2-workspace-identity-state'
import {
  stageImporterV2Xlsx,
  type ImporterV2XlsxStageConfig,
} from '@/lib/importer-v2-ingestion-store'

const PROPOSABLE_FIELDS = new Set<ImporterV2Field>([
  'customer',
  'businessUnit',
  'site',
  'vendor',
  'productFamily',
  'softwarePlatform',
  'model',
  'deviceType',
  'currentFirmware',
])

type WorkspaceDecisionInput = {
  rowId: string
  rowNumber: number
  field: string | null
  action: string
  value?: unknown
  explanation: string
  scopeToken: string
}

type EvaluatedSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<
    Record<ImporterV2Field, { id?: string | null; label?: string } | null>
  >
  fields?: Partial<
    Record<
      ImporterV2Field,
      {
        decision?: {
          source?: string
          requiresConfirmation?: boolean
        }
      }
    >
  >
  issues?: Array<{
    field: ImporterV2Field
    severity: 'WARNING' | 'ERROR'
    code: string
    message: string
  }>
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

function hash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function normalized(value: string | null | undefined) {
  const result = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return result || null
}

function decisionSignature(input: {
  rowNumber: number
  field: string | null
  action: string
  value?: unknown
}) {
  return hash({
    rowNumber: input.rowNumber,
    field: input.field,
    action: input.action,
    value: input.value ?? null,
  })
}

function automaticCatalogProposalDecisions(row: {
  id: string
  rowNumber: number
  evaluated: unknown
}) {
  const evaluated = row.evaluated as EvaluatedSnapshot
  const decisions: WorkspaceDecisionInput[] = []

  for (const issue of evaluated.issues ?? []) {
    if (
      issue.code !== 'REQUIRED_FIELD_UNRESOLVED' &&
      issue.code !== 'OPTIONAL_FIELD_UNRESOLVED'
    ) {
      continue
    }
    if (!PROPOSABLE_FIELDS.has(issue.field)) continue

    const target = evaluated.proposedCanonicalValues?.[issue.field]
    const label = normalized(target?.label)
    if (!label) continue

    const value = { id: target?.id ?? null, label }
    decisions.push({
      rowId: row.id,
      rowNumber: row.rowNumber,
      field: issue.field,
      action: target?.id ? 'LINK_FIELD' : 'SET_FIELD',
      value,
      explanation: target?.id
        ? 'Automatically accepted the exact canonical value already resolved by the importer.'
        : 'The source supplied a concrete value that is not yet canonical. It is treated as one grouped catalog proposal; final publication approval remains explicit.',
      scopeToken: `AUTO_PROPOSAL:${issue.field}:${hash({ field: issue.field, label }).slice(0, 20)}`,
    })
  }

  return decisions
}

function stagedRuleRow(row: {
  rowNumber: number
  evaluated: unknown
}): ImporterV2StagedRow {
  const evaluated = row.evaluated as EvaluatedSnapshot
  return {
    rowNumber: row.rowNumber,
    rawValues: evaluated.rawValues ?? {},
  }
}

function ruleDecisions(input: {
  rowId: string
  rowNumber: number
  evaluation: ReturnType<typeof evaluateImporterV2RuleRows>[number]
  revisionId: string
}) {
  const result: WorkspaceDecisionInput[] = []
  const { evaluation } = input

  if (evaluation.excluded && evaluation.exclusionDecision) {
    result.push({
      rowId: input.rowId,
      rowNumber: input.rowNumber,
      field: null,
      action: 'EXCLUDE_ROW',
      explanation: evaluation.exclusionDecision.explanation,
      scopeToken: `AUTO_RULE:${input.revisionId}:${evaluation.exclusionDecision.ruleId}`,
    })
  }

  if (evaluation.deviceMatch) {
    result.push({
      rowId: input.rowId,
      rowNumber: input.rowNumber,
      field: null,
      action: 'IDENTITY_RESOLUTION',
      value: {
        kind: 'MANUAL_OVERRIDE',
        canonicalDeviceId: evaluation.deviceMatch.deviceId,
        source: 'PROFILE_RULE',
      },
      explanation: evaluation.deviceMatch.explanation,
      scopeToken: `AUTO_RULE:${input.revisionId}:${evaluation.deviceMatch.ruleId}:identity`,
    })
  }

  for (const [fieldName, outcome] of Object.entries(evaluation.fields)) {
    if (!outcome || outcome.applied.length === 0) continue
    const field = fieldName as ImporterV2Field
    const trace = outcome.applied
      .map((item) => `${item.ruleName} (${item.ruleId}@${item.ruleVersion})`)
      .join(', ')
    const explanation = `Applied active importer rule: ${trace}.`
    const scopeToken = `AUTO_RULE:${input.revisionId}:${hash({ row: input.rowNumber, field, trace }).slice(0, 20)}`

    if (outcome.ignored) {
      result.push({
        rowId: input.rowId,
        rowNumber: input.rowNumber,
        field,
        action: 'IGNORE_FIELD',
        explanation,
        scopeToken,
      })
      continue
    }

    if (outcome.mappedTarget) {
      result.push({
        rowId: input.rowId,
        rowNumber: input.rowNumber,
        field,
        action: outcome.mappedTarget.id ? 'LINK_FIELD' : 'SET_FIELD',
        value: outcome.mappedTarget,
        explanation,
        scopeToken,
      })
      continue
    }

    if (outcome.effectiveValue === outcome.originalValue) continue
    if (outcome.effectiveValue === null) {
      result.push({
        rowId: input.rowId,
        rowNumber: input.rowNumber,
        field,
        action: 'CLEAR_FIELD',
        explanation,
        scopeToken,
      })
    } else {
      result.push({
        rowId: input.rowId,
        rowNumber: input.rowNumber,
        field,
        action: 'SET_FIELD',
        value: { id: null, label: outcome.effectiveValue },
        explanation,
        scopeToken,
      })
    }
  }

  return result
}

async function activeRuleDecisions(input: {
  batch: {
    id: string
    provider: string
    sourceAdapterId: string
    profileId: string
  }
  ruleBookId: string
  rows: readonly { id: string; rowNumber: number; evaluated: unknown }[]
}) {
  const active = await getActiveImporterV2RuleSet(input.ruleBookId)
  if (!active || active.rules.length === 0) return []

  const compiled = compileImporterV2RuleSet(active)
  const evaluations = evaluateImporterV2RuleRows(
    compiled,
    input.rows.map(stagedRuleRow),
    {
      profileId: input.batch.profileId,
      provider: input.batch.provider,
      sourceAdapterId: input.batch.sourceAdapterId,
    },
  )
  const byRow = new Map(input.rows.map((row) => [row.rowNumber, row]))

  return evaluations.flatMap((evaluation) => {
    const row = byRow.get(evaluation.rowNumber)
    if (!row) return []
    return ruleDecisions({
      rowId: row.id,
      rowNumber: row.rowNumber,
      evaluation,
      revisionId: active.revisionId,
    })
  })
}

function decisionRequiresManualReview(evaluated: EvaluatedSnapshot) {
  return Object.values(evaluated.fields ?? {}).some(
    (field) =>
      field?.decision?.source === 'NON_BINDING_SUGGESTION' &&
      field.decision.requiresConfirmation !== false,
  )
}

function effectiveTarget(evaluated: EvaluatedSnapshot, field: ImporterV2Field) {
  const target = evaluated.proposedCanonicalValues?.[field]
  return normalized(target?.label)
}

export async function recomputeImporterV2WorkspaceRows(input: {
  batchId: string
  onlyNeedsReevaluation?: boolean
  scopeToken?: string
  rowIds?: string[]
}) {
  const where = {
    batchId: input.batchId,
    ...(input.rowIds ? { id: { in: input.rowIds } } : {}),
    ...(input.scopeToken
      ? { decisions: { some: { scopeToken: input.scopeToken } } }
      : {}),
    ...(input.onlyNeedsReevaluation ? { needsReevaluation: true } : {}),
  }
  let checked = 0
  let afterRowNumber = 0

  let valid = 0
  let warning = 0
  let review = 0
  let excluded = 0
  let stackMembers = 0
  let stacks = 0

  // Keyset pages bound evaluation JSON and decision history in server memory.
  // A revision guard leaves concurrent corrections pending for the next recheck.
  while (true) {
    const rows = await prisma.importerV2WorkspaceRow.findMany({
      where: { ...where, rowNumber: { gt: afterRowNumber } },
      orderBy: { rowNumber: 'asc' },
      take: 200,
      include: { decisions: { orderBy: { createdAt: 'asc' } } },
    })
    if (rows.length === 0) break
    for (let offset = 0; offset < rows.length; offset += 10) {
      await Promise.all(
        rows.slice(offset, offset + 10).map(async (row) => {
          const effective = importerV2WorkspaceEffectiveEvaluated({
            evaluated: row.evaluated,
            inclusion: row.inclusion,
            decisions: row.decisions,
          })
          const snapshot = effective.evaluated as EvaluatedSnapshot
          const issueState = importerV2WorkspaceIssueState({
            evaluated: row.evaluated,
            inclusion: row.inclusion,
            decisions: row.decisions,
          })
          const topology = importerV2TopologyFromDecisions(row.decisions)
          const isStackMember = topology.role === 'STACK_MEMBER'

          const excludedByDecision = row.decisions.some(
            (decision) => decision.action === 'EXCLUDE_ROW',
          )
          const isExcluded = row.inclusion === 'EXCLUDED' || excludedByDecision
          const identityNeedsReview = isStackMember
            ? false
            : importerV2WorkspaceIdentityNeedsReview({
                identityResolution: row.identityResolution,
                decisions: row.decisions,
              })
          const suggestionNeedsReview = decisionRequiresManualReview(snapshot)
          const repeatAmbiguous =
            !isStackMember && row.repeatClassification === 'AMBIGUOUS'

          let primaryStatus: string
          if (isExcluded) {
            primaryStatus = 'EXCLUDED'
          } else if (
            issueState.activeErrorCount > 0 ||
            identityNeedsReview ||
            suggestionNeedsReview ||
            repeatAmbiguous
          ) {
            primaryStatus = 'NEEDS_REVIEW'
          } else if (isStackMember) {
            primaryStatus = 'STACK_MEMBER'
          } else if (issueState.activeWarningCount > 0) {
            primaryStatus = 'WARNING'
          } else {
            primaryStatus = 'VALID'
          }

          const statuses = [primaryStatus]
          if (topology.role === 'STACK' && !statuses.includes('STACK'))
            statuses.push('STACK')
          if (isStackMember && issueState.activeWarningCount > 0)
            statuses.push('WARNING')
          if (
            row.repeatClassification &&
            !isStackMember &&
            row.repeatClassification !== primaryStatus &&
            row.repeatClassification !== 'AMBIGUOUS'
          ) {
            statuses.push(row.repeatClassification)
          }

          const updated = await prisma.importerV2WorkspaceRow.updateMany({
            where: { id: row.id, reviewRevision: row.reviewRevision },
            data: {
              inclusion: isExcluded ? 'EXCLUDED' : 'INCLUDED',
              statuses,
              primaryStatus,
              issueCount: issueState.activeIssues.length,
              hasErrors: issueState.activeErrorCount > 0,
              needsReevaluation: false,
              customer: effectiveTarget(snapshot, 'customer'),
              businessUnit: effectiveTarget(snapshot, 'businessUnit'),
              site: effectiveTarget(snapshot, 'site'),
              sourceName:
                effectiveTarget(snapshot, 'deviceName') ??
                normalized(snapshot.rawValues?.deviceName),
              hostname:
                effectiveTarget(snapshot, 'hostname') ??
                normalized(snapshot.rawValues?.hostname),
              vendor: effectiveTarget(snapshot, 'vendor'),
              deviceType: effectiveTarget(snapshot, 'deviceType'),
              canonicalModel: effectiveTarget(snapshot, 'model'),
              productFamily: effectiveTarget(snapshot, 'productFamily'),
              softwarePlatform: effectiveTarget(snapshot, 'softwarePlatform'),
              interpretedFirmware: effectiveTarget(snapshot, 'currentFirmware'),
            },
          })
          checked += updated.count
          if (updated.count) {
            if (topology.role === 'STACK') stacks += 1
            if (primaryStatus === 'EXCLUDED') excluded += 1
            else if (primaryStatus === 'NEEDS_REVIEW') review += 1
            else if (primaryStatus === 'STACK_MEMBER') stackMembers += 1
            else if (primaryStatus === 'WARNING') warning += 1
            else valid += 1
          }
        }),
      )
    }
    afterRowNumber = rows[rows.length - 1].rowNumber
  }

  if (checked > 0) {
    await prisma.importerV2WorkspaceBatch.update({
      where: { id: input.batchId },
      data: { updatedAt: new Date() },
    })
  }

  return { checked, valid, warning, review, excluded, stacks, stackMembers }
}

export async function initializeImporterV2WorkspaceAutomation(
  batchId: string,
  onlyChangedRows = false,
) {
  const batch = await prisma.importerV2WorkspaceBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: {
      id: true,
      provider: true,
      sourceAdapterId: true,
      profileId: true,
      ruleBookId: true,
    },
  })
  const rows = await prisma.importerV2WorkspaceRow.findMany({
    where: { batchId },
    orderBy: { rowNumber: 'asc' },
    select: {
      id: true,
      rowNumber: true,
      sourceName: true,
      hostname: true,
      customer: true,
      businessUnit: true,
      site: true,
      deviceType: true,
      evaluated: true,
    },
  })
  const ruleBookId = await ensureImporterV2WorkspaceRuleBook({
    batchId,
    provider: batch.provider,
    profileId: batch.profileId,
    currentRuleBookId: batch.ruleBookId,
  })

  const existing = await prisma.importerV2WorkspaceDecision.findMany({
    where: { batchId },
    select: { rowNumber: true, field: true, action: true, value: true },
  })
  const existingSignatures = new Set(
    existing.map((decision) =>
      decisionSignature({
        rowNumber: decision.rowNumber,
        field: decision.field,
        action: decision.action,
        value: decision.value,
      }),
    ),
  )

  const topology = automaticImporterV2StackTopologyDecisions({
    provider: batch.provider,
    rows,
  })
  const proposed: WorkspaceDecisionInput[] = [
    ...topology.decisions,
    ...rows.flatMap(automaticCatalogProposalDecisions),
    ...(await activeRuleDecisions({
      batch: {
        id: batch.id,
        provider: batch.provider,
        sourceAdapterId: batch.sourceAdapterId,
        profileId: batch.profileId,
      },
      ruleBookId,
      rows,
    })),
  ]

  const fresh = proposed.filter((decision) => {
    const signature = decisionSignature(decision)
    if (existingSignatures.has(signature)) return false
    existingSignatures.add(signature)
    return true
  })

  if (fresh.length > 0) {
    await prisma.importerV2WorkspaceDecision.createMany({
      data: fresh.map((decision) => ({
        batchId,
        rowId: decision.rowId,
        rowNumber: decision.rowNumber,
        field: decision.field,
        action: decision.action,
        value: decision.value == null ? undefined : jsonValue(decision.value),
        explanation: decision.explanation,
        scopeToken: decision.scopeToken,
        actorUserId: null,
      })),
    })
  }

  const result = await recomputeImporterV2WorkspaceRows({
    batchId,
    ...(onlyChangedRows
      ? { rowIds: [...new Set(fresh.map((decision) => decision.rowId))] }
      : {}),
  })
  return {
    ...result,
    automaticDecisionsApplied: fresh.length,
    topologyDecisionsApplied: fresh.filter((decision) =>
      decision.action.startsWith('TOPOLOGY_STACK_'),
    ).length,
    detectedStackGroups: topology.groups.length,
    detectedStackMembers: topology.groups.reduce(
      (count, group) => count + group.memberRows.length,
      0,
    ),
    ruleBookId,
  }
}

export async function recheckImporterV2Workspace(
  batchId: string,
  scopeToken?: string,
) {
  return recomputeImporterV2WorkspaceRows({
    batchId,
    onlyNeedsReevaluation: true,
    scopeToken,
  })
}

export async function deleteImporterV2WorkspaceBatch(batchId: string) {
  const batch = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      publishedRowCount: true,
      _count: { select: { publicationAttempts: true } },
    },
  })
  if (!batch) throw new Error('Staged import was not found.')
  if (batch.publishedRowCount > 0 || batch._count.publicationAttempts > 0) {
    throw new Error(
      'This import has publication history and cannot be deleted. Keep it for audit; only fully unpublished staged imports can be removed.',
    )
  }
  await prisma.importerV2WorkspaceBatch.delete({ where: { id: batchId } })
  return { id: batchId, deleted: true }
}

export async function stageImporterV2XlsxWithAutomation(input: {
  file: File
  config: ImporterV2XlsxStageConfig
}) {
  const data = await stageImporterV2Xlsx(input)
  const automation = await initializeImporterV2WorkspaceAutomation(
    data.batch.id,
  )
  return { ...data, automation }
}
