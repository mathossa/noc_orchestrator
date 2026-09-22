'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/ui/filter-bar'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { CustomerDetailRecord } from '@/lib/customers'
import type { OrganizationUnitRecord } from '@/lib/organization-units'
import type { SiteContractReference, SiteFieldErrors, SiteRecord } from '@/lib/sites'

type ApiError = { error?: { message?: string; fields?: SiteFieldErrors } }
type SitePayload = { data?: SiteRecord[]; contractTypes?: SiteContractReference[] } & ApiError
type UnitPayload = { data?: OrganizationUnitRecord[] } & ApiError

type FormState = {
  organizationUnitId: string
  name: string
  code: string
  contractTypeId: string
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
  organizationUnitId: '',
  name: '',
  code: '',
  contractTypeId: '',
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

export function SiteManager({ customerId, initialOrganizationUnit = '' }: { customerId: string; initialOrganizationUnit?: string }) {
  const [customer, setCustomer] = useState<CustomerDetailRecord | null>(null)
  const [units, setUnits] = useState<OrganizationUnitRecord[]>([])
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [contractTypes, setContractTypes] = useState<SiteContractReference[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<SiteFieldErrors>({})
  const [search, setSearch] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('active')
  const [unitFilter, setUnitFilter] = useState(initialOrganizationUnit)

  const load = useCallback(async () => {
    const [customerResponse, siteResponse, unitResponse] = await Promise.all([
      fetch(`/api/v1/customers/${customerId}`, { cache: 'no-store' }),
      fetch(`/api/v1/customers/${customerId}/sites`, { cache: 'no-store' }),
      fetch(`/api/v1/customers/${customerId}/organization-units`, { cache: 'no-store' }),
    ])
    const customerPayload = (await customerResponse.json()) as { data?: CustomerDetailRecord } & ApiError
    const sitePayload = (await siteResponse.json()) as SitePayload
    const unitPayload = (await unitResponse.json()) as UnitPayload

    if (!customerResponse.ok) throw new Error(customerPayload.error?.message ?? 'Customer could not be loaded.')
    if (!siteResponse.ok) throw new Error(sitePayload.error?.message ?? 'Sites could not be loaded.')
    if (!unitResponse.ok) throw new Error(unitPayload.error?.message ?? 'Business units could not be loaded.')

    return {
      customer: customerPayload.data ?? null,
      sites: sitePayload.data ?? [],
      contractTypes: sitePayload.contractTypes ?? [],
      units: unitPayload.data ?? [],
    }
  }, [customerId])

  useEffect(() => {
    let cancelled = false
    void load()
      .then((payload) => {
        if (cancelled) return
        setCustomer(payload.customer)
        setSites(payload.sites)
        setContractTypes(payload.contractTypes)
        setUnits(payload.units)
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
    setContractTypes(payload.contractTypes)
    setUnits(payload.units)
  }

  function closeForm() {
    setEditingId(null)
    setForm(initialForm)
    setFieldErrors({})
    setError(null)
    setFormOpen(false)
  }

  function beginCreate() {
    setEditingId(null)
    setForm({
      ...initialForm,
      organizationUnitId: unitFilter && unitFilter !== 'none' ? unitFilter : '',
    })
    setFieldErrors({})
    setError(null)
    setMessage(null)
    setFormOpen(true)
  }

  function beginEdit(site: SiteRecord) {
    setEditingId(site.id)
    setForm({
      organizationUnitId: site.organizationUnitId ?? '',
      name: site.name,
      code: site.code ?? '',
      contractTypeId: site.contractTypeId ?? '',
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
    setFormOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})

    try {
      const response = await fetch(
        editingId ? `/api/v1/customers/${customerId}/sites/${editingId}` : `/api/v1/customers/${customerId}/sites`,
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
      closeForm()
      await reload()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Site could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(site: SiteRecord) {
    setError(null)
    setMessage(null)
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
    closeForm()
    await reload()
  }

  async function remove(site: SiteRecord) {
    if (!window.confirm(`Permanently delete site ${site.name}? Sites with device/history references cannot be deleted.`)) return
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/customers/${customerId}/sites/${site.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Site could not be deleted.')
      return
    }
    setMessage('Site deleted.')
    closeForm()
    await reload()
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return sites.filter((site) => {
      if (unitFilter && (site.organizationUnitId ?? 'none') !== unitFilter) return false
      if (archiveFilter === 'active' && !site.isActive) return false
      if (archiveFilter === 'archived' && site.isActive) return false
      if (!needle) return true
      return [
        site.name,
        site.code ?? '',
        site.organizationUnit?.name ?? '',
        site.city ?? '',
        site.region ?? '',
        site.country ?? '',
        site.effectiveContractType?.name ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(needle)
    })
  }, [sites, search, archiveFilter, unitFilter])

  const editingSite = editingId ? sites.find((site) => site.id === editingId) ?? null : null
  const activeSites = sites.filter((site) => site.isActive)
  const deviceCount = activeSites.reduce((sum, site) => sum + site.deviceCount, 0)
  const inheritedContractLabel = customer?.contractType?.name
    ? `Inherit customer default — ${customer.contractType.name}`
    : 'Inherit customer default — no contract assigned'

  const columns: Array<DataTableColumn<SiteRecord>> = [
    {
      key: 'site',
      header: 'Site',
      render: (site) => (
        <div>
          <Link href={`/customers/${customerId}/sites/${site.id}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">
            {site.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
            {site.code ? <span className="font-mono">{site.code}</span> : null}
            {!site.isActive ? <span>Archived</span> : null}
          </div>
        </div>
      ),
    },
    ...(units.length > 0
      ? [{
          key: 'unit',
          header: 'Business unit',
          render: (site: SiteRecord) => site.organizationUnit?.name ?? 'None',
        } satisfies DataTableColumn<SiteRecord>]
      : []),
    {
      key: 'location',
      header: 'Location',
      render: (site) => [site.city, site.region, site.country].filter(Boolean).join(', ') || '—',
    },
    { key: 'devices', header: 'Devices', render: (site) => site.deviceCount, numeric: true },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: (site) => <Button variant="ghost" onClick={() => beginEdit(site)}>Edit</Button>,
    },
  ]

  if (loading) return <LoadingState title="Loading customer sites" description="Reading customer structure…" />

  return (
    <>
      <PageHeader
        eyebrow="Customer sites"
        title={customer ? customer.name : 'Customer sites'}
        breadcrumbs={[
          { label: 'Customers', href: '/customers' },
          ...(customer ? [{ label: customer.name, href: `/customers/${customerId}` }] : []),
          { label: 'Sites' },
        ]}
        meta={
          <>
            <span>{activeSites.length} active sites</span>
            <span aria-hidden="true">·</span>
            <span>{deviceCount} devices</span>
            {units.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{units.length} business unit{units.length === 1 ? '' : 's'}</span>
              </>
            ) : null}
          </>
        }
        actions={<Button variant="primary" onClick={beginCreate}>Add site</Button>}
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <div className="space-y-3">
        <FilterBar>
          <FilterSearch
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search site name, code, location…"
          />
          {units.length > 0 ? (
            <FilterSelect
              id="site-unit-filter"
              label="Business unit"
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              options={[
                { value: '', label: 'All business units' },
                { value: 'none', label: 'No business unit' },
                ...units.map((unit) => ({
                  value: unit.id,
                  label: `${unit.name}${unit.isActive ? '' : ' (inactive)'}`,
                })),
              ]}
            />
          ) : null}
          <FilterSelect
            id="site-status-filter"
            label="Status"
            value={archiveFilter}
            onChange={(event) => setArchiveFilter(event.target.value)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'all', label: 'All sites' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(site) => site.id}
          caption="Customer sites"
          emptyState={<EmptyState title="No sites match" description="Add a site or adjust the current search." />}
        />
      </div>

      {formOpen ? (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{editingId ? 'Edit site' : 'Add site'}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Keep the common site identity short; location and source details stay optional.</p>
            </div>
            <Button variant="ghost" onClick={closeForm}>Close</Button>
          </div>

          <form className="space-y-4" onSubmit={save}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Site name" htmlFor="site-name" error={fieldErrors.name}>
                <TextInput id="site-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </FormField>
              <FormField label="Code" htmlFor="site-code" description="Optional shorthand; searchable." error={fieldErrors.code}>
                <TextInput id="site-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
              </FormField>
              {units.length > 0 ? (
                <FormField label="Business unit" htmlFor="site-unit">
                  <SelectInput id="site-unit" value={form.organizationUnitId} onChange={(event) => setForm({ ...form, organizationUnitId: event.target.value })}>
                    <option value="">No business unit</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id} disabled={!unit.isActive && unit.id !== form.organizationUnitId}>
                        {unit.name}{unit.isActive ? '' : ' (inactive)'}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              ) : null}
              <FormField label="Contract" htmlFor="site-contract" description="Optional site override." error={fieldErrors.contractTypeId}>
                <SelectInput id="site-contract" value={form.contractTypeId} onChange={(event) => setForm({ ...form, contractTypeId: event.target.value })}>
                  <option value="">{inheritedContractLabel}</option>
                  {contractTypes.map((contract) => (
                    <option key={contract.id} value={contract.id} disabled={!contract.isActive && contract.id !== form.contractTypeId}>
                      {contract.name}{contract.isActive ? '' : ' (archived)'}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
            </div>

            <details className="border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Location and notes</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <FormField label="Address line 1" htmlFor="site-address-1" error={fieldErrors.addressLine1}>
                  <TextInput id="site-address-1" value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} />
                </FormField>
                <FormField label="Address line 2" htmlFor="site-address-2" error={fieldErrors.addressLine2}>
                  <TextInput id="site-address-2" value={form.addressLine2} onChange={(event) => setForm({ ...form, addressLine2: event.target.value })} />
                </FormField>
                <FormField label="Postal code" htmlFor="site-postal" error={fieldErrors.postalCode}>
                  <TextInput id="site-postal" value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} />
                </FormField>
                <FormField label="City" htmlFor="site-city" error={fieldErrors.city}>
                  <TextInput id="site-city" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                </FormField>
                <FormField label="Region / state" htmlFor="site-region" error={fieldErrors.region}>
                  <TextInput id="site-region" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} />
                </FormField>
                <FormField label="Country" htmlFor="site-country" error={fieldErrors.country}>
                  <TextInput id="site-country" value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} />
                </FormField>
                <div className="md:col-span-2 xl:col-span-3">
                  <FormField label="Notes" htmlFor="site-notes" error={fieldErrors.notes}>
                    <TextArea id="site-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                  </FormField>
                </div>
              </div>
            </details>

            <details className="border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Advanced source details</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <FormField label="Source" htmlFor="site-source" error={fieldErrors.source}>
                  <SelectInput id="site-source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                    <option value="MANUAL">Manual</option>
                    <option value="API">API</option>
                    <option value="IMPORT">Import</option>
                  </SelectInput>
                </FormField>
                <FormField label="External provider" htmlFor="site-provider" error={fieldErrors.externalProvider}>
                  <TextInput id="site-provider" value={form.externalProvider} onChange={(event) => setForm({ ...form, externalProvider: event.target.value })} />
                </FormField>
                <FormField label="External ID" htmlFor="site-external-id" error={fieldErrors.externalId}>
                  <TextInput id="site-external-id" value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} />
                </FormField>
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <div className="flex flex-wrap gap-2">
                {editingSite ? (
                  <>
                    <Button variant="secondary" onClick={() => void toggleArchive(editingSite)} disabled={saving}>
                      {editingSite.isActive ? 'Archive' : 'Reactivate'}
                    </Button>
                    <Button variant="danger" onClick={() => void remove(editingSite)} disabled={saving}>Delete</Button>
                  </>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={closeForm}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add site'}
                </Button>
              </div>
            </div>
          </form>
        </section>
      ) : null}
    </>
  )
}
