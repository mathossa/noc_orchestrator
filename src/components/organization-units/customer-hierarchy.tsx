'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import { FormField, TextArea, TextInput } from '@/components/ui/form-controls'
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
    totalDevices,
    usesBusinessUnits,
    needle,
  } = buildCustomerHierarchy(units, sites, search)

  return (
    <section id="organization-units" className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            {usesBusinessUnits ? 'Business units and sites' : 'Sites'}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {usesBusinessUnits
              ? `${units.length} business unit${units.length === 1 ? '' : 's'} · ${sites.length} sites · ${totalDevices} devices`
              : `${sites.length} sites · ${totalDevices} devices`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={beginCreate}>Add business unit</Button>
          <ButtonLink href={`/customers/${customerId}/sites`} variant="primary">Add site</ButtonLink>
        </div>
      </div>

      {error ? <p role="alert" className="px-4 py-3 text-sm text-[var(--danger)] sm:px-5">{error}</p> : null}

      {loading ? (
        <p className="px-4 py-5 text-sm text-[var(--muted)] sm:px-5">Loading customer structure…</p>
      ) : (
        <>
          <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 sm:px-5">
            <TextInput
              type="search"
              aria-label="Search customer structure"
              placeholder={usesBusinessUnits ? 'Search business unit or site name/code…' : 'Search site name or code…'}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {!usesBusinessUnits ? (
            <div className="px-4 py-1 sm:px-5">
              <SiteList customerId={customerId} sites={matchingDirectSites} emptyLabel="No sites match." />
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {visibleUnits.map(({ unit, children, matchingChildren }) => (
                <div key={unit.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/customers/${customerId}/sites?organizationUnit=${encodeURIComponent(unit.id)}`}
                          className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
                        >
                          {unit.name}
                        </Link>
                        {unit.code ? <span className="font-mono text-[11px] text-[var(--muted)]">{unit.code}</span> : null}
                        {!unit.isActive ? <span className="text-xs text-[var(--muted)]">Inactive</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {children.length} site{children.length === 1 ? '' : 's'} · {children.reduce((sum, site) => sum + site.deviceCount, 0)} devices
                      </p>
                    </div>
                    <Button variant="ghost" onClick={() => beginEdit(unit)}>Edit</Button>
                  </div>
                  {matchingChildren.length > 0 ? (
                    <div className="mt-3 border-l border-[var(--border-strong)] pl-4">
                      <SiteList customerId={customerId} sites={matchingChildren} />
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--muted)]">No sites in this business unit.</p>
                  )}
                </div>
              ))}

              {directSites.length > 0 && (!needle || matchingDirectSites.length > 0) ? (
                <div className="px-4 py-4 sm:px-5">
                  <Link
                    href={`/customers/${customerId}/sites?organizationUnit=none`}
                    className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
                  >
                    Sites without business unit
                  </Link>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {directSites.length} site{directSites.length === 1 ? '' : 's'} · {directSites.reduce((sum, site) => sum + site.deviceCount, 0)} devices
                  </p>
                  <div className="mt-3 border-l border-[var(--border-strong)] pl-4">
                    <SiteList customerId={customerId} sites={matchingDirectSites} />
                  </div>
                </div>
              ) : null}

              {visibleUnits.length === 0 && matchingDirectSites.length === 0 ? (
                <p className="px-4 py-5 text-sm text-[var(--muted)] sm:px-5">No business units or sites match.</p>
              ) : null}
            </div>
          )}
        </>
      )}

      {formOpen ? (
        <form className="space-y-3 border-t border-[var(--border)] px-4 py-4 sm:px-5" onSubmit={save}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{editing ? 'Edit business unit' : 'Add business unit'}</h3>
            <Button variant="ghost" onClick={closeForm}>Close</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Notes</summary>
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
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeForm}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add business unit'}
            </Button>
          </div>
        </form>
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

function SiteList({
  customerId,
  sites,
  emptyLabel,
}: {
  customerId: string
  sites: SiteRecord[]
  emptyLabel?: string
}) {
  if (sites.length === 0) return emptyLabel ? <p className="py-4 text-sm text-[var(--muted)]">{emptyLabel}</p> : null

  return (
    <ul className="divide-y divide-[var(--border)]">
      {sites.map((site) => (
        <li key={site.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <Link
              className="font-medium text-[var(--foreground)] hover:text-[var(--accent)]"
              href={`/customers/${customerId}/sites/${site.id}`}
            >
              {site.name}
            </Link>
            <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
              {site.code ? <span className="font-mono">{site.code}</span> : null}
              {!site.isActive ? <span>Archived</span> : null}
            </div>
          </div>
          <span className="text-sm tabular-nums text-[var(--muted-strong)]">
            {site.deviceCount} device{site.deviceCount === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  )
}
