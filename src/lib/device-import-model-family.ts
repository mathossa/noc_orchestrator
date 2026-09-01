function normalize(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
}

function compact(value: string) {
  return normalize(value).replace(/\s+/g, '')
}

export type ImportFamilyCandidate = {
  id: string
  vendorId: string
  name: string
  isActive: boolean
}

export function suggestImportModelFamily(
  modelName: string,
  vendorId: string,
  families: ImportFamilyCandidate[],
) {
  const modelCompact = compact(modelName)
  const candidates = families
    .filter((family) => family.isActive && family.vendorId === vendorId)
    .map((family) => {
      const familyCompact = compact(family.name)
      if (familyCompact.length < 3 || !modelCompact.includes(familyCompact)) return null
      return { family, specificity: familyCompact.length }
    })
    .filter((item): item is { family: ImportFamilyCandidate; specificity: number } => Boolean(item))
    .sort((left, right) => right.specificity - left.specificity)

  if (!candidates.length) return null
  if (candidates[1] && candidates[0].specificity === candidates[1].specificity) return null
  return candidates[0].family
}
