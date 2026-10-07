import { importerV2CatalogProposalRequiresApproval } from '@/lib/importer-v2-publication-approval'
import {
  findImporterV2PublicationIdentityConflicts,
} from '@/lib/importer-v2-publication-identity-diagnostics'
import {
  getImporterV2PublicationQa,
  ImporterV2PublicationConflictError,
  ImporterV2PublicationValidationError,
  publishImporterV2Batch,
} from '@/lib/importer-v2-publication-store'

export type ImporterV2AutoPublicationResult = {
  status: 'PUBLISHED' | 'REVIEW_REQUIRED' | 'NOTHING_TO_PUBLISH'
  publishedLogicalDeviceCount: number
  publishedRowCount: number
  remainingIncludedRows: number
  reconciliationRequired: boolean
  blockedRowNumbers: number[]
  error: string | null
}

function sorted(values: Iterable<number>) {
  return [...new Set(values)].sort((left, right) => left - right)
}

/**
 * Publish only rows that are already VALID and need no human approval.
 *
 * This deliberately does not auto-approve new customer/catalog/model proposals,
 * does not publish rows involved in staged/canonical identity conflicts, and
 * leaves any warning/review row in the shared reconciliation workspace.
 */
export async function autoPublishImporterV2SafeValidRows(
  batchId: string,
): Promise<ImporterV2AutoPublicationResult> {
  const qa = await getImporterV2PublicationQa(batchId)
  const candidates = qa.publication.validOnlyCandidateRows

  if (candidates.length === 0) {
    const remainingIncludedRows = Math.max(
      0,
      qa.counts.pending - qa.publication.excludedRows.length,
    )
    return {
      status: remainingIncludedRows > 0 ? 'REVIEW_REQUIRED' : 'NOTHING_TO_PUBLISH',
      publishedLogicalDeviceCount: 0,
      publishedRowCount: 0,
      remainingIncludedRows,
      reconciliationRequired: remainingIncludedRows > 0,
      blockedRowNumbers: [],
      error: null,
    }
  }

  const approvalBlocked = new Set(
    qa.catalogProposals
      .filter((proposal) =>
        importerV2CatalogProposalRequiresApproval(qa, proposal),
      )
      .flatMap((proposal) => proposal.rowNumbers),
  )

  // Include unresolved rows in collision analysis so a VALID row cannot
  // automatically claim an identifier that is simultaneously present on a row
  // waiting for engineer review.
  const identityScope = sorted([
    ...qa.publication.validOnlyCandidateRows,
    ...qa.publication.allResolvedCandidateRows,
    ...qa.publication.unresolvedRows.map((row) => row.rowNumber),
  ])
  const identityConflicts = await findImporterV2PublicationIdentityConflicts({
    batchId,
    rowNumbers: identityScope,
  })
  const identityBlocked = new Set(
    identityConflicts.flatMap((conflict) => [
      conflict.rowNumber,
      ...conflict.stagedConflicts.map((other) => other.rowNumber),
    ]),
  )

  const qaIdentityBlocked = new Set(
    qa.identityConflicts.map((conflict) => conflict.rowNumber),
  )
  const blocked = new Set<number>([
    ...approvalBlocked,
    ...identityBlocked,
    ...qaIdentityBlocked,
  ])
  const safeRows = candidates.filter((rowNumber) => !blocked.has(rowNumber))

  if (safeRows.length === 0) {
    const remainingIncludedRows = Math.max(
      0,
      qa.counts.pending - qa.publication.excludedRows.length,
    )
    return {
      status: 'REVIEW_REQUIRED',
      publishedLogicalDeviceCount: 0,
      publishedRowCount: 0,
      remainingIncludedRows,
      reconciliationRequired: remainingIncludedRows > 0,
      blockedRowNumbers: sorted(blocked),
      error: null,
    }
  }

  try {
    const result = await publishImporterV2Batch({
      batchId,
      mode: 'VALID_ONLY',
      qaFingerprint: qa.qaFingerprint,
      idempotencyKey: `AUTO_VALID:${qa.qaFingerprint}`,
      approvedProposalKeys: [],
      rowNumbers: safeRows,
      actorUserId: null,
    })

    return {
      status: 'PUBLISHED',
      publishedLogicalDeviceCount: result.publishedLogicalDeviceCount,
      publishedRowCount: result.publishedRowCount,
      remainingIncludedRows: result.remainingIncludedRows,
      reconciliationRequired: result.remainingIncludedRows > 0,
      blockedRowNumbers: sorted(blocked),
      error: null,
    }
  } catch (error) {
    if (
      error instanceof ImporterV2PublicationConflictError ||
      error instanceof ImporterV2PublicationValidationError
    ) {
      const remainingIncludedRows = Math.max(
        0,
        qa.counts.pending - qa.publication.excludedRows.length,
      )
      return {
        status: 'REVIEW_REQUIRED',
        publishedLogicalDeviceCount: 0,
        publishedRowCount: 0,
        remainingIncludedRows,
        reconciliationRequired: remainingIncludedRows > 0,
        blockedRowNumbers: sorted(blocked),
        error: error.message,
      }
    }
    throw error
  }
}
