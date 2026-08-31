'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import type { CustomerDetailRecord } from '@/lib/customers'

type ApiError = { error?: { message?: string } }

export function CustomerDetail({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/customers/${customerId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: CustomerDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Customer could not be loaded.')
        if (!cancelled) setCustomer(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Customer could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [customerId])

  if (loading) return <LoadingState title="Loading customer" description="Reading firmware lifecycle context…" />
  if (error || !customer) {
    return (
      <ErrorState
        title="Customer could not be loaded"
        description={error ?? 'The customer record is unavailable.'}
        action={<Link href="/customers" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to customers</Link>}
      />
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer"
        title={customer.name}
        description="Firmware lifecycle context for this customer. Technical desired-state compliance and operational workflow decisions are shown independently."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/customers" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage customers</Link>
            <Link href={`/customers/${customer.id}/sites`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage sites</Link>
            <Link href={`/devices?customer=${encodeURIComponent(customer.id)}`} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Customer devices</Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryStat label="Devices" value={customer.deviceCount} detail="Inventory records assigned to this customer." />
        <SummaryStat label="Sites" value={customer.siteCount} detail="Customer locations; sites may override the default contract." />
        <SummaryStat label="Desired state current" value={customer.desiredStateSummary.current} detail="Devices on the exact desired firmware release." />
        <SummaryStat label="Needs attention" value={customer.desiredStateSummary.actionRequired} detail="Recorded current release differs from desired." />
        <SummaryStat label="Planned" value={customer.workflowCounts.planned} detail="Operational workflow state, separate from compliance." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div><h2 className="text-sm font-semibold">Sites</h2><p className="mt-1 text-xs text-[var(--muted)]">Customer locations used to place devices and optionally override the customer default contract.</p></div>
              <Link href={`/customers/${customer.id}/sites`} className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Manage sites</Link>
            </div>
            {customer.sites.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">No sites configured. Devices may remain unassigned to a site until one is known.</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {customer.sites.map((site) => (
                  <div key={site.id} className={`flex items-center justify-between gap-4 px-4 py-3 ${site.isActive ? '' : 'opacity-60'}`}>
                    <div className="min-w-0">
                      <Link href={`/customers/${customer.id}/sites/${site.id}`} className="font-medium text-[var(--foreground)] hover:text-[var(--accent-light)]">{site.name}</Link>
                      <div className="mt-1 text-xs text-[var(--muted)]">{[site.code, site.city, site.country].filter(Boolean).join(' · ') || 'No code or location details'}</div>
                    </div>
                    <Link href={`/devices?customer=${encodeURIComponent(customer.id)}&site=${encodeURIComponent(site.id)}`} className="shrink-0 text-sm tabular-nums text-[var(--accent-light)] hover:underline">{site.deviceCount} device{site.deviceCount === 1 ? '' : 's'}</Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Technical firmware state</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Exact current-versus-desired comparison. Version strings are never treated as SemVer or ordered implicitly.</p>
            </div>
            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Current', customer.desiredStateSummary.current],
                ['Action required', customer.desiredStateSummary.actionRequired],
                ['Unknown current', customer.desiredStateSummary.unknown],
                ['No policy', customer.desiredStateSummary.noPolicy],
              ].map(([label, value]) => (
                <div key={label} className="bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Lifecycle summary</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Workflow decisions remain separate from technical firmware compliance.</p>
            </div>
            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Planned', customer.workflowCounts.planned],
                ['Ignored', customer.workflowCounts.ignored],
                ['Customer declined', customer.workflowCounts.customerDeclined],
                ['Done', customer.workflowCounts.done],
              ].map(([label, value]) => (
                <div key={label} className="bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Customer information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Code" value={customer.code ?? '—'} />
            <DetailRow label="Status" value={customer.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Default contract" value={customer.contractType?.name ?? 'No default contract'} />
            <DetailRow label="Default firmware management" value={customer.contractType ? (customer.contractType.firmwareManagementEnabled ? 'Enabled by contract' : 'Disabled by contract') : 'No default contract capability set'} />
            <DetailRow label="Source" value={customer.source} />
            <DetailRow label="External provider" value={customer.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={customer.externalId ?? '—'} />
            <DetailRow label="Last synchronized" value={customer.lastSynchronizedAt ? new Date(customer.lastSynchronizedAt).toLocaleString() : 'Never / manual'} />
          </dl>
        </section>
      </div>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
