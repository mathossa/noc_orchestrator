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
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [linkedPlatform, setLinkedPlatform] = useState('')
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
  }, [page, query, vendorId, linkedPlatform])

  const refresh = useCallback(async () => {
    const next = await load()
    setPreview(next)
    setSelected([])
  }, [load])

  useEffect(() => {
    let cancelled = false
    void load().then((next) => {
      if (!cancelled) {
        setPreview(next)
        setSelected([])
        setError('')
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
    setQuery(draftQuery.trim())
    setPage(1)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Recorded inventory"
        title="Inventory corrections"
        description="Review and correct canonical firmware references for devices from any vendor. All changes require an exact, model-compatible match and operator confirmation."
      />
      <nav className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 font-semibold">Firmware references</span>
        <Link href="/devices/manage" className="rounded-md border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]">
          Manage device records
        </Link>
        <Link href="/devices" className="rounded-md border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]">
          Explore inventory
        </Link>
      </nav>
      <p className="text-xs text-[var(--muted)]">
        Bulk corrections of customer, site, model and archive state are being developed separately under #112. They are not part of this firmware-reference operation.
        No firmware version, desired policy, scan timestamp or provider identity is changed here.
      </p>
      <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        {loading ? <p>Loading recorded inventory…</p> : null}
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {message ? <p role="status" className="text-emerald-400">{message}</p> : null}
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-xs">
            Search devices or customers
            <input type="search" value={draftQuery} onChange={(e) => setDraftQuery(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm"
              placeholder="Device name, model, customer" maxLength={100} />
          </label>
          <label className="min-w-44 text-xs">
            Vendor
            <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPage(1) }}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm">
              <option value="">All vendors</option>
              {preview?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="min-w-44 text-xs">
            Current canonical platform
            <select value={linkedPlatform} onChange={(e) => { setLinkedPlatform(e.target.value); setPage(1) }}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-2 text-sm">
              <option value="">All platforms / devices</option>
              <option value="__UNLINKED__">Without canonical release</option>
              {preview?.linkedPlatforms.map((platform) =>
                <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)]">Search</button>
          <button type="button" disabled={busy} onClick={() => {
            setBusy(true); setError('')
            void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Refresh failed.'))
              .finally(() => setBusy(false))
          }} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Refresh</button>
        </form>
        {preview ? (
          <>
            <p className="text-sm">
              <strong>{preview.total}</strong> devices in filter ·
              {' '}<strong>{preview.matched}</strong> exact correction candidates on this page ·
              {' '}{preview.needsReview} require review on this page
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs">
                Decision on this page
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="ml-2 rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm">
                  <option value="ALL">All decisions</option>
                  {Object.entries(statusText).map(([key, label]) => (
                    <option key={key} value={key}>{label} ({preview.counts[key] ?? 0})</option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy}
                onClick={() => setSelected(rows.filter((r) => r.status === 'MATCHED').slice(0, 50).map((r) => r.deviceId))}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
                Select exact matches on page
              </button>
              <button type="button" disabled={busy || !selectedRows.length} onClick={() => void apply()}
                className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50">
                Confirm {selectedRows.length} correction(s)
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="border-b border-[var(--border)]">
                  <th scope="col" className="p-2">Select</th>
                  <th scope="col" className="p-2">Customer / device</th>
                  <th scope="col" className="p-2">Model</th>
                  <th scope="col" className="p-2">Observed</th>
                  <th scope="col" className="p-2">Current canonical link</th>
                  <th scope="col" className="p-2">Suggested canonical link</th>
                  <th scope="col" className="p-2">Decision</th>
                </tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.deviceId} className="border-b border-[var(--border)] align-top">
                    <td className="p-2">
                      <input type="checkbox" checked={selected.includes(row.deviceId)}
                        disabled={busy || row.status !== 'MATCHED'} onChange={(e) => toggle(row.deviceId, e.target.checked)}
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
                    <td className="p-2">{statusText[row.status]}</td>
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
