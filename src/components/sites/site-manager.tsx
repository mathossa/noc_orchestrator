'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { CustomerDetailRecord } from '@/lib/customers'
import type { SiteFieldErrors, SiteRecord } from '@/lib/sites'

type ApiError = { error?: { message?: string; fields?: SiteFieldErrors } }
type FormState = {
  name: string
  code: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  city: string
  region: string
  country: string
  notes: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

const initialForm: FormState = {
  name: '',
  code: '',
  addressLine1: '',
  addressLine2: '',
  postalCode: '',
  city: '',
  region: '',
  country: '',
  notes: '',
  source: 'MANUAL',
  externalProvider: '',
  externalId: '',
  isActive: true,
}

export function SiteManager({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetailRecord | null>(null)
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<SiteFieldErrors>({})
  const [search, setSearch] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('active')

  const load = useCallback(async () => {
    const [customerResponse, siteResponse] = await Promise.all([
      fetch(`/api/v1/customers/${customerId}`, { cache: 'no-store' }),
      fetch(`/api/v1/customers/${customerId}/sites`, { cache: 'no-store' }),
    ])
    const customerPayload = (await customerResponse.json()) as { data?: CustomerDetailRecord } & ApiError
    const sitePayload = (await siteResponse.json()) as { data?: SiteRecord[] } & ApiError
    if (!customerResponse.ok) throw new Error(customerPayload.error?.message ?? 'Customer could not be loaded.')
    if (!siteResponse.ok) throw new Error(sitePayload.error?.message ?? 'Sites could not be loaded.')
    return { customer: customerPayload.data ?? null, sites: sitePayload.data ?? [] }
  }, [customerId])

  useEffect(() => {
    let cancelled = false
    void load()
      .then((payload) => {
        if (cancelled) return
        setCustomer(payload.customer)
        setSites(payload.sites)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Sites could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function reload() {
    const payload = await load()
    setCustomer(payload.customer)
    setSites(payload.sites)
  }

  function resetForm() {
    setEditingId(null)
    setForm(initialForm)
    setFieldErrors({})
  }

  function beginEdit(site: SiteRecord) {
    setEditingId(site.id)
    setForm({
      name: site.name,
      code: site.code ?? '',
      addressLine1: site.addressLine1 ?? '',
      addressLine2: site.addressLine2 ?? '',
      postalCode: site.postalCode ?? '',
      city: site.city ?? '',
      region: site.region ?? '',
      country: site.country ?? '',
      notes: site.notes ?? '',
      source: site.source,
      externalProvider: site.externalProvider ?? '',
      externalId: site.externalId ?? '',
      isActive: site.isActive,
    })
    setError(null)
    setMessage(null)
    setFieldErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})
    try {
      const response = await fetch(
        editingId
          ? `/api/v1/customers/${customerId}/sites/${editingId}`
          : `/api/v1/customers/${customerId}/sites`,
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(form),
        },
      )
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'Site could not be saved.')
      }
      setMessage(editingId ? 'Site updated.' : 'Site added.')
      resetForm()
      await reload()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Site could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(site: SiteRecord) {
    const response = await fetch(`/api/v1/customers/${customerId}/sites/${site.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !site.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Site could not be updated.')
      return
    }
    setMessage(site.isActive ? 'Site archived.' : 'Site reactivated.')
    await reload()
  }

  async function remove(site: SiteRecord) {
    if (!window.confirm(`Permanently delete site ${site.name}? Sites with device/history references cannot be deleted.`)) return
    const response = await fetch(`/api/v1/customers/${customerId}/sites/${site.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Site could not be deleted.')
      return
    }
    setMessage('Site deleted.')
    if (editingId === site.id) resetForm()
    await reload()
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return sites.filter((site) => {
      if (archiveFilter === 'active' && !site.isActive) return false
      if (archiveFilter === 'archived' && site.isActive) return false
      if (!needle) return true
      return [site.name, site.code ?? '', site.city ?? '', site.region ?? '', site.country ?? '']
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(needle)
    })
  }, [sites, search, archiveFilter])

  if (loading) return <LoadingState title="Loading customer sites" description="Reading customer location records…" />

  return (
    <>
      <PageHeader
        eyebrow="Customer sites"
        title={customer ? `${customer.name} sites` : 'Customer sites'}
        description="Manage physical or logical customer locations used to place devices in the correct customer context."
        actions={<Link href={`/customers/${customerId}`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to customer</Link>}
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <form onSubmit={save} className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{editingId ? 'Edit site' : 'Add site'}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Only a name is required. Address details can stay partial when the source does not provide a full postal address.</p>
          </div>
          {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>Cancel edit</Button> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Site name" htmlFor="site-name" error={fieldErrors.name}>
            <TextInput id="site-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Head office" required />
          </FormField>
          <FormField label="Code" htmlFor="site-code" error={fieldErrors.code}>
            <TextInput id="site-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="HQ" />
          </FormField>
          <FormField label="City" htmlFor="site-city" error={fieldErrors.city}>
            <TextInput id="site-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </FormField>
          <FormField label="Country" htmlFor="site-country" error={fieldErrors.country}>
            <TextInput id="site-country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </FormField>
          <FormField label="Address line 1" htmlFor="site-address-1" error={fieldErrors.addressLine1}>
            <TextInput id="site-address-1" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
          </FormField>
          <FormField label="Address line 2" htmlFor="site-address-2" error={fieldErrors.addressLine2}>
            <TextInput id="site-address-2" value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
          </FormField>
          <FormField label="Postal code" htmlFor="site-postal" error={fieldErrors.postalCode}>
            <TextInput id="site-postal" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
          </FormField>
          <FormField label="Region / state" htmlFor="site-region" error={fieldErrors.region}>
            <TextInput id="site-region" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          </FormField>
          <div className="md:col-span-2 xl:col-span-4">
            <FormField label="Notes" htmlFor="site-notes" error={fieldErrors.notes}>
              <TextArea id="site-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FormField>
          </div>
        </div>

        <details className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <summary className="cursor-pointer text-sm font-semibold">Advanced / synchronization</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <FormField label="Source" htmlFor="site-source" error={fieldErrors.source}>
              <SelectInput id="site-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="MANUAL">MANUAL</option><option value="API">API</option><option value="IMPORT">IMPORT</option>
              </SelectInput>
            </FormField>
            <FormField label="External provider" htmlFor="site-provider" error={fieldErrors.externalProvider}>
              <TextInput id="site-provider" value={form.externalProvider} onChange={(e) => setForm({ ...form, externalProvider: e.target.value })} />
            </FormField>
            <FormField label="External ID" htmlFor="site-external-id" error={fieldErrors.externalId}>
              <TextInput id="site-external-id" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />
            </FormField>
          </div>
        </details>

        <div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save site' : 'Add site'}</Button></div>
      </form>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <TextInput type="search" aria-label="Search sites" placeholder="Search name, code, city, region, country…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectInput aria-label="Filter by archive state" value={archiveFilter} onChange={(e) => setArchiveFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></SelectInput>
        </div>
        {filtered.length === 0 ? <EmptyState title="No sites match" description="Add a customer site or adjust the filters." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Site</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Devices</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">State</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((site) => (
                  <tr key={site.id} className={site.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3"><Link href={`/customers/${customerId}/sites/${site.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{site.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{site.code ?? 'No code'}</div></td>
                    <td className="px-4 py-3 text-[var(--muted-strong)]">{[site.city, site.region, site.country].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{site.deviceCount}</td>
                    <td className="px-4 py-3 text-xs">{site.source}</td>
                    <td className="px-4 py-3 text-xs">{site.isActive ? 'Active' : 'Archived'}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => beginEdit(site)}>Edit</Button><Button variant="ghost" onClick={() => void toggleArchive(site)}>{site.isActive ? 'Archive' : 'Reactivate'}</Button><Button variant="danger" onClick={() => void remove(site)}>Delete</Button></div></td>
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
