const MAX_SITE_CODE_LENGTH = 40

export function suggestedImportSiteCode(sourceValue: string) {
  const code = sourceValue
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (code || 'SITE').slice(0, MAX_SITE_CODE_LENGTH).replace(/-+$/g, '') || 'SITE'
}

export function nextAvailableImportSiteCode(baseCode: string, usedCodes: Set<string>) {
  if (!usedCodes.has(baseCode)) return baseCode
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `-${suffix}`
    const prefix = baseCode
      .slice(0, Math.max(1, MAX_SITE_CODE_LENGTH - suffixText.length))
      .replace(/-+$/g, '')
    const candidate = `${prefix}${suffixText}`
    if (!usedCodes.has(candidate)) return candidate
  }
  throw new Error(`Could not generate a unique Site code for ${baseCode}.`)
}
