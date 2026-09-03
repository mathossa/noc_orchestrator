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

function stripVendor(modelName: string, vendorName: string, vendorCode: string) {
  const vendorTokens = [vendorName, vendorCode]
    .map((value) => value.normalize('NFKC').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
  let result = modelName.normalize('NFKC').trim()
  for (const token of vendorTokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`^${escaped}[\\s._/-]*`, 'i'), '')
  }
  return result.trim()
}

/**
 * Conservative proposal only. The result is shown for review; it is never
 * silently created. Prefer recognizable product-series notation over guessing.
 */
export function suggestNewImportModelFamilyName(modelName: string, vendorName = '', vendorCode = '') {
  const stripped = stripVendor(modelName, vendorName, vendorCode)
  if (!stripped) return null

  const fortinet = stripped.match(/\b(FortiGate|FortiSwitch|FortiAP|FortiExtender)[\s._/-]*([A-Z]?\d{2,4}[A-Z]?)\b/i)
  if (fortinet) {
    const product = fortinet[1].replace(/^forti([a-z])/, (_match, letter: string) => `Forti${letter.toUpperCase()}`)
    return `${product} ${fortinet[2].toUpperCase()}`
  }

  const numberedSeries = stripped.match(/(?:^|[^0-9])(?:WS[-_.]?)?(?:C|CX|JL)?(\d{4})(?=[^0-9]|$)/i)
  if (numberedSeries) return numberedSeries[1]

  return null
}
