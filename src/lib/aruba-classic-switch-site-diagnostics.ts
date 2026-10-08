import { randomUUID } from 'node:crypto'
import { listClassicCentralDevices } from '@/lib/aruba-classic-central-api-client'
import { getClassicCentralConnectionCredentials, classicCentralRefreshContext } from '@/lib/aruba-classic-integration-store'
import { filterClassicCentralDevicesBySelectedSites } from '@/lib/aruba-classic-site-scope'

function nonempty(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value === 'string') return value.normalize('NFKC').trim().replace(/\s+/g, ' ') || null
  return null
}
function siteName(record: Record<string, unknown>) {
  return nonempty(record.site_name) ?? nonempty(record.siteName) ?? nonempty(record.site)
}
function siteId(record: Record<string, unknown>) {
  return nonempty(record.site_id) ?? nonempty(record.siteId)
}

/**
 * Read-only. No staging, publication or scope changes occur in this diagnostic.
 *
 * Classic switch site evidence can differ from the site membership shown in
 * Central. Compare the API's switch.site / site_id with the explicitly saved
 * site scopes, and separately probe the documented ?site= switch-list filter.
 */
export async function diagnoseClassicCentralSwitchSites(
  sourceId: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  const {connection} = await getClassicCentralConnectionCredentials(sourceId)
  const configured = connection.configuration.sites
  const selected = configured.filter(site => site.enabled)
  if (selected.length === 0) {
    throw new Error('Save at least one enabled Classic Central site before running diagnostics.')
  }
  const read = async (site?: string) => {
    // Each request may rotate its refresh token on 401. Reloading the saved
    // encrypted credentials avoids retrying a stale token from a prior page.
    const { connection: refreshed, credentials } =
      await getClassicCentralConnectionCredentials(sourceId)
    return listClassicCentralDevices({
      configuration: refreshed.configuration,
      accessToken: credentials.accessToken,
      refresh: await classicCentralRefreshContext(sourceId, credentials),
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      switchSite: site,
    })
  }

  const baseline = await read()
  const switches = baseline.filter(row => row.kind === 'SWITCH')
  const initialScope = filterClassicCentralDevicesBySelectedSites(
    switches, configured,
  )
  const evidence = new Map<string, {
    siteName: string | null
    siteId: string | null
    count: number
    stackedCount: number
  }>()
  for (const observation of switches) {
    const name = siteName(observation.raw)
    const id = siteId(observation.raw)
    const key = JSON.stringify([name,id])
    const existing = evidence.get(key) ?? {
      siteName:name, siteId:id, count:0, stackedCount:0,
    }
    existing.count += 1
    if (nonempty(observation.raw.stack_id)) existing.stackedCount += 1
    evidence.set(key,existing)
  }
  const observedSerials = new Set(switches
    .flatMap(row => {
      const serial = nonempty(row.raw.serial)
      return serial ? [serial] : []
    }))

  // Fail-closed sanity check: a deliberately impossible physical site must
  // have no switches. If the provider ignores ?site=, do not trust site-query
  // results as evidence that any particular switch belongs to a selected site.
  const impossibleSite = 'noc-orchestrator-nonexistent-' + randomUUID()
  const negativeControl = await read(impossibleSite)
  const siteQueryHonored = negativeControl.length === 0

  const siteChecks: Array<{
    siteName: string
    siteId: string | null
    switchCount: number
    overlapWithUnfiltered: number
    missingSiteEvidenceCount: number
    contradictoryEvidenceCount: number
  }> = []

  if (siteQueryHonored) {
    for (const selectedSite of selected) {
      const apiRows = (await read(selectedSite.siteName)).filter(row => row.kind === 'SWITCH')
      const nameKey = selectedSite.siteName.toLocaleLowerCase('en-US')
      const overlaps = apiRows.filter(row => {
        const serial = nonempty(row.raw.serial)
        return Boolean(serial && observedSerials.has(serial))
      }).length
      const contradictory = apiRows.filter(row => {
        const name = siteName(row.raw)
        const id = siteId(row.raw)
        return (name !== null && name.toLocaleLowerCase('en-US') !== nameKey) ||
          (selectedSite.siteId && id && selectedSite.siteId !== id)
      }).length
      siteChecks.push({
        siteName:selectedSite.siteName,
        siteId:selectedSite.siteId ?? null,
        switchCount:apiRows.length,
        overlapWithUnfiltered:overlaps,
        missingSiteEvidenceCount:apiRows.filter(row =>
          !siteName(row.raw) && !siteId(row.raw)).length,
        contradictoryEvidenceCount:contradictory,
      })
    }
  }
  return {
    fetchedSwitchCount:switches.length,
    selectedByCurrentFilter:initialScope.devices.length,
    excludedByCurrentFilter:initialScope.excludedCount,
    missingSiteEvidenceCount:initialScope.withoutSiteCount,
    contradictoryEvidenceCount:initialScope.conflictedSiteCount,
    savedSelectedSites:selected.map(site => ({
      siteName:site.siteName,
      siteId:site.siteId ?? null,
    })),
    observedSwitchSites:[...evidence.values()]
      .sort((a,b)=>b.count-a.count)
      .slice(0,20),
    siteQueryHonored,
    siteChecks,
    note: 'Read-only: the diagnostic never stages, publishes or reassigns devices.',
  }
}
