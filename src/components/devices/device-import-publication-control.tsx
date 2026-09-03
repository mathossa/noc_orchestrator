'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DeviceImportPreview, DeviceImportResult } from '@/lib/device-import'

type ApiError = { error?: { message?: string } }
type PreviewPayload = { data?: DeviceImportPreview } & ApiError
type ResultPayload = { data?: DeviceImportResult } & ApiError

export function DeviceImportPublicationControl({ batchId }: { batchId: string }) {
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null)
  const [result, setResult] = useState<DeviceImportResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'valid' | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function validate() {
    setBusy('validate')
    setError(null)
    setResult(null)
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

      {blockers ? <p className="mt-3 text-sm text-amber-200">
        {blockers.toLocaleString()} blocked row{blockers === 1 ? '' : 's'} will stay STAGED so you can correct or exclude them later. They no longer prevent importing the valid rows.
      </p> : <p className="mt-3 text-sm text-[var(--accent-light)]">No blocking rows remain. The full remaining batch can be published.</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {valid > 0 ? <Button type="button" variant="primary" disabled={Boolean(busy)} onClick={() => void publish('VALID')}>
          {busy === 'valid' ? 'Importing…' : `Import ${valid.toLocaleString()} valid device${valid === 1 ? '' : 's'} now`}
        </Button> : null}
        <Button type="button" variant={blockers ? 'ghost' : 'primary'} disabled={Boolean(busy) || blockers > 0} onClick={() => void publish('ALL')}>
          {busy === 'all' ? 'Publishing…' : 'Publish all remaining devices'}
        </Button>
      </div>
    </div> : null}

    {result ? <div className="mt-4 text-sm text-[var(--accent-light)]">Imported {result.created.toLocaleString()} new · {result.updated.toLocaleString()} updated.</div> : null}
  </section>
}
