'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'

type RepairStatus = 'MATCHED' | 'ALREADY_CORRECT' | 'UNSUPPORTED_MODEL' | 'MISSING_TARGET' | 'AMBIGUOUS' | 'NOT_APPLICABLE'
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
  targetTrain: string | null
  status: RepairStatus
  updatedAt: string
}
type Preview = {
  rows: RepairRow[]
  truncated: boolean
  totalInspected: number
  affectedCustomers: number
  matched: number
  needsReview: number
  counts: Record<string, number>
}
type Response<T> = { data?: T; error?: { message?: string } }

const PAGE_SIZE = 50
const statusText: Record<RepairStatus, string> = {
  MATCHED: 'Exact match — ready',
  ALREADY_CORRECT: 'Already correct',
  UNSUPPORTED_MODEL: 'Model compatibility missing',
  MISSING_TARGET: 'No exact equivalent',
  AMBIGUOUS: 'Ambiguous release',
  NOT_APPLICABLE: 'Not applicable',
}

export function CanonicalFirmwareRepairManager() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [lastAuditIds, setLastAuditIds] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const response = await fetch('/api/v1/inventory/firmware-repair', { cache: 'no-store' })
    const payload = (await response.json()) as Response<Preview>
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Preview could not be loaded.')
    setPreview(payload.data)
    setSelected([])
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await refresh()
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Preview failed.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refresh])

  const rows = useMemo(() =>
    (preview?.rows ?? []).filter((row) => statusFilter === 'ALL' || row.status === statusFilter),
    [preview, statusFilter],
  )
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE)
  const selectedRows = (preview?.rows ?? []).filter((row) => selected.includes(row.deviceId) &&
    row.status === 'MATCHED' && row.oldReleaseId && row.targetReleaseId)

  function toggleRow(id: string, checked: boolean) {
    setSelected((current) => checked
      ? [...current.filter((item) => item !== id), id].slice(0, 50)
      : current.filter((item) => item !== id))
  }

  async function send(body: object) {
    const response = await fetch('/api/v1/inventory/firmware-repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as Response<{ updated?: number; auditIds?: string[]; rolledBack?: boolean }>
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Operation failed.')
    return payload.data
  }

  async function apply() {
    if (selectedRows.length === 0 || !window.confirm(
      'Relink ' + selectedRows.length + ' device(s) to their exact canonical FortiOS release? Raw scan evidence, observed timestamps and policies will remain unchanged.',
    )) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await send({
        action: 'apply', confirmed: true,
        items: selectedRows.map((r) => ({
          deviceId: r.deviceId, oldReleaseId: r.oldReleaseId,
          targetReleaseId: r.targetReleaseId, updatedAt: r.updatedAt,
        })),
      })
      setMessage((result.updated ?? 0) + ' canonical firmware link(s) corrected. Compliance and campaigns will now read the corrected inventory.')
      setLastAuditIds(result.auditIds ?? [])
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Repair failed.')
    } finally {
      setBusy(false)
    }
  }

  async function undo(auditEventId: string) {
    if (!window.confirm('Undo this correction only if the device has not changed since the repair?')) return
    setBusy(true); setError(''); setMessage('')
    try {
      await send({ action: 'rollback', auditEventId })
      setLastAuditIds((ids) => ids.filter((id) => id !== auditEventId))
      setMessage('Correction rolled back; inventory was refreshed.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rollback failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canonical FortiOS link repair"
        description="Administrator-only remediation of legacy FortiGate software-platform links in recorded inventory. Preview before applying; no new import or device scan."
      />
      <p className="text-sm text-[var(--muted)]">
        <Link href="/firmware" className="underline">Firmware catalog</Link>
        {' · '}
        <Link href="/devices" className="underline">Recorded inventory</Link>
      </p>
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        {loading ? <p>Loading read-only preview…</p> : null}
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {message ? <p role="status" className="text-emerald-400">{message}</p> : null}
        {preview ? (
          <>
            <p className="text-sm">
              <strong>{preview.matched}</strong> safe exact matches · <strong>{preview.needsReview}</strong> review required ·
              {' '}{preview.affectedCustomers} affected customers · {preview.totalInspected} inspected devices
            </p>
            {preview.truncated ? <p role="alert" className="text-amber-400">
              Preview limited to the first 5,000 legacy-linked devices. Review remaining records separately; no unlisted device can be changed here.
            </p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="firmware-repair-filter" className="text-sm">Status</label>
              <select id="firmware-repair-filter" className="rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
                <option value="ALL">All</option>
                {Object.entries(statusText).map(([status, text]) =>
                  <option key={status} value={status}>{text} ({preview.counts[status] ?? 0})</option>)}
              </select>
              <button type="button" disabled={busy} onClick={() => {
                setSelected(visible.filter((r) => r.status === 'MATCHED').slice(0, 50).map((r) => r.deviceId))
              }} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
                Select up to 50 safe rows on page
              </button>
              <button type="button" disabled={busy || selectedRows.length === 0} onClick={() => void apply()}
                className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50">
                Confirm {selectedRows.length} correction(s)
              </button>
              <button type="button" disabled={busy} onClick={() => {
                setBusy(true); setError('')
                void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Refresh failed.'))
                  .finally(() => setBusy(false))
              }} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Refresh preview</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="border-b border-[var(--border)]">
                  <th className="p-2">Select</th><th className="p-2">Customer / device</th><th className="p-2">Model</th>
                  <th className="p-2">Observed</th><th className="p-2">Current link</th>
                  <th className="p-2">Proposed link</th><th className="p-2">Decision</th>
                </tr></thead>
                <tbody>{visible.map((row) => (
                  <tr key={row.deviceId} className="border-b border-[var(--border)] align-top">
                    <td className="p-2"><input type="checkbox"
                      aria-label={'Select ' + row.deviceName}
                      disabled={busy || row.status !== 'MATCHED'}
                      checked={selected.includes(row.deviceId)}
                      onChange={(e) => toggleRow(row.deviceId, e.target.checked)} /></td>
                    <td className="p-2"><div className="font-medium">{row.customerName}</div>
                      <Link href={'/devices/' + row.deviceId} className="underline">{row.deviceName}</Link>
                      {row.siteName ? <div className="text-xs text-[var(--muted)]">{row.siteName}</div> : null}
                    </td>
                    <td className="p-2">{row.model}</td>
                    <td className="p-2">{row.runningVersion ?? 'Unknown'}
                      <div className="text-xs text-[var(--muted)]">{row.observedAt ?? 'No timestamp'}</div></td>
                    <td className="p-2">{row.currentPlatform} / {row.oldTrain ?? 'Unassigned'}
                      <div className="text-xs text-[var(--muted)]">{row.oldReleaseId}</div></td>
                    <td className="p-2">{row.targetReleaseId
                      ? <>FortiOS / {row.targetTrain ?? 'Unassigned'} / {row.targetVersion}
                        <div className="text-xs text-[var(--muted)]">{row.targetReleaseId}</div></>
                      : 'Needs review'}</td>
                    <td className="p-2">{statusText[row.status]}</td>
                  </tr>
                ))}</tbody>
              </table>
              {visible.length === 0 ? <p className="p-4 text-sm">No matching devices.</p> : null}
            </div>
            <div className="flex gap-3 text-sm">
              <button type="button" className="underline disabled:opacity-40" disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
              <span>Page {Math.min(page, pages)} / {pages}</span>
              <button type="button" className="underline disabled:opacity-40" disabled={page >= pages}
                onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button>
            </div>
          </>
        ) : null}
      </section>
      {lastAuditIds.length ? <section className="rounded-lg border border-[var(--border)] p-4">
        <h2 className="mb-2 font-semibold">Recent corrections · audited rollback</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">Rollback is refused if the device changed since the correction.</p>
        <ul className="space-y-2">{lastAuditIds.map((id) =>
          <li key={id} className="flex items-center justify-between gap-3 text-xs">
            <code className="break-all">{id}</code>
            <button type="button" disabled={busy} onClick={() => void undo(id)}
              className="shrink-0 rounded border border-[var(--border)] px-3 py-1.5 disabled:opacity-50">Undo</button>
          </li>)}</ul>
      </section> : null}
    </div>
  )
}
