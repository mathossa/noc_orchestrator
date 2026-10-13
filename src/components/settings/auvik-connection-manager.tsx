'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { AuvikMappingInput, type AuvikLookupField, type AuvikLookupOption } from '@/components/settings/auvik-mapping-input'
import { InventorySourceSchedulePanel, type InventorySourceSyncRun } from '@/components/settings/inventory-source-schedule-panel'

type Connection = {
  id: string
  name: string
  enabled: boolean
  provider: string
  adapterType: string
  sourceAdapterId: string
  configuration: {
    version: 1
    region: string
    tenants: readonly {
      tenantId: string
      enabled?: boolean
      tenantName?: string | null
      tenantType?: string | null
      domainPrefix?: string | null
      customer?: string | null
      businessUnit?: string | null
      site?: string | null
    }[]
  }
  credentialsConfigured: boolean
  connectionTest: {
    status: 'UNTESTED' | 'SUCCESS' | 'FAILED'
    testedAt: string | null
    httpStatus: number | null
    suggestedRegion: string | null
  }
  createdAt: string
  updatedAt: string
}

type DiscoveredTenant = {
  id: string
  domainPrefix: string
  tenantType: string | null
  displayName: string | null
  siteName: string | null
  parentTenantId: string | null
  mappingStatus: 'REUSED' | 'MATCHED' | 'PROPOSED' | 'REVIEW' | 'CONFLICT'
  proposal: { customer: string; businessUnit: string | null; site: string; parentTenantId: string | null } | null
  suggestion: {
    customer: string
    businessUnit: string | null
    site: string | null
    status: 'CUSTOMER' | 'CUSTOMER_AND_SITE' | 'REUSED'
  } | null
}

type TenantEditor = {
  enabled: boolean
  tenantId: string
  tenantName: string
  customer: string
  businessUnit: string
  site: string
  tenantType: string
  domainPrefix: string
  mappingStatus: 'REUSED' | 'MATCHED' | 'PROPOSED' | 'REVIEW' | 'CONFLICT' | 'MANUAL'
}

function editorTenant(
  tenant?: Connection['configuration']['tenants'][number],
): TenantEditor {
  return {
    enabled: tenant?.enabled !== false,
    tenantId: tenant?.tenantId ?? '',
    tenantName: tenant?.tenantName ?? '',
    customer: tenant?.customer ?? '',
    businessUnit: tenant?.businessUnit ?? '',
    site: tenant?.site ?? '',
    tenantType: tenant?.tenantType ?? '',
    domainPrefix: tenant?.domainPrefix ?? '',
    mappingStatus: tenant?.customer && tenant?.site ? 'MANUAL' : 'REVIEW',
  }
}

async function responseData(response: Response) {
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Request failed.')
  }
  return body.data
}

