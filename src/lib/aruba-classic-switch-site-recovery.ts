import { randomUUID } from 'node:crypto'
import type { ClassicCentralDeviceObservation } from '@/lib/aruba-classic-central-api-client'
import type { ClassicSelectedSite } from '@/lib/aruba-classic-site-scope'

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value !== 'string') return null
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
}
function normalizedSerial(raw: Record<string, unknown>): string | null {
  const serial = text(raw.serial) ?? text(raw.serial_number) ?? text(raw.serialNumber)
  return serial?.toLocaleUpperCase('en-US') ?? null
}
function observedSite(raw: Record<string, unknown>) {
  return {
    name: text(raw.site_name) ?? text(raw.siteName) ?? text(raw.site),
    id: text(raw.site_id) ?? text(raw.siteId),
  }
}
function siteClaimMatches(
  selected: ClassicSelectedSite,
  row: ClassicCentralDeviceObservation,
): boolean {
  const found = observedSite(row.raw)
  const expectedName = text(selected.siteName)?.toLocaleLowerCase('en-US')
  const actualName = found.name?.toLocaleLowerCase('en-US')
  if (actualName && actualName !== expectedName) return false
  if (found.id && selected.siteId && found.id !== text(selected.siteId)) return false
  // No site fields in the filtered response is precisely why this fallback
  // exists. Membership is asserted by the verified server-side site query.
  return true
}

export type ClassicSwitchSiteRecovery = {
  observations: ClassicCentralDeviceObservation[]
  attempted: boolean
  serverFilterVerified: boolean
  recoveredSwitchCount: number
  ambiguousSwitchCount: number
  queriedSiteCount: number
  unmatchedQueryRowCount: number
}

/**
 * Recover missing Classic switch-site fields using independent provider site
 * membership assertions, after verifying the ?site= filter with a negative
 * control. The only candidates are switches with a UNIQUE durable serial in
 * the unfiltered snapshot. Never fabricate an observation from a filtered
 * request or overwrite contradictory site evidence.
 */
export async function recoverClassicSwitchSitesFromVerifiedQueries(input: {
  observations: readonly ClassicCentralDeviceObservation[]
  selectedSites: readonly ClassicSelectedSite[]
  readSwitchesForSite: (siteName: string) => Promise<readonly ClassicCentralDeviceObservation[]>
  impossibleSiteName?: string
}): Promise<ClassicSwitchSiteRecovery> {
  const observations = [...input.observations]
  const eligible = new Map<string, number[]>()
  const allSerialCounts = new Map<string, number>()
  for (const observation of observations) {
    if (observation.kind !== 'SWITCH') continue
    const serial = normalizedSerial(observation.raw)
    if (!serial) continue
    allSerialCounts.set(serial, (allSerialCounts.get(serial) ?? 0) + 1)
  }
  for (const [index, observation] of observations.entries()) {
    if (observation.kind !== 'SWITCH') continue
    const { name, id } = observedSite(observation.raw)
    const serial = normalizedSerial(observation.raw)
    if (name || id || !serial || allSerialCounts.get(serial) !== 1) continue
    eligible.set(serial, [index])
  }
  const selected = input.selectedSites.filter(site => site.enabled)
  if (eligible.size === 0 || selected.length === 0) {
    return {
      observations, attempted:false, serverFilterVerified:false,
      recoveredSwitchCount:0, ambiguousSwitchCount:0,
      queriedSiteCount:0, unmatchedQueryRowCount:0,
    }
  }

  const impossibleSite = input.impossibleSiteName ??
    `noc-orchestrator-nonexistent-${randomUUID()}`
  const negativeControl = await input.readSwitchesForSite(impossibleSite)
  if (negativeControl.length !== 0) {
    // Some deployments silently ignore unsupported query parameters. Never
    // use a filter whose negative-control check does not pass.
    return {
      observations, attempted:true, serverFilterVerified:false,
      recoveredSwitchCount:0, ambiguousSwitchCount:0,
      queriedSiteCount:0, unmatchedQueryRowCount:0,
    }
  }

  const claims = new Map<string, ClassicSelectedSite[]>()
  const rejected = new Set<string>()
  let unmatchedQueryRowCount = 0
  for (const site of selected) {
    const rows = await input.readSwitchesForSite(site.siteName)
    const seenInSite = new Set<string>()
    for (const row of rows) {
      if (row.kind !== 'SWITCH') {
        unmatchedQueryRowCount += 1
        continue
      }
      const serial = normalizedSerial(row.raw)
      if (!serial || !eligible.has(serial)) {
        unmatchedQueryRowCount += 1
        continue
      }
      if (!siteClaimMatches(site,row) || seenInSite.has(serial)) {
        rejected.add(serial)
        continue
      }
      seenInSite.add(serial)
      claims.set(serial, [...(claims.get(serial) ?? []), site])
    }
  }

  let recoveredSwitchCount = 0
  let ambiguousSwitchCount = 0
  for (const [serial, siteClaims] of claims) {
    if (rejected.has(serial) || siteClaims.length !== 1) {
      ambiguousSwitchCount += 1
      continue
    }
    const index = eligible.get(serial)?.[0]
    if (index === undefined) continue
    const site = siteClaims[0]
    const baseline = observations[index]
    observations[index] = {
      ...baseline,
      raw: {
        ...baseline.raw,
        // Site assignment is asserted by a verified Central API query; do
        // not claim these fields originated in the unfiltered inventory.
        site: site.siteName,
        ...(site.siteId ? {site_id: site.siteId} : {}),
        centralSiteEvidenceSource: 'VERIFIED_CLASSIC_SWITCH_SITE_QUERY',
        centralSiteQueryName: site.siteName,
        centralSiteQueryId: site.siteId ?? null,
        centralOriginalSiteName: null,
        centralOriginalSiteId: null,
      },
    }
    recoveredSwitchCount += 1
  }
  // A rejected serial absent from claims may still be ambiguous.
  ambiguousSwitchCount += [...rejected].filter(serial => !claims.has(serial)).length
  return {
    observations, attempted:true, serverFilterVerified:true,
    recoveredSwitchCount, ambiguousSwitchCount,
    queriedSiteCount:selected.length, unmatchedQueryRowCount,
  }
}
