import { createHash } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  IMPORTER_V2_FIRMWARE_VERIFICATION_ACTION,
  importerV2ObservedFirmwareVerificationDecision,
  importerV2ObservedFirmwareWasVerified,
  type ImporterV2ObservedFirmwareVerificationValue,
} from '@/lib/importer-v2-firmware-verification-policy'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceWhere } from '@/lib/importer-v2-workspace-store'
import type { ImporterV2WorkspaceSelection } from '@/lib/importer-v2-workspace'

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
    value: ImporterV2ObservedFirmwareVerificationValue
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
      publishedAt: true,
      evaluated: true,
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

type SelectedRow = Awaited<ReturnType<typeof loadSelectedRows>>[number]

type VerificationPlan = {
  row: SelectedRow
  value: ImporterV2ObservedFirmwareVerificationValue
  explanation: string
}

/**
 * Apply one-click verification only to firmware evidence that is safe to accept
 * as an observed current-state fact. Conflicting, incompatible, unparseable or
 * platform-less evidence remains manual-review work.
 */
export async function verifyImporterV2WorkspaceObservedFirmware(input: {
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

  const plans: VerificationPlan[] = []
  let alreadyVerifiedCount = 0
  let alreadyTrustedCount = 0
  let manualReviewCount = 0
  let excludedCount = 0
  let publishedCount = 0
  const manualReviewRows: Array<{ rowNumber: number; reason: string }> = []

  for (const row of rows) {
    if (row.inclusion === 'EXCLUDED') {
      excludedCount += 1
      continue
    }
    if (row.publishedAt) {
      publishedCount += 1
      continue
    }
    if (importerV2ObservedFirmwareWasVerified(row.decisions)) {
      alreadyVerifiedCount += 1
      continue
    }

    const effective = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: row.inclusion,
      decisions: row.decisions,
    })
    const decision = importerV2ObservedFirmwareVerificationDecision(
      effective.evaluated,
    )
    if (decision.status === 'ALREADY_TRUSTED') {
      alreadyTrustedCount += 1
      continue
    }
    if (decision.status === 'MANUAL_REVIEW') {
      manualReviewCount += 1
      if (manualReviewRows.length < 25) {
        manualReviewRows.push({
          rowNumber: row.rowNumber,
          reason: decision.reason,
        })
      }
      continue
    }

    plans.push({
      row,
      value: decision.value,
      explanation:
        `Engineer bulk-verified “${decision.value.runningVersion}” on “${decision.value.softwarePlatform}” as this device's observed current firmware. ` +
        'This confirms current-state evidence only; it does not make the release preferred, recommended, desired, or globally compatible with the model.',
    })
  }

  const token = scopeToken({
    batchId: input.batchId,
    selection: input.selection,
    plans: plans.map((plan) => ({
      rowNumber: plan.row.rowNumber,
      reviewRevision: plan.row.reviewRevision,
      value: plan.value,
    })),
  })

  if (plans.length > 0) {
    await prisma.$transaction(async (tx) => {
      const ids = plans.map((plan) => plan.row.id)
      const currentVersions: Array<{
        id: string
        reviewRevision: number
        publishedAt: Date | null
      }> = []
      for (const idChunk of chunks(ids, 5_000)) {
        currentVersions.push(
          ...(await tx.importerV2WorkspaceRow.findMany({
            where: { id: { in: idChunk } },
            select: { id: true, reviewRevision: true, publishedAt: true },
          })),
        )
      }
      const currentById = new Map(currentVersions.map((row) => [row.id, row]))
      for (const plan of plans) {
        const current = currentById.get(plan.row.id)
        if (
          !current ||
          current.publishedAt ||
          current.reviewRevision !== plan.row.reviewRevision
        ) {
          throw new Error(
            'A selected firmware row changed while bulk verification was running. Refresh and verify the selection again.',
          )
        }
      }

      const decisionRows = plans.map((plan) => ({
        batchId: input.batchId,
        rowId: plan.row.id,
        rowNumber: plan.row.rowNumber,
        field: 'currentFirmware',
        action: IMPORTER_V2_FIRMWARE_VERIFICATION_ACTION,
        value: plan.value,
        explanation: plan.explanation,
        scopeToken: token,
        actorUserId: input.actorUserId ?? null,
      }))
      for (const decisionChunk of chunks(decisionRows)) {
        await tx.importerV2WorkspaceDecision.createMany({ data: decisionChunk })
      }
      for (const idChunk of chunks(ids, 5_000)) {
        await tx.importerV2WorkspaceRow.updateMany({
          where: { id: { in: idChunk } },
          data: { reviewRevision: { increment: 1 } },
        })
      }
    })
  }

  return {
    selectedCount: rows.length,
    verifiedCount: plans.length,
    alreadyVerifiedCount,
    alreadyTrustedCount,
    manualReviewCount,
    excludedCount,
    publishedCount,
    manualReviewRows,
    scopeToken: token,
  }
}
