'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { FieldErrors, ReferenceKind, ReferenceRecord } from '@/lib/reference-data'

type ApiError = {
  error?: {
    message?: string
    fields?: FieldErrors
  }
}

type FormState = {
  code: string
  name: string
  description: string
  websiteUrl: string
  firmwareManagementEnabled: boolean
  isActive: boolean
}

const initialForm: FormState = {
  code: '',
  name: '',
  description: '',
  websiteUrl: '',
  firmwareManagementEnabled: true,
  isActive: true,
}

async function fetchReferenceRecords(endpoint: string) {
  const response = await fetch(endpoint, { cache: 'no-store' })
  const payload = (await response.json()) as { data?: ReferenceRecord[] } & ApiError
  if (!response.ok) throw new Error(payload.error?.message ?? 'Reference data could not be loaded.')
  return payload.data ?? []
}

export function ReferenceDataManager({
  kind,
  title,
  description,
}: {
  kind: ReferenceKind
  title: string
  description: string
}) {
  const [records, setRecords] = useState<ReferenceRecord[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const endpoint = `/api/v1/reference-data/${kind}`

  useEffect(() => {
    let cancelled = false

    void fetchReferenceRecords(endpoint)
      .then((nextRecords) => {
        if (cancelled) return
        setRecords(nextRecords)
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Reference data could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [endpoint])

  async function reloadRecords() {
    try {
      const nextRecords = await fetchReferenceRecords(endpoint)
      setRecords(nextRecords)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Reference data could not be loaded.')
    }
  }

  function resetForm() {
    setForm(initialForm)
    setEditingId(null)
    setFieldErrors({})
    setError(null)
  }

  function beginEdit(record: ReferenceRecord) {
    setEditingId(record.id)
    setForm({
      code: record.code,
      name: record.name,
      description: record.description ?? '',
      websiteUrl: record.websiteUrl ?? '',
      firmwareManagementEnabled: record.firmwareManagementEnabled ?? true,
      isActive: record.isActive,
    })
    setFieldErrors({})
    setError(null)
    setMessage(null)
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})

    try {
      const response = await fetch(editingId ? `${endpoint}/${editingId}` : endpoint, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'The record could not be saved.')
      }

      setMessage(editingId ? 'Reference record updated.' : 'Reference record created.')
      resetForm()
      await reloadRecords()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The record could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(record: ReferenceRecord) {
    setError(null)
    setMessage(null)
    const response = await fetch(`${endpoint}/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...record, isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'The record could not be updated.')
      return
    }
    setMessage(record.isActive ? 'Record archived.' : 'Record reactivated.')
    await reloadRecords()
  }

  async function deleteRecord(record: ReferenceRecord) {
    if (!window.confirm(`Permanently delete “${record.name}”? Referenced records cannot be deleted.`)) return

    setError(null)
    setMessage(null)
    const response = await fetch(`${endpoint}/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'The record could not be deleted.')
      return
    }
    setMessage('Reference record deleted.')
    if (editingId === record.id) resetForm()
    await reloadRecords()
  }

  const noun = kind === 'vendors' ? 'vendor' : kind === 'device-types' ? 'device type' : 'contract type'

  return (
    <>
      <PageHeader eyebrow="Configuration" title={title} description={description} />

      {message ? (
        <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Configured {title.toLowerCase()}</h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Archived records remain available for historical references and filters.</p>
            </div>
            <span className="text-xs text-[var(--muted)]">{records.length} total</span>
          </div>

          {loading ? (
            <LoadingState title="Loading reference data" />
          ) : records.length === 0 ? (
            <EmptyState title={`No ${title.toLowerCase()} configured`} description={`Create the first ${noun} using the form.`} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">{title} configuration</caption>
                <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Code</th>
                    {kind === 'contract-types' ? <th className="px-4 py-3 font-semibold">Firmware management</th> : null}
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {records.map((record) => (
                    <tr key={record.id} className={record.isActive ? '' : 'opacity-60'}>
                      <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                        {record.name}
                        {record.description ? <div className="mt-0.5 max-w-xl text-xs font-normal text-[var(--muted)]">{record.description}</div> : null}
                        {record.websiteUrl ? <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">{record.websiteUrl}</div> : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted-strong)]">{record.code}</td>
                      {kind === 'contract-types' ? (
                        <td className="px-4 py-3 text-xs text-[var(--muted-strong)]">
                          {record.firmwareManagementEnabled ? 'Enabled' : 'Disabled'}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--muted-strong)]">
                          {record.isActive ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => beginEdit(record)}>Edit</Button>
                          <Button variant="ghost" onClick={() => void toggleArchive(record)}>{record.isActive ? 'Archive' : 'Reactivate'}</Button>
                          <Button variant="danger" onClick={() => void deleteRecord(record)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">{editingId ? `Edit ${noun}` : `Add ${noun}`}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Names are unique after trimming, whitespace normalization, and case folding.
            </p>
          </div>
          <form className="space-y-4" onSubmit={saveRecord}>
            <FormField label="Name" htmlFor="reference-name" error={fieldErrors.name}>
              <TextInput id="reference-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} aria-invalid={Boolean(fieldErrors.name)} required />
            </FormField>
            <FormField label="Code" htmlFor="reference-code" description="Stored in uppercase; spaces become hyphens." error={fieldErrors.code}>
              <TextInput id="reference-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} aria-invalid={Boolean(fieldErrors.code)} required />
            </FormField>

            {kind === 'vendors' ? (
              <FormField label="Website" htmlFor="reference-website" error={fieldErrors.websiteUrl}>
                <TextInput id="reference-website" type="url" placeholder="https://…" value={form.websiteUrl} onChange={(event) => setForm({ ...form, websiteUrl: event.target.value })} aria-invalid={Boolean(fieldErrors.websiteUrl)} />
              </FormField>
            ) : (
              <FormField label="Description / notes" htmlFor="reference-description">
                <TextArea id="reference-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </FormField>
            )}

            {kind === 'contract-types' ? (
              <label className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.firmwareManagementEnabled} onChange={(event) => setForm({ ...form, firmwareManagementEnabled: event.target.checked })} />
                <span>
                  <span className="block font-semibold text-[var(--foreground)]">Firmware management enabled</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">Capability flag only; complex contract policy rules are intentionally not implemented in v0.1.0.</span>
                </span>
              </label>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              {editingId ? <Button variant="ghost" onClick={resetForm}>Cancel</Button> : null}
              <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : `Create ${noun}`}</Button>
            </div>
          </form>
        </section>
      </div>
    </>
  )
}
