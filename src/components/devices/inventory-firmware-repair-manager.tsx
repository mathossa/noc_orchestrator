'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { PageHeader } from '@/components/ui/page-header'

type RepairStatus = 'MATCHED' | 'CORRECT' | 'UNSUPPORTED_MODEL' | 'NO_OBSERVATION' | 'MISSING_TARGET' | 'AMBIGUOUS' | 'EVIDENCE_CONFLICT'
type RepairRow = {
  deviceId: string
  deviceName: string
  customerId: string
  customerName: string
  siteName: string | null
  model: string
  runningVersion: string | null
  observedAt: string | null
  currentPlatform: string | null
  oldReleaseId: string | null
  oldTrain: string | null
  targetReleaseId: string | null
  targetVersion: string | null
  targetPlatform: string | null
  targetTrain: string | null
  status: RepairStatus
  updatedAt: string
}
type Preview = {
  rows: RepairRow[]
  vendors: { id: string; name: string }[]
  linkedPlatforms: string[]
  total: number
  page: number
  pageSize: number
  pages: number
  matched: number
  needsReview: number
  counts: Record<string, number>
}
type ApiPayload<T> = { data?: T; error?: { message?: string } }
type BulkOperation = 'ARCHIVE' | 'ACTIVATE' | 'SET_CUSTOMER' | 'SET_SITE' | 'SET_MODEL'
type BulkRefs = {
  customers: { id: string; name: string }[]
  sites: { id: string; name: string; customerId: string; label: string }[]
  models: { id: string; name: string; label: string }[]
}
type BulkItem = { deviceId: string; updatedAt: string; name: string }
type BulkPreview = {
  items: { deviceId: string; deviceName: string; customerName: string;
    before: string; after: string; changed: boolean; note: string | null }[]
  changedCount: number
  skippedCount: number
  fingerprint: string
  operation: BulkOperation
  targetId: string | null
}


const statusText: Record<RepairStatus, string> = {
  MATCHED: 'Exact match — can correct',
  CORRECT: 'Already linked correctly',
  UNSUPPORTED_MODEL: 'Model platforms missing',
  NO_OBSERVATION: 'No reliable firmware observation',
  MISSING_TARGET: 'No compatible canonical release',
  AMBIGUOUS: 'Multiple compatible releases — review',
  EVIDENCE_CONFLICT: 'Observed version conflicts with current link',
}

