'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'

type NetworkScope = { enabled?: boolean; networkId: string; networkName?: string | null; site?: string | null }
type OrganizationScope = { enabled?: boolean; networksDiscovered?: boolean; organizationId: string; organizationName?: string | null; customer?: string | null; businessUnit?: string | null; networks: readonly NetworkScope[] }
type Connection = {
  id: string; name: string; enabled: boolean; provider: string; adapterType: string; sourceAdapterId: string
  configuration: { version: 1; environment: string; organizations: readonly OrganizationScope[] }
  credentialsConfigured: boolean
  connectionTest: { status: 'UNTESTED' | 'SUCCESS' | 'FAILED'; testedAt: string | null; httpStatus: number | null }
  createdAt: string; updatedAt: string
}
type OrgEditor = { enabled: boolean; networksDiscovered: boolean; organizationId: string; organizationName: string; customer: string; businessUnit: string; networks: Array<{ enabled: boolean; networkId: string; networkName: string; site: string }> }
type DiscoveredOrganization = { id: string; name: string; url: string | null }
type ScheduleStatus = { enabled: boolean; expression: string | null; timezone: string | null; nextRunAt: string | null; lastJobId: string | null }
type SyncRun = { id: string; trigger: string; status: string; batchId: string | null; fetchedCount: number; stagedCount: number; autoPublishedCount: number; reviewRequiredCount: number; ignoredCount: number; errorCount: number; errorMessage: string | null; startedAt: string; finishedAt: string | null }
type DiscoveredNetwork = { id: string; organizationId: string; name: string; productTypes: string[]; tags: string[]; timeZone: string | null }
const editor = (scope?: OrganizationScope): OrgEditor => ({
  enabled: scope?.enabled !== false, networksDiscovered: scope?.networksDiscovered === true,
  organizationId: scope?.organizationId ?? '', organizationName: scope?.organizationName ?? '',
  customer: scope?.customer ?? '', businessUnit: scope?.businessUnit ?? '',
  networks: (scope?.networks ?? []).map((n) => ({ enabled: n.enabled !== false, networkId: n.networkId, networkName: n.networkName ?? '', site: n.site ?? '' })),
})
async function responseData(response: Response) {
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message ?? 'Request failed.')
  return body.data
}
export function MerakiConnectionManager({ initialConnection, initialSyncRuns }: { initialConnection: Connection; initialSyncRuns: SyncRun[] }) {
  const router = useRouter()
  const [connection, setConnection] = useState(initialConnection)
  const [name, setName] = useState(connection.name)
  const [environment, setEnvironment] = useState(connection.configuration.environment)
  const [apiKey, setApiKey] = useState('')
  const [organizations, setOrganizations] = useState<OrgEditor[]>(connection.configuration.organizations.map(editor))
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [syncRuns, setSyncRuns] = useState(initialSyncRuns)
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null)
  const [scheduleExpression, setScheduleExpression] = useState('0 3 * * *')
  const [scheduleTimezone, setScheduleTimezone] = useState('Europe/Amsterdam')

  useEffect(() => {
    let active = true
    void fetch(`/api/v1/inventory-sources/meraki/${connection.id}/schedule`)
      .then(responseData)
      .then((value: ScheduleStatus) => {
        if (!active) return
        setSchedule(value)
        if (value.expression) setScheduleExpression(value.expression)
        if (value.timezone) setScheduleTimezone(value.timezone)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [connection.id])

  const saveSchedule = async (enabled: boolean) => {
    setBusy('schedule'); setMessage(null)
    try {
      const response = await fetch(`/api/v1/inventory-sources/meraki/${connection.id}/schedule`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          expression: scheduleExpression,
          timezone: scheduleTimezone,
        }),
      })
      const next = await responseData(response) as ScheduleStatus
      setSchedule(next)
      setMessage(enabled ? 'Inventory sync schedule saved.' : 'Inventory sync schedule disabled.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update sync schedule.')
    } finally { setBusy(null) }
  }

  const save = async () => {
    setBusy('save'); setMessage(null)
    try {
      const response = await fetch(`/api/v1/inventory-sources/meraki/${connection.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, environment, organizations, ...(apiKey.trim() ? { apiKey } : {}) }),
      })
      const next = await responseData(response) as Connection
      setConnection(next); setOrganizations(next.configuration.organizations.map(editor)); setApiKey('')
      setMessage('Meraki connection settings saved.'); router.refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save connection.') }
    finally { setBusy(null) }
  }
  const test = async () => {
    setBusy('test'); setMessage(null)
    try {
      const response = await fetch(`/api/v1/inventory-sources/meraki/${connection.id}/test`, { method: 'POST' })
      const result = await responseData(response)
      setConnection((c) => ({ ...c, connectionTest: { status: 'SUCCESS', testedAt: new Date().toISOString(), httpStatus: null } }))
      setMessage(`Meraki connection test succeeded. ${result.organizationCount.toLocaleString()} organization${result.organizationCount === 1 ? '' : 's'} accessible.`)
      router.refresh()
    } catch (error) {
      setConnection((c) => ({ ...c, connectionTest: { ...c.connectionTest, status: 'FAILED', testedAt: new Date().toISOString() } }))
      setMessage(error instanceof Error ? error.message : 'Meraki connection test failed.')
    } finally { setBusy(null) }
  }
  const toggle = async (enabled: boolean) => {
    setBusy('enable'); setMessage(null)
    try {
      const response = await fetch(`/api/v1/inventory-sources/meraki/${connection.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) })
      const next = await responseData(response) as Connection
      setConnection(next); setMessage(enabled ? 'Meraki synchronization enabled.' : 'Meraki synchronization disabled.'); router.refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update connection.') }
    finally { setBusy(null) }
  }
  const syncOrganizationsAndSites = async () => {
    setBusy('discovery'); setMessage(null)
    try {
      const discovered = await responseData(
        await fetch(`/api/v1/inventory-sources/meraki/${connection.id}/organizations`, { method: 'POST' }),
      ) as DiscoveredOrganization[]
      const networksByOrg = new Map<string, DiscoveredNetwork[]>()
      const failures: string[] = []
      // An inaccessible organization must not erase a previously saved scope.
      for (const org of discovered) {
        try {
          const networks = await responseData(await fetch(
            `/api/v1/inventory-sources/meraki/${connection.id}/networks`,
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: org.id }) },
          )) as DiscoveredNetwork[]
          networksByOrg.set(org.id, networks)
        } catch {
          failures.push(org.name)
        }
      }
      setOrganizations((current) => {
        const saved = new Map(current.map((org) => [org.organizationId, org]))
        return [
          ...current.filter((org) => !discovered.some((found) => found.id === org.organizationId)),
          ...discovered.map((org) => {
            const previous = saved.get(org.id)
            const networks = networksByOrg.get(org.id)
            if (!networks) {
              return previous ?? {
                enabled: false, networksDiscovered: true, organizationId: org.id,
                organizationName: org.name, customer: '', businessUnit: '', networks: [],
              }
            }
            return {
              enabled: previous?.enabled ?? false,
              networksDiscovered: true,
              organizationId: org.id, organizationName: org.name,
              customer: previous?.customer ?? '', businessUnit: previous?.businessUnit ?? '',
              networks: networks.map((network) => {
                const existing = previous?.networks.find((savedNetwork) => savedNetwork.networkId === network.id)
                return {
                  enabled: existing?.enabled ?? Boolean(previous && !previous.networksDiscovered && previous.networks.length === 0),
                  networkId: network.id, networkName: network.name,
                  site: existing?.site ?? '',
                }
              }),
            }
          }),
        ]
      })
      setMessage(
        `Discovered ${discovered.length} organizations and ${[...networksByOrg.values()].reduce((total, networks) => total + networks.length, 0)} networks. Review the switches and click Save settings to persist. ${failures.length ? `${failures.length} organization(s) could not list networks; previously saved scopes were preserved.` : ''}`,
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sync Meraki organizations and sites.')
    } finally { setBusy(null) }
  }
  const syncNow = async () => {
    setBusy('sync'); setMessage(null); setBatchId(null)
    try {
      const result = await responseData(await fetch(`/api/v1/inventory-sources/meraki/${connection.id}/sync`, { method: 'POST' }))
      const publication = result.autoPublication
      setBatchId(publication.reconciliationRequired ? result.batch.id : null)
      if (result.syncRun) setSyncRuns((current) => [{ ...result.syncRun, startedAt: new Date(result.syncRun.startedAt).toISOString(), finishedAt: result.syncRun.finishedAt ? new Date(result.syncRun.finishedAt).toISOString() : null }, ...current].slice(0, 20))
      setMessage(`Meraki sync staged ${result.source.deviceCount.toLocaleString()} devices; auto-published ${publication.publishedLogicalDeviceCount.toLocaleString()}; ${publication.remainingIncludedRows.toLocaleString()} rows need review.${result.source.partial ? ` ${result.source.failures.length} organization(s) failed, so this was a partial run.` : ''}${result.source.availabilityFailures?.length ? ` Availability unavailable for ${result.source.availabilityFailures.length} organization(s); their status is shown as Unknown.` : ''}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to synchronize Meraki inventory.') }
    finally { setBusy(null) }
  }
  const updateOrg = (organizationId: string, field: 'customer' | 'businessUnit', value: string) => setOrganizations((current) => current.map((org) => org.organizationId === organizationId ? { ...org, [field]: value } : org))
  const updateSite = (organizationId: string, networkId: string, site: string) => setOrganizations((current) => current.map((org) => org.organizationId === organizationId ? { ...org, networks: org.networks.map((n) => n.networkId === networkId ? { ...n, site } : n) } : org))
  const setOrganizationEnabled = (organizationId: string, enabled: boolean) => setOrganizations((current) => current.map((org) => org.organizationId === organizationId ? { ...org, enabled } : org))
  const setNetworkEnabled = (organizationId: string, networkId: string, enabled: boolean) => setOrganizations((current) => current.map((org) => org.organizationId === organizationId ? { ...org, networks: org.networks.map((network) => network.networkId === networkId ? { ...network, enabled } : network) } : org))
  const removeOrganization = (organizationId: string) => setOrganizations((current) => current.filter((org) => org.organizationId !== organizationId))
  const removeNetwork = (organizationId: string, networkId: string) => setOrganizations((current) => current.map((org) => org.organizationId === organizationId ? { ...org, networksDiscovered: true, networks: org.networks.filter((network) => network.networkId !== networkId) } : org))
  const tone = connection.connectionTest.status === 'SUCCESS' ? 'success' : connection.connectionTest.status === 'FAILED' ? 'danger' : 'neutral'

  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Connection</div><div className="mt-2"><StatusBadge tone={connection.enabled ? 'success' : 'neutral'}>{connection.enabled ? 'Enabled' : 'Disabled'}</StatusBadge></div></div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Connection test</div><div className="mt-2"><StatusBadge tone={tone}>{connection.connectionTest.status}</StatusBadge></div></div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Enabled organizations</div><div className="mt-1 text-2xl font-semibold">{connection.configuration.organizations.filter((org) => org.enabled !== false && (org.networks.length === 0 ? !org.networksDiscovered : org.networks.some((network) => network.enabled !== false))).length}</div></div>
    </div>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Connection settings</h2><p className="mt-1 text-sm text-[var(--muted)]">Changing environment or credential invalidates the previous test. Saved API keys are never loaded back into this form.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test connection'}</Button>
          <Button variant={connection.enabled ? 'secondary' : 'primary'} disabled={busy !== null || (!connection.enabled && connection.connectionTest.status !== 'SUCCESS')} onClick={() => void toggle(!connection.enabled)}>{busy === 'enable' ? 'Updating…' : connection.enabled ? 'Disable' : 'Enable'}</Button>
          <Button variant="primary" disabled={busy !== null || !connection.enabled || connection.connectionTest.status !== 'SUCCESS' || connection.configuration.organizations.length === 0} onClick={() => void syncNow()}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="font-semibold">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3" /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">API environment</span><select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"><option value="global">Global</option><option value="canada">Canada</option><option value="china">China</option><option value="india">India</option><option value="fedramp">FedRAMP</option></select></label>
        <label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Replace Dashboard API key</span><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Leave blank to keep current credential" autoComplete="new-password" className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono" /></label>
      </div>
    </section>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4"><div><h2 className="font-semibold">Organizations & sites</h2><p className="mt-1 text-sm text-[var(--muted)]">Saved locally. Enable only the locations you want to import; refresh from Meraki only when you choose.</p></div><Button disabled={busy !== null || connection.connectionTest.status !== 'SUCCESS'} onClick={() => void syncOrganizationsAndSites()}>{busy === 'discovery' ? 'Syncing organizations…' : 'Sync organizations & sites'}</Button></div>
      <div className="space-y-4 p-5">
        {organizations.length === 0 ? <p className="text-sm text-[var(--muted)]">No saved organizations. Select Sync organizations & sites to discover available locations.</p> : null}
        {organizations.map((org) => <div key={org.organizationId} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={org.enabled} onChange={(event) => setOrganizationEnabled(org.organizationId, event.target.checked)} aria-label={`Enable organization ${org.organizationName || org.organizationId}`} />
              <span><strong>{org.organizationName || org.organizationId}</strong><span className="ml-2 font-mono text-xs text-[var(--muted)]">{org.organizationId}</span></span>
            </label>
            <Button disabled={busy !== null} onClick={() => removeOrganization(org.organizationId)}>Remove organization</Button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs"><span className="font-semibold">Customer mapping</span><input value={org.customer} placeholder={org.organizationName || 'Canonical customer'} onChange={(event) => updateOrg(org.organizationId, 'customer', event.target.value)} className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm" /></label>
            <label className="space-y-1 text-xs"><span className="font-semibold">Business Unit (optional)</span><input value={org.businessUnit} onChange={(event) => updateOrg(org.organizationId, 'businessUnit', event.target.value)} className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm" /></label>
          </div>
          {org.networks.length > 0 ? <div className="mt-4 space-y-2">
            {org.networks.map((network) => <div key={network.networkId} className="grid gap-2 rounded-md border border-[var(--border)] p-3 md:grid-cols-[minmax(230px,1fr)_minmax(180px,1fr)_auto] md:items-center">
              <label className="flex items-center gap-3 text-xs"><input type="checkbox" checked={network.enabled} onChange={(event) => setNetworkEnabled(org.organizationId, network.networkId, event.target.checked)} aria-label={`Enable network ${network.networkName || network.networkId}`} /><span><strong>{network.networkName || network.networkId}</strong><span className="mt-1 block font-mono text-[var(--muted)]">{network.networkId}</span></span></label>
              <label className="space-y-1 text-xs"><span className="font-semibold">Site mapping</span><input value={network.site} placeholder={network.networkName || 'Canonical site'} onChange={(event) => updateSite(org.organizationId, network.networkId, event.target.value)} className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm" /></label>
              <Button disabled={busy !== null} onClick={() => removeNetwork(org.organizationId, network.networkId)}>Remove</Button>
            </div>)}
          </div> : <p className="mt-3 text-xs text-[var(--muted)]">{org.networksDiscovered ? 'No networks saved. This organization will not be synchronized.' : 'Legacy scope: all networks. Sync organizations & sites to select individual locations.'}</p>}
        </div>)}
        <div className="flex justify-end"><Button variant="primary" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save settings'}</Button></div>
      </div>
    </section>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Schedule</h2><p className="mt-1 text-sm text-[var(--muted)]">Scheduled syncs auto-publish safe changes and skip uncertain records without blocking the next run. Skipped records remain auditable; no scheduled job requires manual approval.</p></div>
        <StatusBadge tone={schedule?.enabled ? 'success' : 'neutral'}>{schedule?.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span className="font-semibold">Recurring expression</span><input value={scheduleExpression} onChange={(e) => setScheduleExpression(e.target.value)} placeholder="0 3 * * *" className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono" /></label>
        <label className="space-y-1 text-sm"><span className="font-semibold">Timezone</span><input value={scheduleTimezone} onChange={(e) => setScheduleTimezone(e.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono" /></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>Next run: {schedule?.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : '—'}</span>
        <div className="flex gap-2">
          {schedule?.enabled ? <Button disabled={busy !== null} onClick={() => void saveSchedule(false)}>Disable schedule</Button> : null}
          <Button variant="primary" disabled={busy !== null || !connection.enabled || connection.connectionTest.status !== 'SUCCESS'} onClick={() => void saveSchedule(true)}>{busy === 'schedule' ? 'Saving…' : 'Save schedule'}</Button>
        </div>
      </div>
    </section>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="font-semibold">Sync history</h2><p className="mt-1 text-sm text-[var(--muted)]">Durable manual/scheduled run records. Provider failures remain visible instead of being reported as a full success.</p></div>
      <div className="divide-y divide-[var(--border)]">
        {syncRuns.length === 0 ? <div className="px-5 py-6 text-sm text-[var(--muted)]">No sync runs yet.</div> : syncRuns.map((run) => <div key={run.id} className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[140px_110px_1fr_auto] md:items-center">
          <div><StatusBadge tone={run.status === 'SUCCEEDED' ? 'success' : run.status === 'FAILED' ? 'danger' : run.status === 'PARTIAL' ? 'warning' : 'info'}>{run.status}</StatusBadge></div>
          <div className="text-xs text-[var(--muted)]">{run.trigger}</div>
          <div><span className="font-semibold">{run.stagedCount}</span> staged · <span className="font-semibold">{run.autoPublishedCount}</span> published · <span className="font-semibold">{run.reviewRequiredCount}</span> {run.trigger === 'SCHEDULED' ? 'skipped (unattended)' : 'review'} · <span className="font-semibold">{run.errorCount}</span> errors{run.errorMessage ? <div className="mt-1 text-xs text-[var(--danger)]">{run.errorMessage}</div> : null}</div>
          <div className="text-xs text-[var(--muted)]">{new Date(run.startedAt).toLocaleString()}</div>
        </div>)}
      </div>
    </section>
    {message ? <div className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-4 py-3 text-sm">{message}{batchId ? <> <Link href={`/devices/import/${batchId}`} className="font-semibold text-[var(--accent-light)] hover:underline">Open reconciliation batch</Link></> : null}</div> : null}
    <div className="text-xs text-[var(--muted)]">Source adapter: <span className="font-mono">{connection.sourceAdapterId}</span></div>
  </div>
}
