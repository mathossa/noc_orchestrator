export type ReconciliationModelDraft = {
  vendorSourceValue: string
}

export type RepeatedImportBatch = {
  fileName: string
  profileId: string | null
}

export type RepeatedImportProfile = {
  id: string
  isActive: boolean
  settings: { sheetName: string }
}

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

export function modelDraftIdsForVendorSource<T extends ReconciliationModelDraft>(
  drafts: Record<string, T>,
  referenceId: string,
) {
  const source = normalized(drafts[referenceId]?.vendorSourceValue)
  if (!source) return [referenceId]
  const matches = Object.entries(drafts)
    .filter(([, draft]) => normalized(draft.vendorSourceValue) === source)
    .map(([id]) => id)
  return matches.length ? matches : [referenceId]
}

export function profileIdForRepeatedWorkbook(
  fileName: string,
  sheetNames: string[],
  batches: RepeatedImportBatch[],
  profiles: RepeatedImportProfile[],
) {
  const normalizedFileName = normalized(fileName)
  const availableSheets = new Set(sheetNames)
  for (const batch of batches) {
    if (!batch.profileId || normalized(batch.fileName) !== normalizedFileName) continue
    const profile = profiles.find((candidate) =>
      candidate.id === batch.profileId &&
      candidate.isActive &&
      availableSheets.has(candidate.settings.sheetName),
    )
    if (profile) return profile.id
  }
  return null
}
