import { prisma } from '@/lib/prisma'
import { importerV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

/**
 * Repeat-import identity is calculated from the immutable source snapshot.
 * When an engineer supplies a missing durable identifier later, an originally
 * INVALID row can safely become a NEW create proposal. In that specific case
 * the old AMBIGUOUS repeat classification is no longer meaningful.
 *
 * Existing-device selection is deliberately not inferred here: hostname/site/
 * customer are context clues, not durable identity. Publication still performs
 * the provider-wide uniqueness check before writing a crosswalk.
 */
export async function reconcileImporterV2ManualIdentity(batchId: string) {
  const rows = await prisma.importerV2WorkspaceRow.findMany({
    where: {
      batchId,
      repeatClassification: 'AMBIGUOUS',
      inclusion: 'INCLUDED',
    },
    select: {
      id: true,
      identityResolution: true,
      decisions: {
        orderBy: { createdAt: 'asc' },
        select: { action: true, field: true, value: true },
      },
    },
  })

  const repairedIds: string[] = []
  for (const row of rows) {
    const review = importerV2WorkspaceIdentityReview({
      identityResolution: row.identityResolution,
      decisions: row.decisions,
    })
    if (
      review?.kind === 'NEW' &&
      review.resolved &&
      review.selectedDecision === 'CREATE_NEW'
    ) {
      repairedIds.push(row.id)
    }
  }

  if (repairedIds.length > 0) {
    await prisma.importerV2WorkspaceRow.updateMany({
      where: { id: { in: repairedIds } },
      data: { repeatClassification: 'NEW' },
    })
  }

  return { repairedRowCount: repairedIds.length }
}
