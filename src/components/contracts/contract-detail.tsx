'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { deviceFilterHref, technicalStateDeviceHref, workflowDeviceHref } from '@/lib/drilldown-links'
import type { ContractDrilldownRecord } from '@/lib/firmware-drilldowns'

type ApiError = { error?: { message?: string } }

export function ContractDetail({ contractId }: { contractId: string }) {
  const [contract, setContract] = useState<ContractDrilldownRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/contracts/${contractId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: ContractDrilldownRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Contract type could not be loaded.')
        if (!cancelled) setContract(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Contract type could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [contractId])

  if (loading) return <LoadingState title="Loading contract type" description="Resolving effective contract applicability and firmware lifecycle counts…" />
  if (error || !contract) {
    return <ErrorState title="Contract type could not be loaded" description={error ?? 'The contract record is unavailable.'} action={<Link href="/contracts" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to contract types</Link>} />
  }

  const scope = { contract: contract.id }
  const devicesHref = deviceFilterHref(scope)

  return (
    <>
      <PageHeader
        eyebrow="Contract type"
        title={contract.name}
        description="Firmware lifecycle applicability uses each device's effective contract: site override first, customer default second, otherwise none."
        actions={<div className="flex flex-wrap gap-2"><Link href="/contracts" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage contract types</Link><Link href={devicesHref} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Effective devices</Link></div>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryStat label="Effective devices" value={<Link href={devicesHref} className="text-[var(--accent-light)] hover:underline">{contract.effectiveDeviceCount}</Link>} detail="Devices whose resolved effective contract is this type." />
        <SummaryStat label="Customer defaults" value={contract.defaultCustomerCount} detail="Customers configured with this default contract." />
        <SummaryStat label="Site overrides" value={contract.siteOverrideCount} detail="Sites explicitly overriding to this contract type." />
        <SummaryStat label="Current" value={<Link href={technicalStateDeviceHref(scope, 'CURRENT')} className="text-[var(--accent-light)] hover:underline">{contract.technicalStateCounts.current}</Link>} detail="Effective devices on their exact desired release." />
        <SummaryStat label="Action required" value={<Link href={technicalStateDeviceHref(scope, 'ACTION_REQUIRED')} className="text-[var(--accent-light)] hover:underline">{contract.technicalStateCounts.actionRequired}</Link>} detail="Effective devices whose current release differs from desired." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <StateGrid title="Technical firmware state" description="These counts are scoped by the effective contract, not just the customer's default assignment." items={[
            ['Current', contract.technicalStateCounts.current, technicalStateDeviceHref(scope, 'CURRENT')],
            ['Action required', contract.technicalStateCounts.actionRequired, technicalStateDeviceHref(scope, 'ACTION_REQUIRED')],
            ['Unknown current', contract.technicalStateCounts.unknown, technicalStateDeviceHref(scope, 'UNKNOWN')],
            ['No policy', contract.technicalStateCounts.noPolicy, technicalStateDeviceHref(scope, 'NO_POLICY')],
          ]} />

          <StateGrid title="Workflow distribution" description="Operational decisions remain visible independently from technical desired-state compliance." items={[
            ['Planned', contract.workflowCounts.planned, workflowDeviceHref(scope, 'PLANNED')],
            ['Ignored', contract.workflowCounts.ignored, workflowDeviceHref(scope, 'IGNORED')],
            ['Customer declined', contract.workflowCounts.customerDeclined, workflowDeviceHref(scope, 'CUSTOMER_DECLINED')],
            ['Done', contract.workflowCounts.done, workflowDeviceHref(scope, 'DONE')],
            ['No decision', contract.workflowCounts.undecided, workflowDeviceHref(scope, 'UNDECIDED')],
          ]} />

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Customers with effective devices" description="A customer can appear here because of its default contract, one or more site overrides, or both." />
            {contract.customers.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No devices currently resolve to this contract type.</div> : <div className="divide-y divide-[var(--border)]">{contract.customers.map((customer) => <div key={customer.id} className="flex items-center justify-between gap-4 px-4 py-3"><Link href={`/customers/${customer.id}`} className="font-medium text-[var(--foreground)] hover:text-[var(--accent-light)]">{customer.name}</Link><Link href={deviceFilterHref({ contract: contract.id, customer: customer.id })} className="text-sm tabular-nums text-[var(--accent-light)] hover:underline">{customer.deviceCount} device{customer.deviceCount === 1 ? '' : 's'}</Link></div>)}</div>}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Sites with effective devices" description="Site rows make contract overrides visible without treating the contract as a monitoring construct." />
            {contract.sites.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No site-assigned devices currently resolve to this contract type.</div> : <div className="divide-y divide-[var(--border)]">{contract.sites.map((site) => <div key={site.id} className="flex items-center justify-between gap-4 px-4 py-3"><div><Link href={`/customers/${site.customerId}/sites/${site.id}`} className="font-medium text-[var(--foreground)] hover:text-[var(--accent-light)]">{site.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{site.customerName}</div></div><Link href={deviceFilterHref({ contract: contract.id, site: site.id })} className="text-sm tabular-nums text-[var(--accent-light)] hover:underline">{site.deviceCount} device{site.deviceCount === 1 ? '' : 's'}</Link></div>)}</div>}
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Contract context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Code" value={contract.code} />
            <DetailRow label="Status" value={contract.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Firmware management" value={contract.firmwareManagementEnabled ? 'Enabled' : 'Disabled'} />
            <DetailRow label="Manual devices" value={contract.sourceSummary.manual} />
            <DetailRow label="API devices" value={contract.sourceSummary.api} />
            <DetailRow label="Imported devices" value={contract.sourceSummary.import} />
            <DetailRow label="Latest device sync" value={contract.sourceSummary.latestSynchronizedAt ? new Date(contract.sourceSummary.latestSynchronizedAt).toLocaleString() : 'Never / manual'} />
            <DetailRow label="Created" value={new Date(contract.createdAt).toLocaleString()} />
            <DetailRow label="Updated" value={new Date(contract.updatedAt).toLocaleString()} />
          </dl>
          {contract.description ? <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm leading-6 text-[var(--muted-strong)]">{contract.description}</p> : null}
        </section>
      </div>
    </>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="border-b border-[var(--border)] px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p></div>
}

function StateGrid({ title, description, items }: { title: string; description: string; items: Array<[string, number, string]> }) {
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><SectionHeading title={title} description={description} /><div className={`grid gap-px bg-[var(--border)] ${items.length === 5 ? 'sm:grid-cols-2 xl:grid-cols-5' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>{items.map(([label, value, href]) => <Link key={label} href={href} className="bg-[var(--surface)] p-4 hover:bg-[var(--surface-raised)]"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div><div className="mt-2 text-2xl font-semibold text-[var(--accent-light)]">{value}</div></Link>)}</div></section>
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid grid-cols-[145px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
