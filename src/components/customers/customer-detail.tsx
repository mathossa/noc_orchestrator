'use client'

import Link from 'next/link'
import { CustomerHierarchy } from '@/components/organization-units/customer-hierarchy'
import { useEffect, useState } from 'react'
import { ButtonLink } from '@/components/ui/button'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
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

  if (loading) return <LoadingState title="Loading customer" description="Reading customer structure…" />
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
        breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: customer.name }]}
        meta={
          <>
            {customer.code ? <span className="font-mono">{customer.code}</span> : null}
            {customer.code ? <span aria-hidden="true">·</span> : null}
            {customer.organizationUnitCount > 0 ? (
              <>
                <span>{customer.organizationUnitCount} business unit{customer.organizationUnitCount === 1 ? '' : 's'}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>{customer.siteCount} sites</span>
            <span aria-hidden="true">·</span>
            <span>{customer.deviceCount} devices</span>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/customers/${customer.id}/sites`}>Manage sites</ButtonLink>
            <ButtonLink href={`/devices?customer=${encodeURIComponent(customer.id)}`} variant="primary">Customer devices</ButtonLink>
          </>
        }
      />

      <CustomerHierarchy customerId={customerId} />

      <details className="mt-6 border-t border-[var(--border)] pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--muted-strong)]">Customer details</summary>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <DetailRow label="Status" value={customer.isActive ? 'Active' : 'Archived'} />
          <DetailRow label="Default contract" value={customer.contractType?.name ?? 'No default contract'} />
          <DetailRow
            label="Firmware management"
            value={
              customer.contractType
                ? customer.contractType.firmwareManagementEnabled
                  ? 'Enabled by contract'
                  : 'Disabled by contract'
                : 'No default contract'
            }
          />
          <DetailRow label="Source" value={customer.source} />
          <DetailRow label="External provider" value={customer.externalProvider ?? '—'} />
          <DetailRow label="External ID" value={customer.externalId ?? '—'} />
          <DetailRow label="Last synchronized" value={customer.lastSynchronizedAt ? new Date(customer.lastSynchronizedAt).toLocaleString() : 'Never / manual'} />
        </dl>
        <div className="mt-4">
          <ButtonLink href={`/firmware/exceptions?scope=CUSTOMER&scopeId=${encodeURIComponent(customerId)}`} variant="ghost">
            Customer exceptions
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
