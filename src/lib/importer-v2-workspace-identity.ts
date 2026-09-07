import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { importerV2WorkspaceIssueState } from '@/lib/importer-v2-workspace-effective-overlay'
import {
  importerV2WorkspaceIdentityNeedsReview,
  importerV2WorkspaceIdentityReview,
} from '@/lib/importer-v2-workspace-identity-state'

export type ImporterV2WorkspaceIdentityDecisionKind =
  | 'CONFIRM_MATCH'
  | 'CHOOSE_CANDIDATE'
  | 'CREATE_NEW'
  | 'MANUAL_OVERRIDE'

export type ImporterV2WorkspaceIdentityDecision = {
  kind: ImporterV2WorkspaceIdentityDecisionKind
  canonicalDeviceId?: string | null
  explanation: string
}

function stableDecision(input: ImporterV2WorkspaceIdentityDecision) {
  return {
    kind: input.kind,
    canonicalDeviceId: input.canonicalDeviceId?.trim() || null,
    explanation: input.explanation.trim(),
  }
}

function token(input: {
  batchId: string
  rowNumber: number
  reviewRevision: number
  decision: ImporterV2WorkspaceIdentityDecision
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        batchId: input.batchId,
        rowNumber: input.rowNumber,
        reviewRevision: input.reviewRevision,
        decision: stableDecision(input.decision),
      }),
    )
    .digest('hex')
}

function validateDecision(
  review: NonNullable<ReturnType<typeof importerV2WorkspaceIdentityReview>>,
  decision: ImporterV2WorkspaceIdentityDecision,
) {
  if (!decision.explanation.trim()) {
    throw new Error('Identity decision explanation is required.')
  }

  const canonicalDeviceId = decision.canonicalDeviceId?.trim() || null
  if (decision.kind === 'CREATE_NEW') return
  if (!canonicalDeviceId) {
    throw new Error('Choose a canonical device before confirming this identity decision.')
  }

  if (decision.kind === 'MANUAL_OVERRIDE') return
  if (!review.candidates.some((candidate) => candidate.canonicalDeviceId === canonicalDeviceId)) {
    throw new Error('The selected canonical device is not part of the staged identity candidates.')
  }
  if (decision.kind === 'CONFIRM_MATCH' && review.candidates.length !== 1) {
    throw new Error('Confirm match is only valid when exactly one staged candidate exists.')
  }
}

async function identityRow(batchId: string, rowNumber: number) {
  return prisma.importerV2WorkspaceRow.findUniqueOrThrow({
    where: { batchId_rowNumber: { batchId, rowNumber } },
    select: {
      id: true,
      batchId: true,
      rowNumber: true,
      inclusion: true,
      reviewRevision: true,
      needsReevaluation: true,
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

export async function previewImporterV2WorkspaceIdentityDecision(input: {
  batchId: string
  rowNumber: number
  decision: ImporterV2WorkspaceIdentityDecision
}) {
  const row = await identityRow(input.batchId, input.rowNumber)
  const review = importerV2WorkspaceIdentityReview({
    identityResolution: row.identityResolution,
    decisions: row.decisions,
  })
  if (!review) throw new Error('This staged row has no identity resolution evidence.')
  validateDecision(review, input.decision)

  return {
    scopeToken: token({
      batchId: input.batchId,
      rowNumber: input.rowNumber,
      reviewRevision: row.reviewRevision,
      decision: input.decision,
    }),
    rowNumber: row.rowNumber,
    review,
    decision: stableDecision(input.decision),
    requiresConfirmation: true as const,
  }
}

export async function applyImporterV2WorkspaceIdentityDecision(input: {
  batchId: string
  rowNumber: number
  decision: ImporterV2WorkspaceIdentityDecision
  scopeToken: string
  actorUserId?: string | null
}) {
  const row = await identityRow(input.batchId, input.rowNumber)
  const review = importerV2WorkspaceIdentityReview({
    identityResolution: row.identityResolution,
    decisions: row.decisions,
  })
  if (!review) throw new Error('This staged row has no identity resolution evidence.')
  validateDecision(review, input.decision)

  const expectedToken = token({
    batchId: input.batchId,
    rowNumber: input.rowNumber,
    reviewRevision: row.reviewRevision,
    decision: input.decision,
  })
  if (expectedToken !== input.scopeToken) {
    throw new Error('The staged identity row changed after preview. Review the identity decision again.')
  }

  const decisionValue = stableDecision(input.decision)
  const nextDecisions = [
    ...row.decisions,
    {
      action: 'IDENTITY_RESOLUTION',
      field: null,
      value: decisionValue,
      explanation: decisionValue.explanation,
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

  let primaryStatus: string
  let statuses: string[]
  if (row.inclusion === 'EXCLUDED') {
    primaryStatus = 'EXCLUDED'
    statuses = ['EXCLUDED']
  } else if (issueState.activeErrorCount > 0 || identityStillNeedsReview) {
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

  await prisma.$transaction(async (tx) => {
    await tx.importerV2WorkspaceDecision.create({
      data: {
        batchId: input.batchId,
        rowId: row.id,
        rowNumber: row.rowNumber,
        field: null,
        action: 'IDENTITY_RESOLUTION',
        value: decisionValue,
        explanation: decisionValue.explanation,
        scopeToken: expectedToken,
        actorUserId: input.actorUserId ?? null,
      },
    })
    await tx.importerV2WorkspaceRow.update({
      where: { id: row.id },
      data: {
        reviewRevision: { increment: 1 },
        issueCount: issueState.activeIssues.length,
        hasErrors: issueState.activeErrorCount > 0,
        primaryStatus,
        statuses,
      },
    })
  })

  return {
    rowNumber: row.rowNumber,
    primaryStatus,
    statuses,
    activeErrorCount: issueState.activeErrorCount,
    activeWarningCount: issueState.activeWarningCount,
    identityDecision: decisionValue,
  }
}
