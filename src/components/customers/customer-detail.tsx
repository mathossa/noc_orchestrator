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
        description="Firmware lifecycle context for this customer. Monitoring and unrelated operational health data are intentionally excluded."
        actions={
          <div className="flex gap-2">
            <Link href="/customers" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">
              Manage customers
            </Link>
            <Link href={`/devices?customer=${encodeURIComponent(customer.id)}`} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">
              Customer devices
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Devices" value={customer.deviceCount} detail="Inventory records assigned to this customer." />
        <SummaryStat label="Desired state current" value="—" detail="Canonical compliance resolution arrives in Issue #10." />
        <SummaryStat label="Needs attention" value="—" detail="Canonical compliance resolution arrives in Issue #10." />
        <SummaryStat label="Planned" value={customer.workflowCounts.planned} detail="Devices with a current planned lifecycle decision." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
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
          {!customer.desiredStateSummary.available ? (
            <div className="border-t border-[var(--border)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
              Desired-state compliant vs action-required totals are deliberately not approximated here. Issue #10 will provide the single canonical resolver used across customers, devices, filters, and dashboards.
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Customer information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Code" value={customer.code ?? '—'} />
            <DetailRow label="Status" value={customer.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Contract" value={customer.contractType?.name ?? 'No contract type'} />
            <DetailRow
              label="Firmware management"
              value={customer.contractType ? (customer.contractType.firmwareManagementEnabled ? 'Enabled by contract' : 'Disabled by contract') : 'No contract capability set'}
            />
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
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd>
    </div>
  )
}
