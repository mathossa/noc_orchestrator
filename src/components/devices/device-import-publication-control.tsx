'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DeviceImportPreview, DeviceImportPreviewRow, DeviceImportResult } from '@/lib/device-import'

type ApiError = { error?: { message?: string } }
type PreviewPayload = { data?: DeviceImportPreview } & ApiError
type ResultPayload = { data?: DeviceImportResult } & ApiError

type BlockedReason = {
  key: string
  action: 'ERROR' | 'CONFLICT'
  message: string
  count: number
}

type BlockedReview = {
  total: number
  filteredTotal: number
  offset: number
  limit: number
  reasons: BlockedReason[]
  rows: DeviceImportPreviewRow[]
}

type BlockedPayload = { data?: BlockedReview } & ApiError

export function DeviceImportPublicationControl({ batchId }: { batchId: string }) {
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null)
  const [result, setResult] = useState<DeviceImportResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'valid' | 'all' | null>(null)
  const [blockedBusy, setBlockedBusy] = useState(false)
  const [blockedReview, setBlockedReview] = useState<BlockedReview | null>(null)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function validate() {
    setBusy('validate')
    setError(null)
    setResult(null)
    setBlockedReview(null)
    setBlockedReason(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/validate`, { method: 'POST' })
      const payload = await response.json() as PreviewPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Device validation failed.')
      setPreview(payload.data)
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Device validation failed.')
    } finally {
      setBusy(null)
    }
  }

  async function loadBlocked(offset = 0, reason: string | null = blockedReason) {
    setBlockedBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: '50' })
      if (reason) params.set('reason', reason)
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/blocked?${params.toString()}`)
      const payload = await response.json() as BlockedPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The blocked devices could not be loaded.')
      setBlockedReview(payload.data)
      setBlockedReason(reason)
    } catch (blockedError) {
      setError(blockedError instanceof Error ? blockedError.message : 'The blocked devices could not be loaded.')
    } finally {
      setBlockedBusy(false)
    }
  }

  async function publish(mode: 'VALID' | 'ALL') {
    setBusy(mode === 'VALID' ? 'valid' : 'all')
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await response.json() as ResultPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The devices could not be imported.')
      setResult(payload.data)
      setPreview(null)
      window.location.reload()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'The devices could not be imported.')
    } finally {
      setBusy(null)
    }
  }

  const blockers = preview ? preview.counts.error + preview.counts.conflict : 0
  const valid = preview?.counts.importable ?? 0
  const blockedEnd = blockedReview ? Math.min(blockedReview.offset + blockedReview.rows.length, blockedReview.filteredTotal) : 0

  return <section className="mb-5 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-light)]">Device publication</div>
        <h2 className="mt-1 text-base font-semibold">Validate, then import the devices that are ready</h2>
        <p className="mt-2 text-sm text-[var(--muted-strong)]">
          <strong>STAGED</strong> means a source row is still quarantined in this import batch; it is not an inventory device yet.
          The Device table below is only a sample for inspection, ignore and exclude actions. You do not have to process that table row-by-row.
        </p>
      </div>
      <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void validate()}>
        {busy === 'validate' ? 'Validating…' : preview ? 'Validate again' : 'Validate remaining devices'}
      </Button>
    </div>

    {error ? <div className="mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-3 py-2 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

    {preview ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <strong>{valid.toLocaleString()} ready to import</strong>
        <span>Create {preview.counts.create.toLocaleString()}</span>
        <span>Update {preview.counts.update.toLocaleString()}</span>
        <span>Unchanged {preview.counts.unchanged.toLocaleString()}</span>
        <span>Conflicts {preview.counts.conflict.toLocaleString()}</span>
        <span>Errors {preview.counts.error.toLocaleString()}</span>
      </div>

      {blockers ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-amber-200">
          {blockers.toLocaleString()} blocked row{blockers === 1 ? '' : 's'} will stay STAGED so you can correct or exclude them later. They no longer prevent importing the valid rows.
        </p>
        <Button type="button" variant="ghost" disabled={blockedBusy || Boolean(busy)} onClick={() => void loadBlocked(0, null)}>
          {blockedBusy && !blockedReview ? 'Loading blocked devices…' : `Review ${blockers.toLocaleString()} blocked devices`}
        </Button>
      </div> : <p className="mt-3 text-sm text-[var(--accent-light)]">No blocking rows remain. The full remaining batch can be published.</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {valid > 0 ? <Button type="button" variant="primary" disabled={Boolean(busy)} onClick={() => void publish('VALID')}>
          {busy === 'valid' ? 'Importing in safe chunks…' : `Import ${valid.toLocaleString()} valid device${valid === 1 ? '' : 's'} now`}
        </Button> : null}
        <Button type="button" variant={blockers ? 'ghost' : 'primary'} disabled={Boolean(busy) || blockers > 0} onClick={() => void publish('ALL')}>
          {busy === 'all' ? 'Publishing…' : 'Publish all remaining devices'}
        </Button>
      </div>
    </div> : null}

    {blockedReview ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Blocked device review</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Filter by reason, then inspect the exact source rows. Validation problems are grouped so repeated issues can be fixed as one class instead of row-by-row.</p>
        </div>
        <Button type="button" variant="ghost" disabled={blockedBusy} onClick={() => void loadBlocked(blockedReview.offset, blockedReason)}>{blockedBusy ? 'Refreshing…' : 'Refresh blockers'}</Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={`rounded-md border px-2.5 py-1.5 text-xs ${blockedReason === null ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'border-[var(--border)] text-[var(--muted-strong)]'}`} disabled={blockedBusy} onClick={() => void loadBlocked(0, null)}>
          All blocked · {blockedReview.total.toLocaleString()}
        </button>
        {blockedReview.reasons.slice(0, 20).map((reason) => <button key={reason.key} type="button" className={`max-w-full rounded-md border px-2.5 py-1.5 text-left text-xs ${blockedReason === reason.key ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'border-[var(--border)] text-[var(--muted-strong)]'}`} disabled={blockedBusy} onClick={() => void loadBlocked(0, reason.key)} title={reason.message}>
          <strong>{reason.action}</strong> · {reason.count.toLocaleString()} · {reason.message}
        </button>)}
      </div>
      {blockedReview.reasons.length > 20 ? <p className="mt-2 text-xs text-[var(--muted)]">Showing the 20 most common reason groups of {blockedReview.reasons.length.toLocaleString()} total groups.</p> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1050px] text-left text-xs">
          <thead><tr className="border-b border-[var(--border)] uppercase tracking-wide text-[var(--muted)]"><th className="p-2">Row</th><th className="p-2">Device</th><th className="p-2">State</th><th className="p-2">Customer / Site</th><th className="p-2">Model / Firmware</th><th className="p-2">Why blocked</th></tr></thead>
          <tbody>{blockedReview.rows.map((row) => <tr key={row.rowNumber} className="border-b border-[var(--border)] align-top">
            <td className="p-2 font-mono">{row.rowNumber}</td>
            <td className="p-2 font-semibold">{row.identity}</td>
            <td className="p-2"><span className={row.action === 'CONFLICT' ? 'text-amber-200' : 'text-[#f0b0b0]'}>{row.action}</span></td>
            <td className="p-2"><div>{row.customer ?? '—'}</div><div className="mt-1 text-[var(--muted)]">{row.site ?? '—'}</div></td>
            <td className="p-2"><div>{row.model ?? '—'}</div><div className="mt-1 font-mono text-[var(--muted)]">{row.currentFirmware ?? '—'}</div></td>
            <td className="p-2 text-[var(--muted-strong)]">{row.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join(' · ') || 'No detailed reason was returned.'}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>{blockedReview.filteredTotal ? `Showing ${blockedReview.offset + 1}-${blockedEnd} of ${blockedReview.filteredTotal.toLocaleString()}` : 'No blocked rows match this reason.'}</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={blockedBusy || blockedReview.offset === 0} onClick={() => void loadBlocked(Math.max(0, blockedReview.offset - blockedReview.limit), blockedReason)}>Previous</Button>
          <Button type="button" variant="ghost" disabled={blockedBusy || blockedReview.offset + blockedReview.limit >= blockedReview.filteredTotal} onClick={() => void loadBlocked(blockedReview.offset + blockedReview.limit, blockedReason)}>Next</Button>
        </div>
      </div>
    </div> : null}

    {result ? <div className="mt-4 text-sm text-[var(--accent-light)]">Imported {result.created.toLocaleString()} new · {result.updated.toLocaleString()} updated.</div> : null}
  </section>
}
