import { createHash } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { importerV2WorkspaceIssueState } from '@/lib/importer-v2-workspace-effective-overlay'
import {
  importerV2WorkspaceIdentityNeedsReview,
  importerV2WorkspaceIdentityReview,
  type ImporterV2WorkspaceIdentityReview,
} from '@/lib/importer-v2-workspace-identity-state'
import { importerV2WorkspaceWhere } from '@/lib/importer-v2-workspace-store'
import type { ImporterV2WorkspaceSelection } from '@/lib/importer-v2-workspace'

export type ImporterV2BulkIdentityDecision = {
  kind: 'CONFIRM_MATCH'
  canonicalDeviceId: string
  explanation: string
}

export function importerV2BulkIdentityDecision(
  review: ImporterV2WorkspaceIdentityReview | null,
): ImporterV2BulkIdentityDecision | null {
  if (
    !review ||
    review.resolved ||
    !review.requiresConfirmation ||
    review.kind !== 'MATCH_SUGGESTED' ||
    review.candidates.length !== 1
  ) {
    return null
  }

  const candidate = review.candidates[0]
  if (!candidate.canonicalDeviceId) return null

  return {
    kind: 'CONFIRM_MATCH',
    canonicalDeviceId: candidate.canonicalDeviceId,
    explanation:
      'Bulk verified the single unambiguous staged identity candidate from durable source evidence.',
  }
}

function selectionWhere(
  batchId: string,
  selection: ImporterV2WorkspaceSelection,
): Prisma.ImporterV2WorkspaceRowWhereInput {
  if (selection.mode === 'ROWS') {
    return {
      batchId,
      rowNumber: { in: [...new Set(selection.rowNumbers)] },
    }
  }
  return importerV2WorkspaceWhere(batchId, selection.filters)
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

function scopeToken(input: {
  batchId: string
  selection: ImporterV2WorkspaceSelection
  plans: readonly {
    rowNumber: number
    reviewRevision: number
    canonicalDeviceId: string
  }[]
}) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stableValue({
          batchId: input.batchId,
          selection: input.selection,
          plans: [...input.plans].sort(
            (left, right) => left.rowNumber - right.rowNumber,
          ),
        }),
      ),
    )
    .digest('hex')
}

function chunks<T>(values: readonly T[], size = 1_000) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

type BulkRow = Awaited<ReturnType<typeof loadSelectedRows>>[number]

type PlannedVerification = {
  row: BulkRow
  decision: ImporterV2BulkIdentityDecision
  primaryStatus: string
  statuses: string[]
  issueCount: number
  hasErrors: boolean
}

function nextState(
  row: BulkRow,
  decision: ImporterV2BulkIdentityDecision,
): Omit<PlannedVerification, 'row' | 'decision'> {
  const nextDecisions = [
    ...row.decisions,
    {
      action: 'IDENTITY_RESOLUTION',
      field: null,
      value: decision,
      explanation: decision.explanation,
    },
  ]
  const issueState = importerV2WorkspaceIssueState({
    evaluated: row.evaluated,
    inclusion: row.inclusion,
    decisions: nextDecisions,
  })
  const identityStillNeedsReview = importerV2WorkspaceIdentityNeedsReview({
    identityResolution: row.identityResolution,
    decisions: nextDecisions,
  })

  if (row.inclusion === 'EXCLUDED') {
    return {
      primaryStatus: 'EXCLUDED',
      statuses: ['EXCLUDED'],
      issueCount: issueState.activeIssues.length,
      hasErrors: issueState.activeErrorCount > 0,
    }
  }
  if (issueState.activeErrorCount > 0 || identityStillNeedsReview) {
    return {
      primaryStatus: 'NEEDS_REVIEW',
      statuses: row.needsReevaluation
        ? ['NEEDS_REVIEW', 'RECHECK_REQUIRED']
        : ['NEEDS_REVIEW'],
      issueCount: issueState.activeIssues.length,
      hasErrors: issueState.activeErrorCount > 0,
    }
  }
  if (issueState.activeWarningCount > 0) {
    return {
      primaryStatus: 'WARNING',
      statuses: row.needsReevaluation
        ? ['WARNING', 'RECHECK_REQUIRED']
        : ['WARNING'],
      issueCount: issueState.activeIssues.length,
      hasErrors: false,
    }
  }
  if (row.needsReevaluation) {
    return {
      primaryStatus: 'RECHECK_REQUIRED',
      statuses: ['RECHECK_REQUIRED'],
      issueCount: issueState.activeIssues.length,
      hasErrors: false,
    }
  }
  return {
    primaryStatus: 'VALID',
    statuses: ['VALID'],
    issueCount: issueState.activeIssues.length,
    hasErrors: false,
  }
}

