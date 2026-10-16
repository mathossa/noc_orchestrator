import {
  normalizeImporterV2SourceId,
} from '@/lib/importer-v2-identity'
import type { ImporterV2IdentityConflictDiagnostic } from '@/lib/importer-v2-publication-identity-diagnostics'

export type ImporterV2HaSerialReview = {
  rowNumbers: [number, number]
  deviceNames: [string, string]
  reason: string
}

/**
 * A conservative candidate for human-assisted repair, NOT proof of an HA
 * relationship. Source IDs are distinct, device names are distinct, and the
 * only shared durable field is an untrusted imported serial.
 *
 * This operation never merges, publishes or changes device identities.
 * Engineers must independently verify both are physical members before
 * ignoring a copied/cluster-level serial for these exact staged rows.
 */
export function findImporterV2HaSerialReviewCandidates(
  diagnostics: readonly ImporterV2IdentityConflictDiagnostic[],
  conflictingNames: readonly number[] = [],
): ImporterV2HaSerialReview[] {
  const byRow = new Map(diagnostics.map((diagnostic) => [diagnostic.rowNumber, diagnostic]))
  const nameConflicts = new Set(conflictingNames)
  const seen = new Set<string>()
  const candidates: ImporterV2HaSerialReview[] = []

  for (const item of diagnostics) {
    if (item.conflicts.length > 0 || nameConflicts.has(item.rowNumber) ||
        item.stagedConflicts.length !== 1) continue
    const other = item.stagedConflicts[0]
    const sibling = byRow.get(other.rowNumber)
    if (!sibling || sibling.conflicts.length > 0 || nameConflicts.has(sibling.rowNumber) ||
        sibling.stagedConflicts.length !== 1 ||
        sibling.stagedConflicts[0]?.rowNumber !== item.rowNumber) continue

    // Both rows must be real Fortinet devices, not a stack or an accidental
    // duplicate from the same source. We make no assumption about HA membership.
    const reciprocal = sibling.stagedConflicts[0]
    if (![other.vendor, reciprocal.vendor].every((vendor) =>
      typeof vendor === 'string' && vendor.toLocaleLowerCase('en-US').includes('fortinet'))) continue

    const onlySerial = (fields: readonly { field: string }[]) =>
      fields.length === 1 && fields[0].field === 'serialNumber'
    if (!onlySerial(other.matchingIdentifiers) ||
        !onlySerial(reciprocal.matchingIdentifiers)) continue

    const a = normalizeImporterV2SourceId(item.sourceIdentifiers.sourceId)
    const b = normalizeImporterV2SourceId(sibling.sourceIdentifiers.sourceId)
    if (!a || !b || a === b) continue

    const nameA = (item.sourceName ?? item.hostname ?? '').trim()
    const nameB = (sibling.sourceName ?? sibling.hostname ?? '').trim()
    if (!nameA || !nameB || nameA.toLocaleLowerCase('en-US') === nameB.toLocaleLowerCase('en-US')) continue

    // Provider host context must agree. Distinct customers/sites with a
    // shared serial are not assumed to represent a single HA pair.
    const customerA = other.customer?.trim().toLocaleLowerCase('en-US')
    const customerB = reciprocal.customer?.trim().toLocaleLowerCase('en-US')
    const siteA = other.site?.trim().toLocaleLowerCase('en-US')
    const siteB = reciprocal.site?.trim().toLocaleLowerCase('en-US')
    if (!customerA || customerA !== customerB || !siteA || siteA !== siteB) continue

    const nums = [item.rowNumber, sibling.rowNumber].sort((left, right) => left - right) as [number, number]
    const key = nums.join(':')
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      rowNumbers: nums,
      deviceNames: item.rowNumber === nums[0] ? [nameA, nameB] : [nameB, nameA],
      reason: 'Two distinct provider Source IDs and device names share only a reported serial. Verify the real member serials or confirm the source serial is a cluster alias.',
    })
  }
  return candidates.sort((left, right) => left.rowNumbers[0] - right.rowNumbers[0])
}
