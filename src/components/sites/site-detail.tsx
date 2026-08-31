'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import type { SiteDetailRecord } from '@/lib/sites'

type ApiError = { error?: { message?: string } }

export function SiteDetail({ customerId, siteId }: { customerId: string; siteId: string }) {
  const [site, setSite] = useState<SiteDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/customers/${customerId}/sites/${siteId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: SiteDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Site could not be loaded.')
        if (!cancelled) setSite(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Site could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, siteId])

  if (loading) return <LoadingState title="Loading site" description="Reading customer location context…" />
  if (error || !site) {
    return <ErrorState title="Site could not be loaded" description={error ?? 'The site record is unavailable.'} action={<Link href={`/customers/${customerId}/sites`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to sites</Link>} />
  }

  const address = [site.addressLine1, site.addressLine2, [site.postalCode, site.city].filter(Boolean).join(' '), site.region, site.country].filter(Boolean)

  return (
    <>
      <PageHeader
        eyebrow={`${site.customer.name} · Site`}
        title={site.name}
        description="Customer location context used to place inventory at the correct site. Site records do not contain monitoring or health data."
        actions={<div className="flex flex-wrap gap-2"><Link href={`/customers/${customerId}/sites`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage sites</Link><Link href={`/devices?customer=${encodeURIComponent(customerId)}&site=${encodeURIComponent(site.id)}`} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Site devices</Link></div>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Devices" value={site.deviceCount} detail="Inventory records currently assigned to this site." />
        <SummaryStat label="Site code" value={site.code ?? '—'} detail="Optional customer-scoped site identifier." />
        <SummaryStat label="State" value={site.isActive ? 'Active' : 'Archived'} detail="Archiving preserves device and history references." />
        <SummaryStat label="Source" value={site.source} detail="Manual, imported, or synchronized provenance." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Location</h2>
          {address.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">No address details recorded. A full postal address is not required.</p> : <div className="mt-3 space-y-1 text-sm text-[var(--muted-strong)]">{address.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>}
          {site.notes ? <div className="mt-5 border-t border-[var(--border)] pt-4"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Notes</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{site.notes}</p></div> : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Site information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Customer" value={site.customer.name} />
            <DetailRow label="Code" value={site.code ?? '—'} />
            <DetailRow label="Status" value={site.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Source" value={site.source} />
            <DetailRow label="External provider" value={site.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={site.externalId ?? '—'} />
            <DetailRow label="Last synchronized" value={site.lastSynchronizedAt ? new Date(site.lastSynchronizedAt).toLocaleString() : 'Never / manual'} />
            <DetailRow label="Created" value={new Date(site.createdAt).toLocaleString()} />
            <DetailRow label="Updated" value={new Date(site.updatedAt).toLocaleString()} />
          </dl>
        </section>
      </div>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