export function AuvikConnectionManager({
  initialConnection,
  initialSyncRuns,
  initialExistingTenantIds = [],
}: {
  initialConnection: Connection
  initialSyncRuns: InventorySourceSyncRun[]
  initialExistingTenantIds?: readonly string[]
}) {
  const router = useRouter()
  const [connection, setConnection] = useState(initialConnection)
  const [name, setName] = useState(connection.name)
  const [region, setRegion] = useState(connection.configuration.region)
  const [tenants, setTenants] = useState<TenantEditor[]>(
    connection.configuration.tenants.map((scope) => ({
      ...editorTenant(scope),
      mappingStatus: initialExistingTenantIds.includes(scope.tenantId)
        ? 'MATCHED' as const
        : editorTenant(scope).mappingStatus,
    })),
  )
  const [tenantSearch, setTenantSearch] = useState('')
  const [tenantFilter, setTenantFilter] = useState<'ALL' | 'UNMAPPED' | 'PROPOSED' | 'MATCHED' | 'REUSED' | 'CONFLICT' | 'MANUAL' | 'ENABLED'>('ALL')
  const [tenantPage, setTenantPage] = useState(1)
  const tenantPageSize = 50
  const [username, setUsername] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [syncRuns, setSyncRuns] = useState<InventorySourceSyncRun[]>(initialSyncRuns)

  const updateTenant = (
    index: number,
    field: keyof TenantEditor,
    value: string,
  ) => {
    setTenants((current) =>
      current.map((tenant, tenantIndex) =>
        tenantIndex === index ? {
          ...tenant, [field]: value,
          ...(field === 'customer' || field === 'businessUnit' || field === 'site'
            ? { mappingStatus: 'MANUAL' as const } : {}),
        } : tenant,
      ),
    )
  }

  const selectExistingMapping = (index: number, field: AuvikLookupField, option: AuvikLookupOption) => {
    setTenants((current) => current.map((tenant, position) => {
      if (position !== index) return tenant
      if (field === 'customer') return {
        ...tenant, customer: option.customerName, mappingStatus: 'MANUAL' as const,
      }
      if (field === 'businessUnit') return {
        ...tenant, businessUnit: option.name, mappingStatus: 'MANUAL' as const,
      }
      // Never change an existing customer implicitly. A site under a different
      // customer must be selected explicitly after correcting Customer.
      if (option.relation !== 'SAME_CUSTOMER') return tenant
      return {
        ...tenant,
        customer: option.customerName,
        businessUnit: option.businessUnit ?? '',
        site: option.name,
        mappingStatus: 'MATCHED' as const,
      }
    }))
  }

  const save = async () => {
    setBusy('save')
    setMessage(null)
    setBatchId(null)
    try {
      const credentials =
        username.trim() || apiKey.trim()
          ? { username, apiKey }
          : {}
      const response = await fetch(
        `/api/v1/inventory-sources/auvik/${connection.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            region,
            tenants: tenants.filter((tenant) => tenant.tenantId.trim()).map((tenant) => ({
              enabled: tenant.enabled,
              tenantId: tenant.tenantId,
              tenantName: tenant.tenantName,
              tenantType: tenant.tenantType,
              domainPrefix: tenant.domainPrefix,
              customer: tenant.customer,
              businessUnit: tenant.businessUnit,
              site: tenant.site,
            })),
            ...credentials,
          }),
        },
      )
      const updated = (await responseData(response)) as Connection
      setConnection(updated)
      setName(updated.name)
      setRegion(updated.configuration.region)
      setTenants((current) => updated.configuration.tenants.map((saved) => ({
        ...editorTenant(saved),
        tenantType: current.find((item) => item.tenantId === saved.tenantId)?.tenantType ?? '',
        domainPrefix: current.find((item) => item.tenantId === saved.tenantId)?.domainPrefix ?? '',
        mappingStatus: current.find((item) => item.tenantId === saved.tenantId)?.mappingStatus ?? 'MANUAL',
      })))
      setUsername('')
      setApiKey('')
      setMessage('Connection settings saved.')
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save connection.',
      )
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async () => {
    setBusy('test')
    setMessage(null)
    setBatchId(null)
    try {
      const response = await fetch(
        `/api/v1/inventory-sources/auvik/${connection.id}/test`,
        { method: 'POST' },
      )
      const result = await responseData(response)
      if (result.ok) {
        setConnection((current) => ({
          ...current,
          connectionTest: {
            status: 'SUCCESS',
            testedAt: new Date().toISOString(),
            httpStatus: null,
            suggestedRegion: null,
          },
        }))
        setMessage('Auvik connection test succeeded.')
      } else {
        setConnection((current) => ({
          ...current,
          connectionTest: {
            status: 'FAILED',
            testedAt: new Date().toISOString(),
            httpStatus: result.status ?? null,
            suggestedRegion: result.suggestedRegion ?? null,
          },
        }))
        setMessage(
          result.suggestedRegion
            ? `Auvik reports region “${result.suggestedRegion}”. Save that region and test again.`
            : result.error ?? 'Auvik connection test failed.',
        )
      }
      router.refresh()
    } catch (error) {
      setConnection((current) => ({
        ...current,
        connectionTest: {
          ...current.connectionTest,
          status: 'FAILED',
          testedAt: new Date().toISOString(),
        },
      }))
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to test Auvik connection.',
      )
    } finally {
      setBusy(null)
    }
  }

  const setEnabled = async (enabled: boolean) => {
    setBusy('enable')
    setMessage(null)
    try {
      const response = await fetch(
        `/api/v1/inventory-sources/auvik/${connection.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      )
      const updated = (await responseData(response)) as Connection
      setConnection(updated)
      setMessage(enabled ? 'Auvik synchronization enabled.' : 'Auvik synchronization disabled.')
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to update connection.',
      )
    } finally {
      setBusy(null)
    }
  }

  const syncTenantsAndSites = async () => {
    setBusy('discover')
    setMessage(null)
    try {
      const response = await fetch(
        `/api/v1/inventory-sources/auvik/${connection.id}/tenants`,
        { method: 'POST' },
      )
      const discovered = (await responseData(response)) as DiscoveredTenant[]
      setTenantPage(1)
      setTenants((current) => {
        const existing = new Map(current.filter((tenant) => tenant.tenantId).map((tenant) => [tenant.tenantId, tenant]))
        const discoveredIds = new Set(discovered.map((tenant) => tenant.id))
        return [
          // Keep scopes that have disappeared from the API response: a temporary
          // permission change must not silently delete a confirmed mapping.
          ...current.filter((tenant) => tenant.tenantId && !discoveredIds.has(tenant.tenantId)),
          ...discovered.map((tenant) => {
            const saved = existing.get(tenant.id)
            const display = tenant.displayName || tenant.domainPrefix || tenant.id
            const suggestion = tenant.suggestion
            if (saved) {
              const hasMapping = Boolean(saved.customer.trim())
              const proposed = suggestion ?? tenant.proposal
              const cleanKey = (value: string | null | undefined) => (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
              const matchesProposal = proposed && cleanKey(saved.customer) === cleanKey(proposed.customer)
                && cleanKey(saved.site) === cleanKey(proposed.site)
                && cleanKey(saved.businessUnit) === cleanKey(proposed.businessUnit)
              return {
                ...saved,
                tenantType: tenant.tenantType ?? '',
                domainPrefix: tenant.domainPrefix,
                mappingStatus: tenant.mappingStatus === 'CONFLICT' ? 'CONFLICT' as const
                  : hasMapping && !matchesProposal ? 'MANUAL' as const : tenant.mappingStatus,
                customer: hasMapping ? saved.customer : (proposed?.customer ?? ''),
                businessUnit: hasMapping ? saved.businessUnit : (proposed?.businessUnit ?? ''),
                site: hasMapping ? saved.site : (proposed?.site ?? ''),
                // Preserve manual naming and canonical corrections.
                tenantName: tenant.displayName && (!saved.tenantName || saved.tenantName === saved.domainPrefix || saved.tenantName === tenant.domainPrefix)
                  ? tenant.displayName
                  : saved.tenantName,
              }
            }
            return {
              ...editorTenant({
                tenantId: tenant.id,
                tenantName: display,
                enabled: false,
                customer: (suggestion ?? tenant.proposal)?.customer ?? null,
                businessUnit: (suggestion ?? tenant.proposal)?.businessUnit ?? null,
                site: (suggestion ?? tenant.proposal)?.site ?? null,
              }),
              tenantType: tenant.tenantType ?? '',
              domainPrefix: tenant.domainPrefix,
              mappingStatus: tenant.mappingStatus,
            }
          }),
        ]
      })
      const named = discovered.filter((tenant) => Boolean(tenant.displayName)).length
      const reused = discovered.filter((tenant) => tenant.mappingStatus === 'REUSED').length
      setMessage(`Discovered ${discovered.length} Auvik tenants; ${named} have display names, ${reused} reuse another Auvik connection. New tenants start disabled. Review proposals, select sites in bulk and save before syncing.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sync Auvik tenants.')
    } finally {
      setBusy(null)
    }
  }

  const syncNow = async () => {
    setBusy('sync')
    setMessage(null)
    setBatchId(null)
    try {
      const response = await fetch(
        `/api/v1/inventory-sources/auvik/${connection.id}/sync`,
        { method: 'POST' },
      )
      const result = await responseData(response)
      if (result.syncRun) {
        setSyncRuns((current) => [
          { ...result.syncRun, startedAt: new Date(result.syncRun.startedAt).toISOString(), finishedAt: result.syncRun.finishedAt ? new Date(result.syncRun.finishedAt).toISOString() : null },
          ...current,
        ].slice(0, 20))
      }
      const autoPublication = result.autoPublication as {
        status: 'PUBLISHED' | 'REVIEW_REQUIRED' | 'NOTHING_TO_PUBLISH'
        publishedLogicalDeviceCount: number
        remainingIncludedRows: number
        reconciliationRequired: boolean
        error: string | null
      }
      setBatchId(
        autoPublication.reconciliationRequired ? result.batch.id : null,
      )

      const staged =
        `Auvik sync staged ${result.source.deviceCount.toLocaleString()} devices from ${result.source.tenantCount.toLocaleString()} tenant${result.source.tenantCount === 1 ? '' : 's'}.`
      const partialNotice = result.source.partial
        ? ` ${result.source.failures.length} tenant(s) failed; successful tenant data was staged as a partial export.`
        : ''
      if (autoPublication.status === 'PUBLISHED') {
        const published =
          ` Auto-published ${autoPublication.publishedLogicalDeviceCount.toLocaleString()} valid device${autoPublication.publishedLogicalDeviceCount === 1 ? '' : 's'}.`
        const review = autoPublication.reconciliationRequired
          ? ` ${autoPublication.remainingIncludedRows.toLocaleString()} device row${autoPublication.remainingIncludedRows === 1 ? '' : 's'} still need reconciliation.`
          : ' No reconciliation is required.'
        setMessage(staged + published + review + partialNotice)
      } else if (autoPublication.reconciliationRequired) {
        setMessage(
          staged +
            ` ${autoPublication.remainingIncludedRows.toLocaleString()} device row${autoPublication.remainingIncludedRows === 1 ? '' : 's'} need reconciliation.` +
            (autoPublication.error
              ? ` Automatic publication paused: ${autoPublication.error}`
              : '') + partialNotice,
        )
      } else {
        setMessage(staged + ' Nothing required reconciliation or publication.' + partialNotice)
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to synchronize Auvik.',
      )
    } finally {
      setBusy(null)
    }
  }

  const hasEnabledScope = connection.configuration.tenants.some((tenant) => tenant.enabled !== false)
  const search = tenantSearch.normalize('NFKC').trim().toLocaleLowerCase('en-US')
  const visibleTenants = tenants.map((tenant, index) => ({ tenant, index })).filter(({ tenant }) => {
    const matchesFilter = tenantFilter === 'ALL' ||
      (tenantFilter === 'UNMAPPED' && tenant.mappingStatus !== 'MATCHED' && tenant.mappingStatus !== 'REUSED') ||
      (tenantFilter === 'PROPOSED' && tenant.mappingStatus === 'PROPOSED') ||
      (tenantFilter === 'MATCHED' && (tenant.mappingStatus === 'MATCHED' || tenant.mappingStatus === 'REUSED')) ||
      (tenantFilter === 'REUSED' && tenant.mappingStatus === 'REUSED') ||
      (tenantFilter === 'CONFLICT' && tenant.mappingStatus === 'CONFLICT') ||
      (tenantFilter === 'MANUAL' && tenant.mappingStatus === 'MANUAL') ||
      (tenantFilter === 'ENABLED' && tenant.enabled)
    if (!matchesFilter) return false
    return !search || [tenant.tenantName, tenant.domainPrefix, tenant.tenantId, tenant.customer, tenant.businessUnit, tenant.site]
      .some((value) => value.toLocaleLowerCase('en-US').includes(search))
  })
  const totalPages = Math.max(1, Math.ceil(visibleTenants.length / tenantPageSize))
  const page = Math.min(tenantPage, totalPages)
  const pageTenants = visibleTenants.slice((page - 1) * tenantPageSize, page * tenantPageSize)
  const enabledCount = tenants.filter((tenant) => tenant.enabled && tenant.tenantId).length
  const mappedCount = tenants.filter((tenant) => tenant.mappingStatus === 'MATCHED' || tenant.mappingStatus === 'REUSED').length
  const proposedCount = tenants.filter((tenant) => tenant.mappingStatus === 'PROPOSED').length
  const needsReviewCount = tenants.filter((tenant) => tenant.tenantId &&
    tenant.mappingStatus !== 'MATCHED' && tenant.mappingStatus !== 'REUSED').length
  const reusedCount = tenants.filter((tenant) => tenant.mappingStatus === 'REUSED').length
  const conflictCount = tenants.filter((tenant) => tenant.mappingStatus === 'CONFLICT').length
  const filterCounts: Record<typeof tenantFilter, number> = {
    ALL: tenants.filter((tenant) => tenant.tenantId).length,
    UNMAPPED: needsReviewCount,
    PROPOSED: proposedCount,
    MATCHED: mappedCount,
    REUSED: reusedCount,
    CONFLICT: conflictCount,
    MANUAL: tenants.filter((tenant) => tenant.mappingStatus === 'MANUAL').length,
    ENABLED: enabledCount,
  }
  const selectTenantFilter = (value: typeof tenantFilter) => {
    setTenantFilter(value)
    setTenantPage(1)
  }
  const bulkEnableVisible = (enabled: boolean) => {
    const indices = new Set(visibleTenants.map(({ index }) => index))
    setTenants((current) => current.map((tenant, index) => indices.has(index) && tenant.tenantId
      // Auvik multi-client parents should not be bulk-enabled; users can enable
      // an individual parent scope explicitly if their Auvik setup requires it.
      && ( !enabled || !/multi/i.test(tenant.tenantType))
        ? { ...tenant, enabled }
        : tenant))
  }

  const testTone =
    connection.connectionTest.status === 'SUCCESS'
      ? 'success'
      : connection.connectionTest.status === 'FAILED'
        ? 'danger'
        : 'neutral'

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Connection</div>
          <div className="mt-2">
            <StatusBadge tone={connection.enabled ? 'success' : 'neutral'}>
              {connection.enabled ? 'Enabled' : 'Disabled'}
            </StatusBadge>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Connection test</div>
          <div className="mt-2">
            <StatusBadge tone={testTone}>
              {connection.connectionTest.status}
            </StatusBadge>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Enabled tenants</div>
          <div className="mt-1 text-2xl font-semibold">
            {connection.configuration.tenants.filter((tenant) => tenant.enabled !== false).length}
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Connection settings</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Changing region or credentials invalidates the previous connection
              test. Saved credentials are never loaded back into this form.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy !== null} onClick={() => void testConnection()}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </Button>
            <Button
              variant={connection.enabled ? 'secondary' : 'primary'}
              disabled={
                busy !== null ||
                (!connection.enabled &&
                  connection.connectionTest.status !== 'SUCCESS')
              }
              onClick={() => void setEnabled(!connection.enabled)}
            >
              {busy === 'enable'
                ? 'Updating…'
                : connection.enabled
                  ? 'Disable'
                  : 'Enable'}
            </Button>
            <Button
              variant="primary"
              disabled={
                busy !== null ||
                !connection.enabled ||
                connection.connectionTest.status !== 'SUCCESS' ||
                !hasEnabledScope
              }
              onClick={() => void syncNow()}
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        </div>

        {connection.connectionTest.suggestedRegion ? (
          <div className="mt-4 rounded-md border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-sm">
            Auvik redirected this account to region{' '}
            <strong>{connection.connectionTest.suggestedRegion}</strong>. Update
            the region below and test the connection again.
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Region</span>
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Replace username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Leave blank to keep current credentials"
              autoComplete="username"
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Replace API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Leave blank to keep current credentials"
              autoComplete="new-password"
              className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="font-semibold">Auvik tenants &amp; site mappings</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Discover accessible tenants, review suggested canonical mappings and enable sites in bulk.
              Changes are applied only after Save settings. Missing or ambiguous matches stay for review in Importer v2.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null || connection.connectionTest.status !== 'SUCCESS'}
              onClick={() => void syncTenantsAndSites()}
            >
              {busy === 'discover' ? 'Discovering…' : 'Discover tenants'}
            </Button>
            <Button onClick={() => setTenants((current) => [...current, editorTenant()])} disabled={busy !== null}>
              Add manually
            </Button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span><strong>{tenants.filter((tenant) => tenant.tenantId).length}</strong> discovered/configured</span>
            <span><strong>{enabledCount}</strong> enabled</span>
            <span><strong>{mappedCount}</strong> matched/reused</span>
            <span><strong>{proposedCount}</strong> proposed</span>
            <span><strong>{needsReviewCount}</strong> unmapped</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="Search Auvik tenants"
              placeholder="Search customer, site or tenant ID"
              value={tenantSearch}
              onChange={(event) => { setTenantSearch(event.target.value); setTenantPage(1) }}
              className="h-10 min-w-60 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm"
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter Auvik tenants by mapping status">
              {([
                ['ALL', 'All'], ['UNMAPPED', 'Unmapped'], ['PROPOSED', 'Proposed'],
                ['MATCHED', 'Existing'], ['REUSED', 'Reused'], ['CONFLICT', 'Conflicts'],
                ['MANUAL', 'Manual'], ['ENABLED', 'Enabled'],
              ] as const).map(([status, label]) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={tenantFilter === status}
                  onClick={() => selectTenantFilter(status)}
                  className={`rounded-md border px-2.5 py-2 text-xs transition-colors ${tenantFilter === status
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold'
                    : 'border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)]'}`}
                >
                  {label} <span className="tabular-nums text-[var(--muted)]">{filterCounts[status]}</span>
                </button>
              ))}
            </div>
            <Button disabled={busy !== null || visibleTenants.length === 0} onClick={() => bulkEnableVisible(true)}>
              Enable visible sites
            </Button>
            <Button disabled={busy !== null || visibleTenants.length === 0} onClick={() => bulkEnableVisible(false)}>
              Disable visible
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Bulk actions affect all filtered rows across all pages and exclude multi-client parents when enabling. 
            A mapping suggestion is not a confirmed device match. Unnamed tenants show their domain prefix or ID.
          </p>
          <div className="overflow-x-auto rounded-md border border-[var(--border)]">
            <table className="w-full min-w-[940px] border-collapse text-left text-sm">
              <thead className="bg-[var(--surface-raised)] text-xs text-[var(--muted-strong)]">
                <tr>
                  <th className="p-3 font-semibold">Sync</th>
                  <th className="p-3 font-semibold">Auvik tenant</th>
                  <th className="p-3 font-semibold">Customer</th>
                  <th className="p-3 font-semibold">Business Unit</th>
                  <th className="p-3 font-semibold">Site</th>
                  <th className="p-3 font-semibold">Mapping</th>
                  <th className="p-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageTenants.map(({ tenant, index }) => (
                  <tr key={tenant.tenantId || `manual-${index}`} className="border-t border-[var(--border)] align-top">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={tenant.enabled}
                        disabled={!tenant.tenantId || busy !== null}
                        onChange={(event) => setTenants((current) =>
                          current.map((value, position) => position === index ? { ...value, enabled: event.target.checked } : value))}
                        aria-label={`Enable Auvik tenant ${tenant.tenantName || tenant.tenantId || index + 1}`}
                      />
                    </td>
                    <td className="min-w-52 p-3">
                      <input
                        aria-label={`Tenant name ${index + 1}`}
                        className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 font-medium"
                        value={tenant.tenantName}
                        onChange={(event) => updateTenant(index, 'tenantName', event.target.value)}
                        placeholder="Name"
                      />
                      <div className="mt-1 break-all text-xs text-[var(--muted)]">
                        {tenant.tenantType ? `${tenant.tenantType} · ` : ''}{tenant.domainPrefix && tenant.domainPrefix !== tenant.tenantName ? `${tenant.domainPrefix} · ` : ''}{tenant.tenantId}
                      </div>
                      {(!tenant.domainPrefix && !tenant.tenantType) && (
                        <input
                          aria-label="Manual tenant ID"
                          value={tenant.tenantId}
                          onChange={(event) => updateTenant(index, 'tenantId', event.target.value)}
                          placeholder="Auvik tenant ID"
                          className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1"
                        />
                      )}
                    </td>
                    {(['customer', 'businessUnit', 'site'] as const).map((field) => (
                      <td className="min-w-40 p-3" key={field}>
                        <AuvikMappingInput
                          connectionId={connection.id}
                          field={field}
                          tenantLabel={tenant.tenantName || tenant.tenantId}
                          value={tenant[field]}
                          customer={tenant.customer}
                          businessUnit={tenant.businessUnit}
                          disabled={busy !== null}
                          onChange={(value) => updateTenant(index, field, value)}
                          onSelect={(option) => selectExistingMapping(index, field, option)}
                        />
                      </td>
                    ))}
                    <td className="p-3 text-xs">
                      {tenant.mappingStatus === 'REUSED' ? 'Existing Auvik mapping'
                        : tenant.mappingStatus === 'MATCHED' ? 'Existing site'
                        : tenant.mappingStatus === 'PROPOSED' ? 'Proposed new hierarchy'
                        : tenant.mappingStatus === 'CONFLICT' ? 'Conflicting mappings'
                        : tenant.customer.trim() && tenant.site.trim() ? 'Saved mapping (reviewable)'
                        : <span className="text-[var(--warning)]">Needs review</span>}
                    </td>
                    <td className="p-3">
                      <Button variant="ghost" disabled={busy !== null} onClick={() => setTenants((current) => current.filter((_, position) => position !== index))}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleTenants.length === 0 && (
              <p className="p-6 text-center text-sm text-[var(--muted)]">No tenants match this filter. Discover tenants or change your search.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">Page {page} of {totalPages} · {visibleTenants.length} matching tenants · {tenantPageSize} per page</span>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setTenantPage((value) => Math.max(1, value - 1))}>Previous page</Button>
              <Button disabled={page >= totalPages} onClick={() => setTenantPage((value) => Math.min(totalPages, value + 1))}>Next page</Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-[var(--muted)]">Review all changes before saving. Sync now uses the saved selection, not unsaved edits.</span>
            <Button variant="primary" disabled={busy !== null} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      </section>

      <InventorySourceSchedulePanel
        provider="auvik"
        sourceId={connection.id}
        enabled={connection.enabled}
        connectionTestPassed={connection.connectionTest.status === 'SUCCESS'}
        hasEnabledScope={hasEnabledScope}
        syncRuns={syncRuns}
      />

      {message ? (
        <div className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          {message}
          {batchId ? (
            <>
              {' '}
              <Link
                href={`/devices/import/${batchId}`}
                className="font-semibold text-[var(--accent-light)] hover:underline"
              >
                Open reconciliation batch
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="text-xs text-[var(--muted)]">
        Source adapter: <span className="font-mono">{connection.sourceAdapterId}</span>
      </div>
    </div>
  )
}
