'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
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
}

type TenantEditor = {
  enabled: boolean
  tenantId: string
  tenantName: string
  customer: string
  businessUnit: string
  site: string
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
}: {
  initialConnection: Connection
  initialSyncRuns: InventorySourceSyncRun[]
}) {
  const router = useRouter()
  const [connection, setConnection] = useState(initialConnection)
  const [name, setName] = useState(connection.name)
  const [region, setRegion] = useState(connection.configuration.region)
  const [tenants, setTenants] = useState<TenantEditor[]>(
    connection.configuration.tenants.length
      ? connection.configuration.tenants.map(editorTenant)
      : [editorTenant()],
  )
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
        tenantIndex === index ? { ...tenant, [field]: value } : tenant,
      ),
    )
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
            tenants: tenants.filter((tenant) => tenant.tenantId.trim()),
            ...credentials,
          }),
        },
      )
      const updated = (await responseData(response)) as Connection
      setConnection(updated)
      setName(updated.name)
      setRegion(updated.configuration.region)
      setTenants(
        updated.configuration.tenants.length
          ? updated.configuration.tenants.map(editorTenant)
          : [editorTenant()],
      )
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
      setTenants((current) => {
        const existing = new Map(current.filter((tenant) => tenant.tenantId).map((tenant) => [tenant.tenantId, tenant]))
        return [
          ...current.filter((tenant) => tenant.tenantId && !discovered.some((candidate) => candidate.id === tenant.tenantId)),
          ...discovered.map((tenant) => {
            const saved = existing.get(tenant.id)
            return saved ?? editorTenant({
              tenantId: tenant.id,
              tenantName: tenant.domainPrefix,
              enabled: false,
            })
          }),
        ]
      })
      setMessage(`Discovered ${discovered.length} Auvik tenants. Review enabled locations and save settings; newly discovered tenants start disabled.`)
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
      if (autoPublication.status === 'PUBLISHED') {
        const published =
          ` Auto-published ${autoPublication.publishedLogicalDeviceCount.toLocaleString()} valid device${autoPublication.publishedLogicalDeviceCount === 1 ? '' : 's'}.`
        const review = autoPublication.reconciliationRequired
          ? ` ${autoPublication.remainingIncludedRows.toLocaleString()} device row${autoPublication.remainingIncludedRows === 1 ? '' : 's'} still need reconciliation.`
          : ' No reconciliation is required.'
        setMessage(staged + published + review)
      } else if (autoPublication.reconciliationRequired) {
        setMessage(
          staged +
            ` ${autoPublication.remainingIncludedRows.toLocaleString()} device row${autoPublication.remainingIncludedRows === 1 ? '' : 's'} need reconciliation.` +
            (autoPublication.error
              ? ` Automatic publication paused: ${autoPublication.error}`
              : ''),
        )
      } else {
        setMessage(staged + ' Nothing required reconciliation or publication.')
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
            <h2 className="font-semibold">Tenant mappings</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Explicit first-slice mapping. These values remain staged evidence;
              canonical hierarchy decisions still happen in Importer v2.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy !== null ||
                connection.connectionTest.status !== 'SUCCESS'
              }
              onClick={() => void syncTenantsAndSites()}
            >
              {busy === 'discover' ? 'Syncing tenants…' : 'Sync tenants & sites'}
            </Button>
            <Button onClick={() => setTenants((current) => [...current, editorTenant()])}>
              Add manually
            </Button>
          </div>
        </div>
        <div className="space-y-3 p-5">
          {tenants.map((tenant, index) => (
            <div
              key={index}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4"
            >
              <label className="mb-3 flex items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={tenant.enabled} disabled={!tenant.tenantId} onChange={(event) => setTenants((current) => current.map((value, position) => position === index ? { ...value, enabled: event.target.checked } : value))} aria-label={`Enable Auvik tenant ${tenant.tenantName || tenant.tenantId || index + 1}`} />
                Enable tenant for synchronization
              </label>
              <div className="grid gap-3 lg:grid-cols-5">
                {(
                  [
                    ['tenantId', 'Tenant ID'],
                    ['tenantName', 'Tenant name'],
                    ['customer', 'Customer'],
                    ['businessUnit', 'Business Unit'],
                    ['site', 'Site'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="space-y-1 text-xs">
                    <span className="font-semibold text-[var(--muted-strong)]">{label}</span>
                    <input
                      value={tenant[field]}
                      onChange={(event) => updateTenant(index, field, event.target.value)}
                      className="h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setTenants((current) =>
                        current.filter((_, tenantIndex) => tenantIndex !== index),
                      )
                    }
                  >
                    Remove tenant
                  </Button>
                </div>
            </div>
          ))}
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => void save()}
            >
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
