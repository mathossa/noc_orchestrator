'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { deviceFilterHref, technicalStateDeviceHref, workflowDeviceHref } from '@/lib/drilldown-links'
import type { VendorDrilldownRecord } from '@/lib/firmware-drilldowns'

type ApiError = { error?: { message?: string } }

export function VendorDetail({ vendorId }: { vendorId: string }) {
  const [vendor, setVendor] = useState<VendorDrilldownRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/vendors/${vendorId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: VendorDrilldownRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Vendor could not be loaded.')
        if (!cancelled) setVendor(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Vendor could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [vendorId])

  if (loading) return <LoadingState title="Loading vendor" description="Reading firmware lifecycle usage, desired state, and release context…" />
  if (error || !vendor) {
    return <ErrorState title="Vendor could not be loaded" description={error ?? 'The vendor record is unavailable.'} action={<Link href="/vendors" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to vendors</Link>} />
  }

  const scope = { vendor: vendor.id }
  const allDevicesHref = deviceFilterHref(scope)

  return (
    <>
      <PageHeader
        eyebrow="Vendor"
        title={vendor.name}
        description="Firmware-focused vendor context across concrete models, recorded devices, desired state, workflow decisions, and catalog releases."
        actions={<div className="flex flex-wrap gap-2"><Link href="/vendors" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage vendors</Link><Link href={allDevicesHref} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Vendor devices</Link></div>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryStat label="Devices" value={<Link href={allDevicesHref} className="text-[var(--accent-light)] hover:underline">{vendor.deviceCount}</Link>} detail="Recorded devices using this vendor's concrete models." />
        <SummaryStat label="Models" value={vendor.modelCount} detail="Concrete device models configured for this vendor." />
        <SummaryStat label="Current" value={<Link href={technicalStateDeviceHref(scope, 'CURRENT')} className="text-[var(--accent-light)] hover:underline">{vendor.technicalStateCounts.current}</Link>} detail="Devices on their exact desired release." />
        <SummaryStat label="Action required" value={<Link href={technicalStateDeviceHref(scope, 'ACTION_REQUIRED')} className="text-[var(--accent-light)] hover:underline">{vendor.technicalStateCounts.actionRequired}</Link>} detail="Recorded current firmware differs from desired." />
        <SummaryStat label="Catalog releases" value={vendor.releaseCount} detail="Firmware releases recorded for this vendor." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <StateGrid title="Technical firmware state" description="Exact current-versus-desired comparison; each count opens the matching device list." items={[
            ['Current', vendor.technicalStateCounts.current, technicalStateDeviceHref(scope, 'CURRENT')],
            ['Action required', vendor.technicalStateCounts.actionRequired, technicalStateDeviceHref(scope, 'ACTION_REQUIRED')],
            ['Unknown current', vendor.technicalStateCounts.unknown, technicalStateDeviceHref(scope, 'UNKNOWN')],
            ['No policy', vendor.technicalStateCounts.noPolicy, technicalStateDeviceHref(scope, 'NO_POLICY')],
          ]} />

          <StateGrid title="Workflow distribution" description="Operational decisions remain separate from technical firmware compliance." items={[
            ['Planned', vendor.workflowCounts.planned, workflowDeviceHref(scope, 'PLANNED')],
            ['Ignored', vendor.workflowCounts.ignored, workflowDeviceHref(scope, 'IGNORED')],
            ['Customer declined', vendor.workflowCounts.customerDeclined, workflowDeviceHref(scope, 'CUSTOMER_DECLINED')],
            ['Done', vendor.workflowCounts.done, workflowDeviceHref(scope, 'DONE')],
            ['No decision', vendor.workflowCounts.undecided, workflowDeviceHref(scope, 'UNDECIDED')],
          ]} />

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Models" description="Desired firmware stays attached to the concrete model; device counts drill into filtered inventory." />
            {vendor.models.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No models configured for this vendor.</div> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Model</th><th className="px-4 py-3">Type / platform</th><th className="px-4 py-3">Desired</th><th className="px-4 py-3">Devices</th><th className="px-4 py-3">Provenance / freshness</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{vendor.models.map((model) => <tr key={model.id} className={model.isActive ? '' : 'opacity-60'}><td className="px-4 py-3"><Link href={`/models/${model.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{model.model}</Link></td><td className="px-4 py-3"><div>{model.deviceType.name}</div><div className="mt-1 text-xs text-[var(--muted)]">{model.platform ?? 'No platform/family'}</div></td><td className="px-4 py-3">{model.desiredFirmwareRelease ? <Link href={`/firmware/${model.desiredFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{model.desiredFirmwareRelease.version}</Link> : <span className="text-[var(--muted)]">No policy</span>}</td><td className="px-4 py-3"><Link href={deviceFilterHref({ vendor: vendor.id, model: model.id })} className="text-[var(--accent-light)] hover:underline">{model.deviceCount}</Link></td><td className="px-4 py-3 text-xs text-[var(--muted-strong)]"><div>{model.source}</div><div className="mt-1 text-[var(--muted)]">{model.lastSynchronizedAt ? new Date(model.lastSynchronizedAt).toLocaleString() : 'Never / manual'}</div></td></tr>)}</tbody></table></div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Release catalog" description="Current and desired usage are exact release references; catalog order never changes desired state automatically." />
            {vendor.releases.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No firmware releases recorded for this vendor.</div> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Release</th><th className="px-4 py-3">Platform / train</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Current devices</th><th className="px-4 py-3">Desired devices</th><th className="px-4 py-3">Provenance / freshness</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{vendor.releases.map((release) => <tr key={release.id} className={release.isActive ? '' : 'opacity-60'}><td className="px-4 py-3"><Link href={`/firmware/${release.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{release.version}</Link></td><td className="px-4 py-3"><div>{release.platform}</div><div className="mt-1 text-xs text-[var(--muted)]">{release.firmwareTrain?.name ?? 'No train'}</div></td><td className="px-4 py-3 text-xs">{release.status}{release.isActive ? '' : ' · archived'}</td><td className="px-4 py-3"><Link href={deviceFilterHref({ vendor: vendor.id, currentFirmware: release.id })} className="text-[var(--accent-light)] hover:underline">{release.currentDeviceCount}</Link></td><td className="px-4 py-3"><Link href={deviceFilterHref({ vendor: vendor.id, desiredFirmware: release.id })} className="text-[var(--accent-light)] hover:underline">{release.desiredDeviceCount}</Link></td><td className="px-4 py-3 text-xs text-[var(--muted-strong)]"><div>{release.source}</div><div className="mt-1 text-[var(--muted)]">{release.lastSynchronizedAt ? new Date(release.lastSynchronizedAt).toLocaleString() : 'Never / manual'}</div></td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Vendor context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Code" value={vendor.code} />
            <DetailRow label="Status" value={vendor.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Manual devices" value={vendor.sourceSummary.manual} />
            <DetailRow label="API devices" value={vendor.sourceSummary.api} />
            <DetailRow label="Imported devices" value={vendor.sourceSummary.import} />
            <DetailRow label="Latest device sync" value={vendor.sourceSummary.latestSynchronizedAt ? new Date(vendor.sourceSummary.latestSynchronizedAt).toLocaleString() : 'Never / manual'} />
            <DetailRow label="Created" value={new Date(vendor.createdAt).toLocaleString()} />
            <DetailRow label="Updated" value={new Date(vendor.updatedAt).toLocaleString()} />
          </dl>
          {vendor.websiteUrl ? <a href={vendor.websiteUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-[var(--accent-light)] hover:underline">Vendor website</a> : null}
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
  return <div className="grid grid-cols-[135px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
