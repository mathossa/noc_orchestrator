'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/ui/filter-bar'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { CustomerFieldErrors, CustomerRecord } from '@/lib/customers'

type ContractType = {
  id: string
  code: string
  name: string
  firmwareManagementEnabled: boolean
  isActive: boolean
}

type ApiError = { error?: { message?: string; fields?: CustomerFieldErrors } }
type Payload = { data?: CustomerRecord[]; contractTypes?: ContractType[] } & ApiError

type FormState = {
  name: string
  code: string
  contractTypeId: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

const initialForm: FormState = {
  name: '',
  code: '',
  contractTypeId: '',
  source: 'MANUAL',
  externalProvider: '',
  externalId: '',
  isActive: true,
}

export function CustomerManager() {
  const [records, setRecords] = useState<CustomerRecord[]>([])
  const [contractTypes, setContractTypes] = useState<ContractType[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

  const applyPayload = useCallback((payload: Payload) => {
    setRecords(payload.data ?? [])
    setContractTypes(payload.contractTypes ?? [])
  }, [])

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/customers', { cache: 'no-store' })
    const payload = (await response.json()) as Payload
    if (!response.ok) throw new Error(payload.error?.message ?? 'Customers could not be loaded.')
    return payload
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .then((payload) => {
        if (!cancelled) applyPayload(payload)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Customers could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [applyPayload, load])

  const reload = useCallback(async () => applyPayload(await load()), [applyPayload, load])

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(initialForm)
    setFieldErrors({})
    setError(null)
  }

  function beginCreate() {
    setEditingId(null)
    setForm(initialForm)
    setFieldErrors({})
    setError(null)
    setMessage(null)
    setFormOpen(true)
  }

  function beginEdit(record: CustomerRecord) {
    setEditingId(record.id)
    setForm({
      name: record.name,
      code: record.code ?? '',
      contractTypeId: record.contractTypeId ?? '',
      source: record.source,
      externalProvider: record.externalProvider ?? '',
      externalId: record.externalId ?? '',
      isActive: record.isActive,
    })
    setFieldErrors({})
    setError(null)
    setMessage(null)
    setFormOpen(true)
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})

    try {
      const response = await fetch(editingId ? `/api/v1/customers/${editingId}` : '/api/v1/customers', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'Customer could not be saved.')
      }

      setMessage(editingId ? 'Customer updated.' : 'Customer created.')
      closeForm()
      await reload()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Customer could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(record: CustomerRecord) {
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/customers/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Customer could not be updated.')
      return
    }
    setMessage(record.isActive ? 'Customer archived.' : 'Customer reactivated.')
    closeForm()
    await reload()
  }

  async function deleteCustomer(record: CustomerRecord) {
    if (!window.confirm(`Permanently delete customer ${record.name}? Customers with device, site, policy, or history references cannot be deleted.`)) return
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/customers/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Customer could not be deleted.')
      return
    }
    setMessage('Customer deleted.')
    closeForm()
    await reload()
  }

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return records.filter((record) => {
      if (statusFilter === 'active' && !record.isActive) return false
      if (statusFilter === 'archived' && record.isActive) return false
      if (!needle) return true
      return [record.name, record.code ?? '', record.contractType?.name ?? '', record.externalId ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [records, search, statusFilter])

  const editingRecord = editingId ? records.find((record) => record.id === editingId) ?? null : null
  const activeRecords = records.filter((record) => record.isActive)
  const activeSiteCount = activeRecords.reduce((sum, record) => sum + record.siteCount, 0)
  const activeDeviceCount = activeRecords.reduce((sum, record) => sum + record.deviceCount, 0)

  const columns: Array<DataTableColumn<CustomerRecord>> = [
    {
      key: 'customer',
      header: 'Customer',
      render: (record) => (
        <div>
          <Link href={`/customers/${record.id}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">
            {record.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            {record.code ? <span className="font-mono">{record.code}</span> : null}
            {!record.isActive ? <span>Archived</span> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'units',
      header: 'Business units',
      render: (record) => record.organizationUnitCount || '—',
      numeric: true,
    },
    { key: 'sites', header: 'Sites', render: (record) => record.siteCount, numeric: true },
    { key: 'devices', header: 'Devices', render: (record) => record.deviceCount, numeric: true },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: (record) => <Button variant="ghost" onClick={() => beginEdit(record)}>Edit</Button>,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Inventory structure"
        title="Customers"
        meta={
          <>
            <span>{activeRecords.length} active customers</span>
            <span aria-hidden="true">·</span>
            <span>{activeSiteCount} sites</span>
            <span aria-hidden="true">·</span>
            <span>{activeDeviceCount} devices</span>
          </>
        }
        actions={<Button variant="primary" onClick={beginCreate}>Add customer</Button>}
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <div className="space-y-3">
        <FilterBar>
          <FilterSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer name or code…"
          />
          <FilterSelect
            id="customer-status"
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'all', label: 'All customers' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
        </FilterBar>

        {loading ? (
          <LoadingState title="Loading customers" description="Reading customer structure…" />
        ) : (
          <DataTable
            columns={columns}
            rows={filteredRecords}
            rowKey={(record) => record.id}
            caption="Customers"
            emptyState={<EmptyState title="No customers match" description="Create a customer or adjust the search." />}
          />
        )}
      </div>

      {formOpen ? (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{editingId ? 'Edit customer' : 'Add customer'}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Keep the common fields short; source identity stays in advanced details.</p>
            </div>
            <Button variant="ghost" onClick={closeForm}>Close</Button>
          </div>

          <form className="space-y-4" onSubmit={saveCustomer}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Name" htmlFor="customer-name" error={fieldErrors.name}>
                <TextInput id="customer-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} aria-invalid={Boolean(fieldErrors.name)} required />
              </FormField>
              <FormField label="Code" htmlFor="customer-code" description="Optional shorthand; searchable and stored in uppercase." error={fieldErrors.code}>
                <TextInput id="customer-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} aria-invalid={Boolean(fieldErrors.code)} />
              </FormField>
            </div>

            <FormField label="Default contract type" htmlFor="customer-contract-type" description="Sites inherit this unless they define their own override." error={fieldErrors.contractTypeId}>
              <SelectInput id="customer-contract-type" value={form.contractTypeId} onChange={(event) => setForm({ ...form, contractTypeId: event.target.value })} aria-invalid={Boolean(fieldErrors.contractTypeId)}>
                <option value="">No default contract type</option>
                {contractTypes.map((contract) => (
                  <option key={contract.id} value={contract.id} disabled={!contract.isActive && contract.id !== form.contractTypeId}>
                    {contract.name}{contract.isActive ? '' : ' (archived)'}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <details className="border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Advanced source details</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <FormField label="Source" htmlFor="customer-source" error={fieldErrors.source}>
                  <SelectInput id="customer-source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                    <option value="MANUAL">Manual</option>
                    <option value="API">API</option>
                    <option value="IMPORT">Import</option>
                  </SelectInput>
                </FormField>
                <FormField label="External provider" htmlFor="customer-provider" error={fieldErrors.externalProvider}>
                  <TextInput id="customer-provider" value={form.externalProvider} onChange={(event) => setForm({ ...form, externalProvider: event.target.value })} placeholder="Optional" />
                </FormField>
                <FormField label="External ID" htmlFor="customer-external-id" error={fieldErrors.externalId}>
                  <TextInput id="customer-external-id" value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} placeholder="Optional" />
                </FormField>
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <div className="flex flex-wrap gap-2">
                {editingRecord ? (
                  <>
                    <Button variant="secondary" onClick={() => void toggleArchive(editingRecord)} disabled={saving}>
                      {editingRecord.isActive ? 'Archive' : 'Reactivate'}
                    </Button>
                    <Button variant="danger" onClick={() => void deleteCustomer(editingRecord)} disabled={saving}>Delete</Button>
                  </>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={closeForm}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create customer'}
                </Button>
              </div>
            </div>
          </form>
        </section>
      ) : null}
    </>
  )
}
