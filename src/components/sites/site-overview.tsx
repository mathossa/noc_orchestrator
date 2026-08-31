'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { SiteRecord } from '@/lib/sites'

type ApiError = { error?: { message?: string } }

async function fetchSites() {
  const response = await fetch('/api/v1/sites', { cache: 'no-store' })
  const payload = (await response.json()) as { data?: SiteRecord[] } & ApiError
  if (!response.ok) throw new Error(payload.error?.message ?? 'Sites could not be loaded.')
  return payload.data ?? []
}

export function SiteOverview() {
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('active')

  useEffect(() => {
    let cancelled = false
    void fetchSites()
      .then((records) => {
        if (!cancelled) setSites(records)
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
  }, [])

  const customers = useMemo(() => {
    const byId = new Map<string, SiteRecord['customer']>()
    for (const site of sites) byId.set(site.customer.id, site.customer)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [sites])

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return sites.filter((site) => {
      if (customerFilter && site.customerId !== customerFilter) return false
      if (archiveFilter === 'active' && !site.isActive) return false
      if (archiveFilter === 'archived' && site.isActive) return false
      if (!needle) return true

      return [
        site.customer.name,
        site.customer.code ?? '',
        site.name,
        site.code ?? '',
        site.city ?? '',
        site.region ?? '',
        site.country ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(needle)
    })
  }, [sites, search, customerFilter, archiveFilter])

  return (
    <>
      <PageHeader
        eyebrow="Customer inventory"
        title="Sites"
        description="Browse customer locations across the organization. Create and edit sites from the owning customer context."
      />

      {error ? (
        <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">
          {error}
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-3">
          <TextInput
            type="search"
            aria-label="Search sites"
            placeholder="Search customer, site, city, country…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SelectInput
            aria-label="Filter sites by customer"
            value={customerFilter}
            onChange={(event) => setCustomerFilter(event.target.value)}
          >
            <option value="">All customers</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}{customer.isActive ? '' : ' (archived)'}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            aria-label="Filter sites by archive state"
            value={archiveFilter}
            onChange={(event) => setArchiveFilter(event.target.value)}
          >
            <option value="active">Active sites</option>
            <option value="archived">Archived sites</option>
            <option value="all">All sites</option>
          </SelectInput>
        </div>

        {loading ? (
          <LoadingState title="Loading sites" description="Reading customer location inventory…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No sites match" description="Adjust the filters or add sites from a customer page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Devices</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((site) => (
                  <tr key={site.id} className={site.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${site.customerId}/sites/${site.id}`}
                        className="font-semibold text-[var(--accent-light)] hover:underline"
                      >
                        {site.name}
                      </Link>
                      <div className="mt-1 font-mono text-xs text-[var(--muted)]">{site.code ?? 'No code'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/customers/${site.customerId}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)]">
                        {site.customer.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-strong)]">
                      {[site.city, site.region, site.country].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{site.deviceCount}</td>
                    <td className="px-4 py-3 text-xs">{site.source}</td>
                    <td className="px-4 py-3 text-xs">{site.isActive ? 'Active' : 'Archived'}</td>
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
