export type ImportVendorIdentity = {
  id: string
  name: string
  code?: string | null
  isActive: boolean
}

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function isPrefixToken(source: string, prefix: string) {
  if (!source || !prefix || source === prefix) return source === prefix
  if (!source.startsWith(prefix)) return false
  return /^[\s._/-]/.test(source.slice(prefix.length, prefix.length + 1))
}

export function inferImportedModelVendor(
  sourceModel: string,
  vendors: ImportVendorIdentity[],
): ImportVendorIdentity | null {
  const source = normalized(sourceModel)
  if (!source) return null

  const matches = vendors
    .filter((vendor) => vendor.isActive)
    .flatMap((vendor) => [vendor.name, vendor.code ?? '']
      .map((candidate) => normalized(candidate))
      .filter((candidate) => isPrefixToken(source, candidate))
      .map((candidate) => ({ vendor, length: candidate.length })))
    .sort((left, right) => right.length - left.length)

  const best = matches[0]
  if (!best) return null
  const equallySpecific = matches.filter((match) => match.length === best.length)
  if (new Set(equallySpecific.map((match) => match.vendor.id)).size !== 1) return null
  return best.vendor
}
