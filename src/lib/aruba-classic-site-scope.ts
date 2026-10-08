import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'

/** A Classic Central API connection is scoped to one customer. Only explicitly
 * enabled physical sites may enter Importer v2. Aruba groups are not sites.
 */
export type ClassicSelectedSite = {
  siteId?: string | null
  siteName: string
  site?: string | null
  enabled: boolean
}

function clean(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value !== 'string') return null
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}

function nameKey(value: unknown) {
  return clean(value)?.toLocaleLowerCase('en-US') ?? null
}

function observedSiteName(raw: Record<string, unknown>) {
  return clean(raw.site_name) ?? clean(raw.siteName) ?? clean(raw.site)
}

function observedSiteId(raw: Record<string, unknown>) {
  return clean(raw.site_id) ?? clean(raw.siteId)
}

export function filterClassicCentralDevicesBySelectedSites(
  observations: readonly ClassicCentralDeviceObservation[],
  configuredSites: readonly ClassicSelectedSite[],
) {
  const byName = new Map<string, ClassicSelectedSite>()
  const byId = new Map<string, ClassicSelectedSite>()
  for (const site of configuredSites) {
    const key = nameKey(site.siteName)
    if (!key || byName.has(key)) {
      throw new Error('Classic Central has a missing or duplicated site name.')
    }
    byName.set(key, site)
    const siteId = clean(site.siteId)
    if (siteId) {
      if (byId.has(siteId)) throw new Error('Classic Central has duplicate site IDs.')
      byId.set(siteId, site)
    }
  }

  const included: ClassicCentralDeviceObservation[] = []
  let excludedCount = 0
  let withoutSiteCount = 0
  let conflictedSiteCount = 0
  for (const observation of observations) {
    const name = observedSiteName(observation.raw)
    const id = observedSiteId(observation.raw)
    if (!id && !name) {
      withoutSiteCount += 1
      excludedCount += 1
      continue
    }
    const idMatch = id ? byId.get(id) : undefined
    const nameMatch = name ? byName.get(nameKey(name)!) : undefined

    // Never fall back to a name if a stable ID contradicts the saved ID.
    // Likewise, never let a disabled site's ID be overridden by a reused name.
    if (
      (idMatch && nameMatch && idMatch !== nameMatch) ||
      (id && nameMatch?.siteId && clean(nameMatch.siteId) !== id)
    ) {
      conflictedSiteCount += 1
      excludedCount += 1
      continue
    }
    const selected = idMatch ?? nameMatch
    if (!selected?.enabled) {
      excludedCount += 1
      continue
    }

    // Staging uses the selected site's canonical Central name and the explicit
    // per-customer NOC mapping. Keep the original vendor evidence intact.
    included.push({
      ...observation,
      raw: {
        ...observation.raw,
        site: selected.siteName,
        centralObservedSiteName: name,
        centralObservedSiteId: id,
      },
    })
  }

  return {
    devices: included,
    excludedCount,
    withoutSiteCount,
    conflictedSiteCount,
  }
}