export function InventoryFirmwareRepairManager() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mode, setMode] = useState<'firmware' | 'devices'>('devices')
  const [bulkRefs, setBulkRefs] = useState<BulkRefs | null>(null)
  const [recordSelection, setRecordSelection] = useState<BulkItem[]>([])
  const [bulkOperation, setBulkOperation] = useState<BulkOperation>('ARCHIVE')
  const [bulkTarget, setBulkTarget] = useState('')
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [draftVendorId, setDraftVendorId] = useState('')
  const [linkedPlatform, setLinkedPlatform] = useState('')
  const [draftLinkedPlatform, setDraftLinkedPlatform] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selected, setSelected] = useState<string[]>([])
  const [lastAuditIds, setLastAuditIds] = useState<string[]>([])

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) })
    if (query) params.set('q', query)
    if (vendorId) params.set('vendorId', vendorId)
    if (linkedPlatform) params.set('linkedPlatform', linkedPlatform)
    const response = await fetch('/api/v1/inventory/firmware-links?' + params.toString(), { cache: 'no-store' })
    const payload = (await response.json()) as ApiPayload<Preview>
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Inventory preview could not be loaded.')
    return payload.data
  }, [page, query, vendorId, linkedPlatform, searchRevision])

  const refresh = useCallback(async () => {
    const next = await load()
    setPreview(next)
    setSelected([])
  }, [load])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/v1/inventory/bulk-maintenance', { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json() as ApiPayload<BulkRefs>
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Could not load bulk maintenance references.')
      if (!cancelled) setBulkRefs(payload.data)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Bulk maintenance setup failed.')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void load().then((next) => {
      if (!cancelled) {
        setPreview(next)
        setSelected([])
        setError('')
        if (searchRevision > 0) {
          setMessage('Search completed: ' + next.total + ' matching device(s).')
        }
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load inventory.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [load])

  const rows = useMemo(() =>
    (preview?.rows ?? []).filter((row) => statusFilter === 'ALL' || row.status === statusFilter),
    [preview, statusFilter],
  )
  const selectedRows = (preview?.rows ?? []).filter((row) =>
    selected.includes(row.deviceId) && row.status === 'MATCHED' && row.targetReleaseId,
  )
  const recordIds = new Set(recordSelection.map((item) => item.deviceId))
  const needsTarget = ['SET_CUSTOMER', 'SET_SITE', 'SET_MODEL'].includes(bulkOperation)
  const bulkTargetOptions = bulkOperation === 'SET_CUSTOMER'
    ? (bulkRefs?.customers ?? []).map((item) => ({ id: item.id, label: item.name }))
    : bulkOperation === 'SET_SITE'
      ? (bulkRefs?.sites ?? []).map((item) => ({ id: item.id, label: item.label }))
      : (bulkRefs?.models ?? []).map((item) => ({ id: item.id, label: item.label }))

  function toggleRecord(row: RepairRow, checked: boolean) {
    setBulkPreview(null)
    setRecordSelection((old) => checked
      ? [...old.filter((item) => item.deviceId !== row.deviceId),
        { deviceId: row.deviceId, updatedAt: row.updatedAt, name: row.deviceName }].slice(0, 50)
      : old.filter((item) => item.deviceId !== row.deviceId))
  }

  async function bulkRequest<T>(body: object): Promise<T> {
    const response = await fetch('/api/v1/inventory/bulk-maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const payload = await response.json() as ApiPayload<T>
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Bulk change failed.')
    return payload.data
  }

  async function previewBulk() {
    if (!recordSelection.length || (needsTarget && !bulkTarget)) return
    setBulkBusy(true); setError(''); setBulkPreview(null)
    try {
      setBulkPreview(await bulkRequest<BulkPreview>({
        action: 'preview', operation: bulkOperation, targetId: bulkTarget || undefined,
        items: recordSelection.map(({deviceId,updatedAt}) => ({ deviceId, updatedAt })),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not preview changes.')
    } finally { setBulkBusy(false) }
  }

  async function applyBulk() {
    if (!bulkPreview || !bulkPreview.changedCount || !window.confirm(
      'Apply ' + bulkPreview.changedCount + ' confirmed inventory changes in one atomic transaction?'
    )) return
    setBulkBusy(true); setError(''); setMessage('')
    try {
      const result = await bulkRequest<{ updated: number; skipped: number }>({
        action: 'apply', confirmed: true,
        operation: bulkOperation, targetId: bulkTarget || undefined,
        items: recordSelection.map(({deviceId,updatedAt}) => ({ deviceId, updatedAt })),
        fingerprint: bulkPreview.fingerprint,
      })
      setMessage(result.updated + ' device(s) updated; ' + result.skipped +
        ' unchanged. All changes were audited; source evidence and firmware policies were preserved.')
      setRecordSelection([])
      setBulkPreview(null)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not commit bulk changes.')
    } finally { setBulkBusy(false) }
  }

  const toggle = (id: string, checked: boolean) => {
    setSelected((old) => checked ? [...old.filter((value) => value !== id), id].slice(0, 50) : old.filter((value) => value !== id))
  }

  async function post(body: object) {
    const response = await fetch('/api/v1/inventory/firmware-links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as ApiPayload<{ updated?: number; auditIds?: string[] }>
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Inventory correction failed.')
    return payload.data
  }

  async function apply() {
    if (!selectedRows.length || !window.confirm(
      'Correct the canonical firmware reference for ' + selectedRows.length +
      ' selected device(s)? Running observations, timestamps, source identity and policy are preserved.',
    )) return
    setBusy(true); setMessage(''); setError('')
    try {
      const result = await post({
        action: 'apply', confirmed: true,
        items: selectedRows.map((row) => ({
          deviceId: row.deviceId,
          oldReleaseId: row.oldReleaseId,
          targetReleaseId: row.targetReleaseId,
          updatedAt: row.updatedAt,
        })),
      })
      setMessage((result.updated ?? 0) + ' firmware reference(s) corrected. Inventory, compliance and dashboard now read the updated canonical links.')
      setLastAuditIds(result.auditIds ?? [])
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Inventory correction failed.')
    } finally { setBusy(false) }
  }

  async function undo(auditEventId: string) {
    if (!window.confirm('Undo this specific reference correction? It will only work if the device has not changed since.')) return
    setBusy(true); setMessage(''); setError('')
    try {
      await post({ action: 'rollback', auditEventId })
      setLastAuditIds((items) => items.filter((id) => id !== auditEventId))
      setMessage('Reference correction rolled back.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not roll back correction.')
    } finally { setBusy(false) }
  }

  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    setQuery(draftQuery.trim())
    setVendorId(draftVendorId)
    setLinkedPlatform(draftLinkedPlatform)
    setPage(1)
    // Re-run even when the user submits the same filters twice.
    setSearchRevision((revision) => revision + 1)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Recorded inventory"
        title="Inventory corrections"
        description="Select devices for deliberate inventory changes, or review automatically detected canonical firmware-link corrections. Preview and confirm changes before they are applied."
      />
      <nav className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => setMode('devices')}
          aria-pressed={mode === 'devices'}
          className={mode === 'devices' ? 'rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 font-semibold' : 'rounded-md border border-[var(--border)] px-3 py-2'}>
          Bulk device changes
        </button>
        <button type="button" onClick={() => setMode('firmware')}
          aria-pressed={mode === 'firmware'}
          className={mode === 'firmware' ? 'rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 font-semibold' : 'rounded-md border border-[var(--border)] px-3 py-2'}>
          Firmware link suggestions
        </button>
        <Link href="/devices/manage" className="rounded-md border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]">
          Manage device records
        </Link>
        <Link href="/devices" className="rounded-md border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]">
          Explore inventory
        </Link>
      </nav>
      <p className="text-xs text-[var(--muted)]">
        {mode === 'devices'
          ? 'Select any device, even when its firmware is already correct. Available operations: archive/reactivate, reassign customer/site and change model. Only explicitly chosen fields are updated.'
          : 'Automatic firmware-link suggestions are available only for exact supported matches; existing correct links are not selectable in this mode.'}
        {' '}Source identities, observed firmware values/timestamps, desired policy and work planning are never rewritten by these operations.
      </p>
      <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        {loading ? <p>Loading recorded inventory…</p> : null}
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {message ? <p role="status" className="text-emerald-400">{message}</p> : null}
        <p className="text-xs text-[var(--muted)]">Choose a vendor, canonical platform or device search term, then click Search to apply the filters.</p>
        <form onSubmit={search} role="search" className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-xs">
            Search devices or customers
            <input type="search" value={draftQuery} onChange={(e) => setDraftQuery(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm"
              placeholder="Device name, model, customer" maxLength={100} />
          </label>
          <label className="min-w-44 text-xs">
            Vendor
            <select value={draftVendorId} onChange={(e) => setDraftVendorId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm">
              <option value="">All vendors</option>
              {preview?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="min-w-44 text-xs">
            Current canonical platform
            <select value={draftLinkedPlatform} onChange={(e) => setDraftLinkedPlatform(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm">
              <option value="">All platforms / devices</option>
              <option value="__UNLINKED__">Without canonical release</option>
              {preview?.linkedPlatforms.map((platform) =>
                <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}
            className="relative z-10 cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50">
            {loading ? 'Searching…' : 'Search'}
          </button>
          <button type="button" disabled={busy} onClick={() => {
            setBusy(true); setError('')
            void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Refresh failed.'))
              .finally(() => setBusy(false))
          }} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Refresh</button>
        </form>
        {preview ? (
          <>
            <p role="status" className="text-xs text-[var(--muted)]">
              Showing {preview.total} record(s) matching applied filters
              {query ? ' · Search: ' + query : ''}
              {vendorId ? ' · Vendor: ' + (preview.vendors.find((vendor) => vendor.id === vendorId)?.name ?? 'Selected') : ''}
              {linkedPlatform ? ' · Current platform: ' + (linkedPlatform === '__UNLINKED__' ? 'Unlinked' : linkedPlatform) : ''}
            </p>
            <p className="text-sm">
              <strong>{preview.total}</strong> devices in filter ·
              {mode === 'devices'
                ? <> <strong>{recordSelection.length}</strong> selected across pages (maximum 50)</>
                : <> <strong>{preview.matched}</strong> exact correction candidates on this page · {preview.needsReview} require review on this page</>}
            </p>
            {mode === 'firmware' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-[var(--muted)]">Only exact automatic corrections may be selected. This is not the manual bulk editor.</p>
                <button type="button" disabled={busy}
                  onClick={() => setSelected(rows.filter((r) => r.status === 'MATCHED').map((r) => r.deviceId))}
                  className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
                  Select exact suggestions on current page
                </button>
                <button type="button" disabled={busy || !selectedRows.length} onClick={() => void apply()}
                  className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50">
                  Confirm {selectedRows.length} suggestion(s)
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={bulkBusy} onClick={() => {
                    const available = rows.filter((r) => !recordIds.has(r.deviceId)).slice(0, 50 - recordSelection.length)
                    setRecordSelection((old) => [...old, ...available.map((r) => ({
                      deviceId: r.deviceId, updatedAt: r.updatedAt, name: r.deviceName,
                    }))])
                    setBulkPreview(null)
                  }} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
                    Select visible devices
                  </button>
                  <button type="button" disabled={!recordSelection.length || bulkBusy} onClick={() => {
                    setRecordSelection([]); setBulkPreview(null)
                  }} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
                    Clear selection ({recordSelection.length})
                  </button>
                  <span className="text-xs text-[var(--muted)]">Selection is retained when switching pages and filters, up to 50 devices.</span>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs">Change selected devices
                    <select value={bulkOperation} onChange={(e) => {
                      setBulkOperation(e.target.value as BulkOperation); setBulkTarget(''); setBulkPreview(null)
                    }} className="mt-1 block rounded border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm">
                      <option value="ARCHIVE">Archive</option>
                      <option value="ACTIVATE">Reactivate</option>
                      <option value="SET_CUSTOMER">Change customer (clear previous site)</option>
                      <option value="SET_SITE">Change site within same customer</option>
                      <option value="SET_MODEL">Change device model</option>
                    </select>
                  </label>
                  {needsTarget ? (
                    <label className="min-w-64 flex-1 text-xs">New value
                      <select value={bulkTarget} onChange={(e) => {
                        setBulkTarget(e.target.value); setBulkPreview(null)
                      }} className="mt-1 block w-full rounded border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm">
                        <option value="">Choose a target</option>
                        {bulkTargetOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <button type="button" disabled={bulkBusy || !recordSelection.length || (needsTarget && !bulkTarget)}
                    onClick={() => void previewBulk()}
                    className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50">
                    {bulkBusy ? 'Checking…' : 'Preview selected changes'}
                  </button>
                </div>
                {bulkPreview ? (
                  <section aria-label="Bulk change preview" className="space-y-2 rounded border border-[var(--border)] p-3">
                    <p className="text-sm"><strong>{bulkPreview.changedCount}</strong> to change · {bulkPreview.skippedCount} already matching target</p>
                    <div className="max-h-64 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead><tr><th className="p-1">Device</th><th className="p-1">Before</th><th className="p-1">After</th><th className="p-1">Result / notes</th></tr></thead>
                        <tbody>{bulkPreview.items.map((item) => (
                          <tr key={item.deviceId} className="border-t border-[var(--border)]">
                            <td className="p-1">{item.customerName} · {item.deviceName}</td>
                            <td className="p-1">{item.before}</td><td className="p-1">{item.after}</td>
                            <td className="p-1">{item.note ?? (item.changed ? 'Will update' : 'No change')}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <button type="button" disabled={bulkBusy || !bulkPreview.changedCount} onClick={() => void applyBulk()}
                      className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50">
                      Confirm and apply {bulkPreview.changedCount} changes
                    </button>
                  </section>
                ) : null}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="border-b border-[var(--border)]">
                  <th scope="col" className="p-2">Select</th>
                  <th scope="col" className="p-2">Customer / device</th>
                  <th scope="col" className="p-2">Model</th>
                  <th scope="col" className="p-2">Observed</th>
                  <th scope="col" className="p-2">Current canonical link</th>
                  <th scope="col" className="p-2">Suggested canonical link</th>
                  <th scope="col" className="p-2">{mode === 'devices' ? 'Edit' : 'Decision'}</th>
                </tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.deviceId} className="border-b border-[var(--border)] align-top">
                    <td className="p-2">
                      <input type="checkbox" checked={mode === 'devices' ? recordIds.has(row.deviceId) : selected.includes(row.deviceId)}
                        disabled={mode === 'devices' ? bulkBusy || (!recordIds.has(row.deviceId) && recordSelection.length >= 50) : busy || row.status !== 'MATCHED'}
                        onChange={(e) => mode === 'devices' ? toggleRecord(row, e.target.checked) : toggle(row.deviceId, e.target.checked)}
                        aria-label={'Select ' + row.deviceName} />
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{row.customerName}</div>
                      <Link href={'/devices/' + row.deviceId} className="underline">{row.deviceName}</Link>
                      {row.siteName ? <div className="text-xs text-[var(--muted)]">{row.siteName}</div> : null}
                    </td>
                    <td className="p-2">{row.model}</td>
                    <td className="p-2">{row.runningVersion ?? 'Unknown'}
                      <div className="text-xs text-[var(--muted)]">{row.observedAt ?? 'No observation timestamp'}</div>
                    </td>
                    <td className="p-2">{row.currentPlatform ?? 'Unlinked'} / {row.oldTrain ?? 'No train'}
                      <div className="text-xs text-[var(--muted)]">{row.oldReleaseId ?? 'No canonical release ID'}</div>
                    </td>
                    <td className="p-2">{row.targetReleaseId ? (
                      <>{row.targetPlatform} / {row.targetTrain ?? 'No train'} / {row.targetVersion}
                        <div className="text-xs text-[var(--muted)]">{row.targetReleaseId}</div></>
                    ) : '—'}</td>
                    <td className="p-2">{mode === 'devices'
                      ? 'Manual edits available' : statusText[row.status]}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!rows.length ? <p className="p-4 text-sm">No records matching these filters on this page.</p> : null}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <button type="button" disabled={page <= 1} className="underline disabled:opacity-40"
                onClick={() => setPage((n) => Math.max(1, n - 1))}>Previous</button>
              <span>Page {preview.page} / {preview.pages} · {preview.pageSize} per page</span>
              <button type="button" disabled={page >= preview.pages} className="underline disabled:opacity-40"
                onClick={() => setPage((n) => n + 1)}>Next</button>
            </div>
          </>
        ) : null}
      </section>
      {lastAuditIds.length ? (
        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="font-semibold">Recent corrections</h2>
          <p className="my-2 text-xs text-[var(--muted)]">Rollback requires the device to be unchanged since correction.</p>
          <ul className="space-y-2">{lastAuditIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 text-xs">
              <code className="break-all">{id}</code>
              <button type="button" disabled={busy} onClick={() => void undo(id)}
                className="shrink-0 rounded border border-[var(--border)] px-3 py-1.5 disabled:opacity-50">Undo</button>
            </li>
          ))}</ul>
        </section>
      ) : null}
    </div>
  )
}
