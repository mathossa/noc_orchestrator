'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { FilterBar, FilterSearch } from '@/components/ui/filter-bar'
import { FormField, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState } from '@/components/ui/page-state'
import type { OrganizationUnitRecord } from '@/lib/organization-units'
import type { SiteRecord } from '@/lib/sites'

const empty = { name: '', code: '', notes: '' }

export function CustomerHierarchy({ customerId }: { customerId: string }) {
  const [units, setUnits] = useState<OrganizationUnitRecord[]>([])
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const base = `/api/v1/customers/${customerId}`

  const load = useCallback(async () => {
    const responses = await Promise.all([
      fetch(`${base}/organization-units`, { cache: 'no-store' }),
      fetch(`${base}/sites`, { cache: 'no-store' }),
    ])
    const data = await Promise.all(responses.map((response) => response.json()))
    responses.forEach((response, i) => {
      if (!response.ok) throw new Error(data[i].error?.message ?? 'Hierarchy could not be loaded.')
    })
    return {
      units: data[0].data as OrganizationUnitRecord[],
      sites: data[1].data as SiteRecord[],
    }
  }, [base])

  useEffect(() => {
    let cancelled = false
    void load()
      .then((data) => {
        if (!cancelled) {
          setUnits(data.units)
          setSites(data.sites)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Hierarchy could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function mutate(id: string | null, data: unknown) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${base}/organization-units${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message ?? 'Business unit could not be saved.')
      const refreshed = await load()
      setUnits(refreshed.units)
      setSites(refreshed.sites)
      closeForm()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Business unit could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function closeForm() {
    setEditing(null)
    setForm(empty)
    setFormOpen(false)
  }

  function beginCreate() {
    setEditing(null)
    setForm(empty)
    setError('')
    setFormOpen(true)
  }

  function beginEdit(unit: OrganizationUnitRecord) {
    setEditing(unit.id)
    setForm({
      name: unit.name,
      code: unit.code ?? '',
      notes: unit.notes ?? '',
    })
    setError('')
    setFormOpen(true)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    void mutate(editing, form)
  }

  const {
    directSites,
    matchingDirectSites,
    visibleUnits,
    usesBusinessUnits,
  } = buildCustomerHierarchy(units, sites, search)

  const unitColumns: Array<DataTableColumn<(typeof visibleUnits)[number]>> = [
    {
      key: 'unit',
      header: 'Business unit',
      render: ({ unit }) => (
        <div>
          <Link
            href={`/customers/${customerId}/sites?organizationUnit=${encodeURIComponent(unit.id)}`}
            className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
          >
            {unit.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
            {unit.code ? <span className="font-mono">{unit.code}</span> : null}
            {!unit.isActive ? <span>Inactive</span> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'sites',
      header: 'Sites',
      render: ({ children }) => children.length,
      numeric: true,
    },
    {
      key: 'devices',
      header: 'Devices',
      render: ({ children }) => children.reduce((sum, site) => sum + site.deviceCount, 0),
      numeric: true,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: ({ unit }) => (
        <Button variant="ghost" onClick={() => beginEdit(unit)}>
          Edit
        </Button>
      ),
    },
  ]

  return (
    <section id="organization-units" className="space-y-3">
      <FilterBar
        label="Customer structure"
        actions={
          <>
            <Button variant="secondary" onClick={beginCreate}>
              Add business unit
            </Button>
            <ButtonLink href={`/customers/${customerId}/sites`} variant="primary">
              Add site
            </ButtonLink>
          </>
        }
      >
        <FilterSearch
          id="customer-structure-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={usesBusinessUnits ? 'Search business unit or site name/code…' : 'Search site name or code…'}
        />
      </FilterBar>

      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}

      {loading ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-sm text-[var(--muted)]">
          Loading customer structure…
        </div>
      ) : !usesBusinessUnits ? (
        <SiteTable
          customerId={customerId}
          sites={matchingDirectSites}
          caption="Customer sites"
          emptyTitle="No sites match"
        />
      ) : (
        <>
          {visibleUnits.length > 0 ? (
            <DataTable
              columns={unitColumns}
              rows={visibleUnits}
              rowKey={({ unit }) => unit.id}
              caption="Business units"
            />
          ) : null}

          {directSites.length > 0 && matchingDirectSites.length > 0 ? (
            <section className="space-y-2" aria-labelledby="direct-sites-heading">
              <div className="flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <h2 id="direct-sites-heading" className="text-sm font-semibold text-[var(--foreground)]">
                    Sites without business unit
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {matchingDirectSites.length} site{matchingDirectSites.length === 1 ? '' : 's'} ·{' '}
                    {matchingDirectSites.reduce((sum, site) => sum + site.deviceCount, 0)} devices
                  </p>
                </div>
                <ButtonLink
                  href={`/customers/${customerId}/sites?organizationUnit=none`}
                  variant="ghost"
                >
                  View sites
                </ButtonLink>
              </div>
              <SiteTable
                customerId={customerId}
                sites={matchingDirectSites}
                caption="Sites without business unit"
              />
            </section>
          ) : null}

          {visibleUnits.length === 0 && matchingDirectSites.length === 0 ? (
            <EmptyState
              title="No business units or sites match"
              description="Adjust the customer structure search."
            />
          ) : null}
        </>
      )}

      {formOpen ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <form className="space-y-4" onSubmit={save}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">
                  {editing ? 'Edit business unit' : 'Add business unit'}
                </h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Business units remain optional for each customer.
                </p>
              </div>
              <Button variant="ghost" onClick={closeForm}>
                Close
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name" htmlFor="unit-name">
                <TextInput
                  id="unit-name"
                  required
                  maxLength={160}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </FormField>
              <FormField label="Code" htmlFor="unit-code" description="Optional shorthand; searchable.">
                <TextInput
                  id="unit-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </FormField>
            </div>

            <details className="border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">
                Notes
              </summary>
              <div className="mt-3">
                <FormField label="Notes" htmlFor="unit-notes">
                  <TextArea
                    id="unit-notes"
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </FormField>
              </div>
            </details>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <Button variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add business unit'}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </section>
  )
}

export function buildCustomerHierarchy(
  units: OrganizationUnitRecord[],
  sites: SiteRecord[],
  search = '',
) {
  const directSites = sites.filter((site) => !site.organizationUnitId)
  const needle = search.trim().toLocaleLowerCase('en-US')
  const matchingDirectSites = directSites.filter((site) => matchesSite(site, needle))

  const visibleUnits = units
    .map((unit) => {
      const children = sites.filter((site) => site.organizationUnitId === unit.id)
      const matchingChildren = children.filter((site) => matchesSite(site, needle))
      const unitMatches =
        !needle ||
        [unit.name, unit.code ?? '']
          .join(' ')
          .toLocaleLowerCase('en-US')
          .includes(needle)

      return {
        unit,
        children,
        matchingChildren: unitMatches ? children : matchingChildren,
        matches: unitMatches || matchingChildren.length > 0,
      }
    })
    .filter((entry) => entry.matches)

  return {
    directSites,
    matchingDirectSites,
    visibleUnits,
    totalDevices: sites.reduce((sum, site) => sum + site.deviceCount, 0),
    usesBusinessUnits: units.length > 0,
    needle,
  }
}

function matchesSite(site: SiteRecord, needle: string) {
  if (!needle) return true
  return [site.name, site.code ?? '', site.city ?? '', site.region ?? '', site.country ?? '']
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(needle)
}

export function SiteTable({
  customerId,
  sites,
  caption,
  emptyTitle,
}: {
  customerId: string
  sites: SiteRecord[]
  caption: string
  emptyTitle?: string
}) {
  const columns: Array<DataTableColumn<SiteRecord>> = [
    {
      key: 'site',
      header: 'Site',
      render: (site) => (
        <div>
          <Link
            className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
            href={`/customers/${customerId}/sites/${site.id}`}
          >
            {site.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
            {site.code ? <span className="font-mono">{site.code}</span> : null}
            {site.city ? <span>{site.city}</span> : null}
            {!site.isActive ? <span>Archived</span> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'devices',
      header: 'Devices',
      render: (site) => site.deviceCount,
      numeric: true,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: (site) => (
        <ButtonLink
          href={`/customers/${customerId}/sites?edit=${encodeURIComponent(site.id)}`}
          variant="ghost"
        >
          Edit
        </ButtonLink>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={sites}
      rowKey={(site) => site.id}
      caption={caption}
      emptyState={
        emptyTitle ? (
          <EmptyState
            title={emptyTitle}
            description="Add a site or adjust the current search."
          />
        ) : undefined
      }
    />
  )
}
