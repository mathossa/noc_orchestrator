'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { FirmwareReleaseReference } from '@/lib/firmware-releases'
import type { FirmwareTrainFieldErrors, FirmwareTrainRecord } from '@/lib/firmware-trains'

type ApiError = { error?: { message?: string; fields?: FirmwareTrainFieldErrors } }
type Payload = { data?: FirmwareTrainRecord[]; meta?: { vendors?: FirmwareReleaseReference[] } } & ApiError

type FormState = {
  vendorId: string
  platform: string
  name: string
  notes: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

const initialForm: FormState = {
  vendorId: '',
  platform: '',
  name: '',
  notes: '',
  source: 'MANUAL',
  externalProvider: '',
  externalId: '',
  isActive: true,
}

export function FirmwareTrainManager() {
  const [records, setRecords] = useState<FirmwareTrainRecord[]>([])
  const [vendors, setVendors] = useState<FirmwareReleaseReference[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FirmwareTrainFieldErrors>({})
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('active')

  async function fetchTrains() {
    const response = await fetch('/api/v1/firmware-trains', { cache: 'no-store' })
    const payload = (await response.json()) as Payload
    if (!response.ok) throw new Error(payload.error?.message ?? 'Firmware trains could not be loaded.')
    return { records: payload.data ?? [], vendors: payload.meta?.vendors ?? [] }
  }

  useEffect(() => {
    let cancelled = false
    void fetchTrains()
      .then((payload) => {
        if (cancelled) return
        setRecords(payload.records)
        setVendors(payload.vendors)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Firmware trains could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const payload = await fetchTrains()
    setRecords(payload.records)
    setVendors(payload.vendors)
  }

  function resetForm() {
    setForm(initialForm)
    setEditingId(null)
    setFieldErrors({})
  }

  function beginEdit(record: FirmwareTrainRecord) {
    setEditingId(record.id)
    setForm({
      vendorId: record.vendorId,
      platform: record.platform,
      name: record.name,
      notes: record.notes ?? '',
      source: record.source,
      externalProvider: record.externalProvider ?? '',
      externalId: record.externalId ?? '',
      isActive: record.isActive,
    })
    setFieldErrors({})
    setError(null)
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})
    try {
      const response = await fetch(editingId ? `/api/v1/firmware-trains/${editingId}` : '/api/v1/firmware-trains', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'Firmware train could not be saved.')
      }
      setMessage(editingId ? 'Firmware train updated.' : 'Firmware train created.')
      resetForm()
      await reload()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Firmware train could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(record: FirmwareTrainRecord) {
    const response = await fetch(`/api/v1/firmware-trains/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Firmware train could not be updated.')
      return
    }
    setMessage(record.isActive ? 'Firmware train archived.' : 'Firmware train reactivated.')
    await reload()
  }

  async function remove(record: FirmwareTrainRecord) {
    if (!window.confirm(`Permanently delete firmware train ${record.name}? Trains with releases cannot be deleted.`)) return
    const response = await fetch(`/api/v1/firmware-trains/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Firmware train could not be deleted.')
      return
    }
    setMessage('Firmware train deleted.')
    if (editingId === record.id) resetForm()
    await reload()
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return records.filter((record) => {
      if (vendorFilter && record.vendorId !== vendorFilter) return false
      if (archiveFilter === 'active' && !record.isActive) return false
      if (archiveFilter === 'archived' && record.isActive) return false
      if (!needle) return true
      return [record.vendor.name, record.platform, record.name]
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(needle)
    })
  }, [records, search, vendorFilter, archiveFilter])

  return (
    <>
      <PageHeader
        eyebrow="Firmware catalog"
        title="Release trains"
        description="Group exact firmware releases into explicit vendor release families such as 8.13.x or 17.15.x. Train membership is never inferred from the version string."
        actions={
          <Link
            href="/firmware"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Back to releases
          </Link>
        }
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <form onSubmit={save} className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{editingId ? 'Edit release train' : 'Add release train'}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Use the vendor's own train/family label; examples are illustrative, not parsed conventions.</p>
          </div>
          {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>Cancel edit</Button> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Vendor" htmlFor="train-vendor" error={fieldErrors.vendorId}>
            <SelectInput id="train-vendor" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} required>
              <option value="">Select vendor</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.isActive ? '' : ' (archived)'}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Platform / family" htmlFor="train-platform" error={fieldErrors.platform}>
            <TextInput id="train-platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="FortiOS" required />
          </FormField>
          <FormField label="Train name" htmlFor="train-name" error={fieldErrors.name}>
            <TextInput id="train-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="8.13.x" required />
          </FormField>
          <FormField label="Source" htmlFor="train-source" error={fieldErrors.source}>
            <SelectInput id="train-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="MANUAL">MANUAL</option><option value="API">API</option><option value="IMPORT">IMPORT</option>
            </SelectInput>
          </FormField>
          <FormField label="External provider" htmlFor="train-provider" error={fieldErrors.externalProvider}>
            <TextInput id="train-provider" value={form.externalProvider} onChange={(e) => setForm({ ...form, externalProvider: e.target.value })} placeholder="Optional" />
          </FormField>
          <FormField label="External ID" htmlFor="train-external-id" error={fieldErrors.externalId}>
            <TextInput id="train-external-id" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} placeholder="Optional" />
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Notes" htmlFor="train-notes" error={fieldErrors.notes}>
              <TextArea id="train-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FormField>
          </div>
        </div>
        <div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save train' : 'Add train'}</Button></div>
      </form>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-3">
          <TextInput aria-label="Search firmware trains" type="search" placeholder="Search vendor, platform, train…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectInput aria-label="Filter train by vendor" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}><option value="">All vendors</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</SelectInput>
          <SelectInput aria-label="Filter train by archive state" value={archiveFilter} onChange={(e) => setArchiveFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></SelectInput>
        </div>
        {loading ? <LoadingState title="Loading firmware trains" /> : filtered.length === 0 ? <EmptyState title="No release trains match" description="Add a train such as 8.13.x, or adjust the filters." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr><th className="px-4 py-3">Train</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Platform</th><th className="px-4 py-3">Releases</th><th className="px-4 py-3">State</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((record) => (
                  <tr key={record.id} className={record.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3"><Link className="font-semibold text-[var(--accent-light)] hover:underline" href={`/firmware/trains/${record.id}`}>{record.name}</Link></td>
                    <td className="px-4 py-3">{record.vendor.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted-strong)]">{record.platform}</td>
                    <td className="px-4 py-3 tabular-nums">{record.releaseCount}</td>
                    <td className="px-4 py-3 text-xs">{record.isActive ? 'Active' : 'Archived'}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => beginEdit(record)}>Edit</Button><Button variant="ghost" onClick={() => void toggleArchive(record)}>{record.isActive ? 'Archive' : 'Reactivate'}</Button><Button variant="danger" onClick={() => void remove(record)}>Delete</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
