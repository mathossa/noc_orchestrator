'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
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

  if (loading) return <LoadingState title="Loading site" description="Reading site context…" />
  if (error || !site) {
    return (
      <ErrorState
        title="Site could not be loaded"
        description={error ?? 'The site record is unavailable.'}
        action={<Link href={`/customers/${customerId}/sites`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to sites</Link>}
      />
    )
  }

  const address = [
    site.addressLine1,
    site.addressLine2,
    [site.postalCode, site.city].filter(Boolean).join(' '),
    site.region,
    site.country,
  ].filter(Boolean)

  const breadcrumbs = [
    { label: 'Customers', href: '/customers' },
    { label: site.customer.name, href: `/customers/${customerId}` },
    ...(site.organizationUnit
      ? [{
          label: site.organizationUnit.name,
          href: `/customers/${customerId}/sites?organizationUnit=${encodeURIComponent(site.organizationUnit.id)}`,
        }]
      : []),
    { label: site.name },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Site"
        title={site.name}
        breadcrumbs={breadcrumbs}
        meta={
          <>
            {site.code ? <span className="font-mono">{site.code}</span> : null}
            {site.code ? <span aria-hidden="true">·</span> : null}
            <span>{site.deviceCount} device{site.deviceCount === 1 ? '' : 's'}</span>
            {site.effectiveContractType ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{site.effectiveContractType.name}</span>
              </>
            ) : null}
            {!site.isActive ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Archived</span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <ButtonLink href={`/customers/${customerId}/sites`}>Manage sites</ButtonLink>
            <ButtonLink href={`/devices?customer=${encodeURIComponent(customerId)}&site=${encodeURIComponent(site.id)}`} variant="primary">
              Site devices
            </ButtonLink>
          </>
        }
      />

      <section>
        <h2 className="text-base font-semibold text-[var(--foreground)]">Location</h2>
        {address.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No address details recorded.</p>
        ) : (
          <div className="mt-2 space-y-1 text-sm text-[var(--muted-strong)]">
            {address.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
        )}

        {site.notes ? (
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Notes</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{site.notes}</p>
          </div>
        ) : null}
      </section>

      <details className="mt-6 border-t border-[var(--border)] pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Site details</summary>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {site.organizationUnit ? <DetailRow label="Business unit" value={site.organizationUnit.name} /> : null}
          <DetailRow label="Contract" value={site.effectiveContractType?.name ?? '—'} />
          <DetailRow label="Contract source" value={site.contractSource === 'SITE' ? 'Site override' : site.contractSource === 'CUSTOMER' ? 'Customer default' : 'No contract'} />
          {site.contractSource === 'SITE' ? <DetailRow label="Customer default" value={site.customer.contractType?.name ?? 'No customer default'} /> : null}
          <DetailRow label="Status" value={site.isActive ? 'Active' : 'Archived'} />
          <DetailRow label="Source" value={site.source} />
          <DetailRow label="External provider" value={site.externalProvider ?? '—'} />
          <DetailRow label="External ID" value={site.externalId ?? '—'} />
          <DetailRow label="Last synchronized" value={site.lastSynchronizedAt ? new Date(site.lastSynchronizedAt).toLocaleString() : 'Never / manual'} />
          <DetailRow label="Created" value={new Date(site.createdAt).toLocaleString()} />
          <DetailRow label="Updated" value={new Date(site.updatedAt).toLocaleString()} />
        </dl>
        <div className="mt-4">
          <ButtonLink href={`/firmware/exceptions?scope=SITE&scopeId=${encodeURIComponent(siteId)}`} variant="ghost">
            Site exceptions
          </ButtonLink>
        </div>
      </details>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-b border-[var(--border)] pb-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 min-w-0 break-words text-[var(--muted-strong)]">{value}</dd>
    </div>
  )
}
