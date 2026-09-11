import { prisma } from '@/lib/prisma'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import { importerV2DerivedStackSourceId } from '@/lib/importer-v2-stack-identity'
import { importerV2TopologyFromDecisions } from '@/lib/importer-v2-stack-topology'
import { importerV2WorkspaceEffectiveEvaluated } from '@/lib/importer-v2-workspace-effective-overlay'
import { reconcileImporterV2ManualIdentity } from '@/lib/importer-v2-workspace-identity-repair'

type CanonicalTarget = { id?: string | null; label?: string } | null
type EffectiveSnapshot = {
  rawValues?: Partial<Record<ImporterV2Field, string | null>>
  proposedCanonicalValues?: Partial<Record<ImporterV2Field, CanonicalTarget>>
}

function clean(value: string | null | undefined) {
  const result = value?.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return result || null
}

function effectiveText(snapshot: EffectiveSnapshot, field: ImporterV2Field) {
  return (
    clean(snapshot.proposedCanonicalValues?.[field]?.label) ??
    clean(snapshot.rawValues?.[field])
  )
}

/**
 * Give detected logical stacks an explicit source crosswalk key when the
 * provider export omitted its own object ID. This happens after topology
 * detection, so member serial/MAC values are never promoted to the stack.
 */
export async function ensureImporterV2DerivedStackSourceIdentities(batchId: string) {
  const batch = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { id: batchId },
    select: {
      provider: true,
      sourceAdapterId: true,
      rows: {
        where: { inclusion: 'INCLUDED', publishedAt: null },
        orderBy: { rowNumber: 'asc' },
        select: {
          id: true,
          rowNumber: true,
          evaluated: true,
          decisions: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              field: true,
              action: true,
              value: true,
              explanation: true,
              actorUserId: true,
              createdAt: true,
            },
          },
        },
      },
    },
  })
  if (!batch) throw new Error('Importer batch was not found.')

  const additions: Array<{
    batchId: string
    rowId: string
    rowNumber: number
    field: 'sourceId'
    action: 'SET_FIELD'
    value: { id: null; label: string }
    explanation: string
    scopeToken: string
    actorUserId: null
  }> = []

  for (const row of batch.rows) {
    const topology = importerV2TopologyFromDecisions(row.decisions)
    if (topology.role !== 'STACK' || !topology.groupKey) continue

    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: 'INCLUDED',
      decisions: row.decisions,
    }).evaluated as EffectiveSnapshot
    if (effectiveText(snapshot, 'sourceId')) continue

    const sourceId = importerV2DerivedStackSourceId({
      provider: batch.provider,
      sourceAdapterId: batch.sourceAdapterId,
      groupKey: topology.groupKey,
    })
    additions.push({
      batchId,
      rowId: row.id,
      rowNumber: row.rowNumber,
      field: 'sourceId',
      action: 'SET_FIELD',
      value: { id: null, label: sourceId },
      explanation:
        'The source export omitted a provider object ID for this logical stack. A deterministic derived stack source key was added for crosswalk/repeat-import identity; physical member serial/MAC values remain member evidence only.',
      scopeToken: `AUTO_TOPOLOGY:DERIVED_STACK_SOURCE:${row.rowNumber}`,
      actorUserId: null,
    })
  }

  if (additions.length === 0) {
    return {
      appliedCount: 0,
      repairedIdentityCount: 0,
    }
  }

  await prisma.importerV2WorkspaceDecision.createMany({
    data: additions.map((item) => ({
      ...item,
      value: JSON.parse(JSON.stringify(item.value)),
    })),
  })
  await prisma.importerV2WorkspaceRow.updateMany({
    where: { id: { in: additions.map((item) => item.rowId) } },
    data: { reviewRevision: { increment: 1 } },
  })

  const repaired = await reconcileImporterV2ManualIdentity(batchId)
  return {
    appliedCount: additions.length,
    repairedIdentityCount: repaired.repairedRowCount,
  }
}
