// SPDX-License-Identifier: AGPL-3.0-only

type PublicationApprovalQa = {
  firmware: {
    unknownFirmwareRows: readonly number[]
    platformConflictRows: readonly number[]
  }
}

type PublicationApprovalProposal = {
  field: string
  context: Record<string, string | null>
  rowNumbers: readonly number[]
}

/**
 * Deterministic observed firmware is evidence, not a catalog policy decision.
 * Safely resolved vendor + platform + exact running-version observations may be
 * canonicalized as Needs review without a second catalog-creation approval.
 */
export function importerV2CatalogProposalRequiresApproval(
  qa: PublicationApprovalQa,
  proposal: PublicationApprovalProposal,
) {
  if (proposal.field !== 'currentFirmware') return true
  if (!proposal.context.vendor || !proposal.context.softwarePlatform) return true

  const unsafeRows = new Set([
    ...qa.firmware.unknownFirmwareRows,
    ...qa.firmware.platformConflictRows,
  ])
  return proposal.rowNumbers.some((rowNumber) => unsafeRows.has(rowNumber))
}
