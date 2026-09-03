export type ImportVendorIdentity = {
  id: string
  name: string
  code?: string | null
  isActive: boolean
}

export type ImportVendorAlias = {
  sourceValue: string
  targetId: string
}

export type ImportedModelVendorResolution = {
  sourceValue: string
  vendor: ImportVendorIdentity
}

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function isPrefixToken(source: string, prefix: string) {
  if (!source || !prefix || source === prefix) return source === prefix
  if (!source.startsWith(prefix)) return false
  return /^[\s._/-]/.test(source.slice(prefix.length, prefix.length + 1))
}

export function resolveImportedModelVendor(
  sourceModel: string,
  vendors: ImportVendorIdentity[],
  aliases: ImportVendorAlias[] = [],
): ImportedModelVendorResolution | null {
  const source = normalized(sourceModel)
  if (!source) return null
  const activeById = new Map(vendors.filter((vendor) => vendor.isActive).map((vendor) => [vendor.id, vendor]))
  const candidates: Array<{ sourceValue: string; vendor: ImportVendorIdentity; length: number; priority: number }> = []

  for (const alias of aliases) {
    const target = activeById.get(alias.targetId)
    const prefix = normalized(alias.sourceValue)
    if (target && isPrefixToken(source, prefix)) candidates.push({ sourceValue: alias.sourceValue, vendor: target, length: prefix.length, priority: 2 })
  }
  for (const vendor of activeById.values()) {
    for (const candidate of [vendor.name, vendor.code ?? '']) {
      const prefix = normalized(candidate)
      if (isPrefixToken(source, prefix)) candidates.push({ sourceValue: candidate, vendor, length: prefix.length, priority: 1 })
    }
  }

  candidates.sort((left, right) => right.length - left.length || right.priority - left.priority)
  const best = candidates[0]
  if (!best) return null
  const equallyStrong = candidates.filter((candidate) => candidate.length == best.length && candidate.priority == best.priority)
  if (new Set(equallyStrong.map((candidate) => candidate.vendor.id)).size !== 1) return null
  return { sourceValue: best.sourceValue, vendor: best.vendor }
}

export function inferImportedModelVendor(
  sourceModel: string,
  vendors: ImportVendorIdentity[],
): ImportVendorIdentity | null {
  return resolveImportedModelVendor(sourceModel, vendors)?.vendor ?? null
}