async function loadSelectedRows(
  batchId: string,
  selection: ImporterV2WorkspaceSelection,
) {
  return prisma.importerV2WorkspaceRow.findMany({
    where: selectionWhere(batchId, selection),
    orderBy: { rowNumber: 'asc' },
    select: {
      id: true,
      rowNumber: true,
      inclusion: true,
      reviewRevision: true,
      needsReevaluation: true,
      publishedAt: true,
      evaluated: true,
      identityResolution: true,
      decisions: {
        orderBy: { createdAt: 'asc' },
        select: {
          action: true,
          field: true,
          value: true,
          explanation: true,
        },
      },
    },
  })
}

export async function verifyImporterV2WorkspaceIdentities(input: {
  batchId: string
  selection: ImporterV2WorkspaceSelection
  actorUserId?: string | null
}) {
  if (
    input.selection.mode === 'ROWS' &&
    new Set(input.selection.rowNumbers).size === 0
  ) {
    throw new Error('Select at least one staged row to verify.')
  }

  const rows = await loadSelectedRows(input.batchId, input.selection)
  if (rows.length === 0) {
    throw new Error('The selected scope matches no staged rows.')
  }

  const plans: PlannedVerification[] = []
  let alreadyResolvedCount = 0
  let manualReviewCount = 0
  let invalidCount = 0
  let publishedCount = 0
  const manualReviewRows: number[] = []

  for (const row of rows) {
    if (row.publishedAt) {
      publishedCount += 1
      continue
    }
    const review = importerV2WorkspaceIdentityReview({
      identityResolution: row.identityResolution,
      decisions: row.decisions,
    })
    if (!review || review.kind === 'INVALID') {
      invalidCount += 1
      if (manualReviewRows.length < 25) manualReviewRows.push(row.rowNumber)
      continue
    }
    if (review.resolved) {
      alreadyResolvedCount += 1
      continue
    }

    const decision = importerV2BulkIdentityDecision(review)
    if (!decision) {
      manualReviewCount += 1
      if (manualReviewRows.length < 25) manualReviewRows.push(row.rowNumber)
      continue
    }
    plans.push({
      row,
      decision,
      ...nextState(row, decision),
    })
  }

  const token = scopeToken({
    batchId: input.batchId,
    selection: input.selection,
    plans: plans.map((plan) => ({
      rowNumber: plan.row.rowNumber,
      reviewRevision: plan.row.reviewRevision,
      canonicalDeviceId: plan.decision.canonicalDeviceId,
    })),
  })

  if (plans.length > 0) {
    await prisma.$transaction(async (tx) => {
      const currentVersions = await tx.importerV2WorkspaceRow.findMany({
        where: { id: { in: plans.map((plan) => plan.row.id) } },
        select: { id: true, reviewRevision: true, publishedAt: true },
      })
      const currentById = new Map(currentVersions.map((row) => [row.id, row]))
      for (const plan of plans) {
        const current = currentById.get(plan.row.id)
        if (
          !current ||
          current.publishedAt ||
          current.reviewRevision !== plan.row.reviewRevision
        ) {
          throw new Error(
            'A selected identity row changed while bulk verification was running. Refresh and verify the selection again.',
          )
        }
      }

      const decisionRows = plans.map((plan) => ({
        batchId: input.batchId,
        rowId: plan.row.id,
        rowNumber: plan.row.rowNumber,
        field: null,
        action: 'IDENTITY_RESOLUTION',
        value: plan.decision,
        explanation: plan.decision.explanation,
        scopeToken: token,
        actorUserId: input.actorUserId ?? null,
      }))
      for (const decisionChunk of chunks(decisionRows)) {
        await tx.importerV2WorkspaceDecision.createMany({
          data: decisionChunk,
        })
      }

      const groups = new Map<
        string,
        {
          ids: string[]
          primaryStatus: string
          statuses: string[]
          issueCount: number
          hasErrors: boolean
        }
      >()
      for (const plan of plans) {
        const key = JSON.stringify({
          primaryStatus: plan.primaryStatus,
          statuses: plan.statuses,
          issueCount: plan.issueCount,
          hasErrors: plan.hasErrors,
        })
        const group = groups.get(key) ?? {
          ids: [],
          primaryStatus: plan.primaryStatus,
          statuses: plan.statuses,
          issueCount: plan.issueCount,
          hasErrors: plan.hasErrors,
        }
        group.ids.push(plan.row.id)
        groups.set(key, group)
      }

      for (const group of groups.values()) {
        for (const idChunk of chunks(group.ids, 5_000)) {
          await tx.importerV2WorkspaceRow.updateMany({
            where: { id: { in: idChunk } },
            data: {
              reviewRevision: { increment: 1 },
              issueCount: group.issueCount,
              hasErrors: group.hasErrors,
              primaryStatus: group.primaryStatus,
              statuses: group.statuses,
            },
          })
        }
      }
    })
  }

  return {
    selectedCount: rows.length,
    verifiedCount: plans.length,
    alreadyResolvedCount,
    manualReviewCount,
    invalidCount,
    publishedCount,
    manualReviewRows,
    scopeToken: token,
  }
}
