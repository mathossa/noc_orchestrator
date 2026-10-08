'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type {
  FirmwareDocumentLink,
  FirmwareDocumentMatch,
  FirmwareDocumentType,
} from '@/lib/firmware-release-documentation'
import { firmwareDocumentTypes } from '@/lib/firmware-release-documentation'
import { Button } from '@/components/ui/button'

type Payload = {
  release?: { id: string; version: string; platform: string; vendor: { name: string } }
  data?: FirmwareDocumentLink[]
  error?: { message: string }
}

const initial = {
  type: 'RELEASE_NOTES' as FirmwareDocumentType,
  title: '',
  url: '',
  source: '',
  notes: '',
  match: 'EXACT_VERSION' as FirmwareDocumentMatch,
}

function documentTypeLabel(type: string) {
  return type.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())
}

/** One release ID is used regardless of whether it is running or preferred. */
export function ReleaseDocumentationLinks({
  releaseId,
  editable = false,
}: {
  releaseId: string | null | undefined
  editable?: boolean
}) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(initial)

  const baseUrl = releaseId
    ? `/api/v1/firmware-releases/${encodeURIComponent(releaseId)}/documentation`
    : null

  useEffect(() => {
    if (!baseUrl) return
    const controller = new AbortController()
    fetch(baseUrl, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const next = (await response.json()) as Payload
        if (!response.ok) throw new Error(next.error?.message || 'Could not load release references.')
        if (!controller.signal.aborted) setPayload(next)
      })
      .catch((issue: unknown) => {
        if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : 'Could not load references.')
      })
    return () => controller.abort()
  }, [baseUrl])

  async function reload() {
    if (!baseUrl) return
    const response = await fetch(baseUrl, { cache: 'no-store' })
    const next = (await response.json()) as Payload
    if (!response.ok) throw new Error(next.error?.message || 'Could not load release references.')
    setPayload(next)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!baseUrl) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        editingId ? `${baseUrl}/${encodeURIComponent(editingId)}` : baseUrl,
        { method: editingId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) },
      )
      const result = (await response.json()) as Payload
      if (!response.ok) throw new Error(result.error?.message || 'Could not save reference.')
      await reload()
      setShowForm(false)
      setEditingId(null)
      setForm(initial)
    } catch (issue: unknown) {
      setError(issue instanceof Error ? issue.message : 'Could not save reference.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!baseUrl || !window.confirm('Delete this manually maintained reference?')) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) {
        const result = (await response.json()) as Payload
        throw new Error(result.error?.message || 'Could not delete reference.')
      }
      await reload()
    } catch (issue: unknown) {
      setError(issue instanceof Error ? issue.message : 'Could not delete reference.')
    } finally {
      setBusy(false)
    }
  }

  // Navigating between devices must not momentarily display references from
  // a previously viewed firmware release.
  const visiblePayload = payload?.release?.id === releaseId ? payload : null

  if (!releaseId) return <p className="text-xs text-[var(--muted)]">No canonical firmware release matched; documentation cannot be linked safely.</p>

  return (
    <section aria-label="Firmware documentation" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Documentation{visiblePayload?.release ? ` · ${payload.release.version}` : ''}</h3>
        {editable ? (
          <Button type="button" variant="secondary" onClick={() => {
            setShowForm((current) => !current)
            setEditingId(null)
            setForm(initial)
          }}>{showForm ? 'Cancel' : 'Add reference'}</Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{error}</p> : null}
      {!visiblePayload && !error ? <p className="mt-2 text-xs text-[var(--muted)]">Loading references…</p> : null}
      {visiblePayload?.data?.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">No release documentation linked. Use a manual reference; a vendor adapter may be added later.</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {visiblePayload?.data?.map((reference) => (
          <div key={reference.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0">
            <div className="min-w-0">
              <a href={reference.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-[var(--accent-light)] hover:underline">
                {reference.title} ↗
              </a>
              <p className="text-xs text-[var(--muted)]">
                {documentTypeLabel(reference.type)} · {reference.source} · {reference.match === 'EXACT_VERSION' ? 'Version-specific' : 'Platform overview'}
                {reference.origin === 'AUTO_SUGGESTED' ? ' · Automatically suggested, not verified' : ''}
                {reference.origin === 'LEGACY' ? ' · Existing catalog URL' : ''}
              </p>
              {reference.notes ? <p className="mt-1 text-xs text-[var(--muted)]">{reference.notes}</p> : null}
            </div>
            {editable && reference.origin === 'MANUAL' ? (
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => {
                  setEditingId(reference.id)
                  setShowForm(true)
                  setForm({
                    type: reference.type, title: reference.title, url: reference.url,
                    source: reference.source, notes: reference.notes ?? '', match: reference.match,
                  })
                }} className="text-xs text-[var(--accent-light)] hover:underline">Edit</button>
                <button type="button" disabled={busy} onClick={() => void remove(reference.id)} className="text-xs text-red-300 hover:underline">Delete</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {editable && showForm ? (
        <form onSubmit={save} className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <label className="text-xs">Reference type
            <select required value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as FirmwareDocumentType })}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-sm">
              {firmwareDocumentTypes.map((type) => <option key={type} value={type}>{documentTypeLabel(type)}</option>)}
            </select>
          </label>
          <label className="text-xs">Match scope
            <select value={form.match} onChange={(event) => setForm({ ...form, match: event.target.value as FirmwareDocumentMatch })}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-sm">
              <option value="EXACT_VERSION">Exact release</option>
              <option value="PLATFORM_INDEX">Platform overview</option>
            </select>
          </label>
          <label className="text-xs">Title
            <input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-sm" />
          </label>
          <label className="text-xs">Source / publisher
            <input required maxLength={120} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-sm" />
          </label>
          <label className="text-xs sm:col-span-2">URL
            <input type="url" required maxLength={2048} value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-sm" />
          </label>
          <label className="text-xs sm:col-span-2">Notes (optional)
            <textarea maxLength={2000} rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add documentation'}</Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
