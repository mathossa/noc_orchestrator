import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'

/**
 * Site discovery fallback for a single Classic Central customer account.
 * Device monitoring may reveal a site even when /central/v2/sites returns
 * no entries. Aruba configuration groups are not physical sites.
 */
export function discoverSitesFromClassicDeviceEvidence(
  observations: readonly ClassicCentralDeviceObservation[],
) {
  const sites = new Map<string, { id: string | null; name: string; origin: 'DEVICE_EVIDENCE' }>()
  const groups = new Set<string>()
  let unassignedDeviceCount = 0

  for (const { raw } of observations) {
    const value = [raw.site, raw.site_name, raw.siteName]
      .find(item => typeof item === 'string' && item.trim())
    if (typeof value !== 'string') {
      unassignedDeviceCount += 1
    } else {
      const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
      const key = name.toLocaleLowerCase('en-US')
      if (!sites.has(key)) {
        const id = raw.site_id ?? raw.siteId
        sites.set(key, {
          id: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
          name, origin: 'DEVICE_EVIDENCE',
        })
      }
    }
    const group = [raw.group_name, raw.group, raw.ap_group, raw.device_group]
      .find(item => typeof item === 'string' && item.trim())
    if (typeof group === 'string') groups.add(group.normalize('NFKC').trim())
  }

  return {
    sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
    observedDeviceCount: observations.length,
    unassignedDeviceCount,
    observedGroupCount: groups.size,
  }
}
