'use client'

import Link from 'next/link'
import { DesiredFirmwareEditor } from '@/components/device-models/desired-firmware-editor'
import { useMemo, useEffect, useState } from 'react'
import { AuditHistory } from '@/components/ui/audit-history'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import type { DeviceModelDetailRecord } from '@/lib/device-models'

type ApiError = { error?: { message?: string } }
type CompatibilityStatus = 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN'
type ModelCompatibilitySummary = {
  availableReleases: Array<{
    id: string
    compatibility: {
      status: CompatibilityStatus
      provenance: { explanation: string }
    }
  }>
}

export function DeviceModelDetail({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<DeviceModelDetailRecord | null>(null)
  const [compatibility, setCompatibility] = useState<ModelCompatibilitySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch(`/api/v1/models/${modelId}`, { cache: 'no-store' }),
      fetch(`/api/v1/models/${modelId}/firmware-compatibility`, { cache: 'no-store' }),
    ])
      .then(async ([modelResponse, compatibilityResponse]) => {
        const modelPayload = (await modelResponse.json()) as { data?: DeviceModelDetailRecord } & ApiError
        const compatibilityPayload = (await compatibilityResponse.json()) as { data?: ModelCompatibilitySummary } & ApiError
        if (!modelResponse.ok) throw new Error(modelPayload.error?.message ?? 'Device model could not be loaded.')
        if (!compatibilityResponse.ok) throw new Error(compatibilityPayload.error?.message ?? 'Firmware compatibility could not be loaded.')
        if (!cancelled) {
          const loaded = modelPayload.data ?? null
          setModel(loaded)
          setCompatibility(compatibilityPayload.data ?? null)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Device model could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [modelId])

  const compatibilityByRelease = useMemo(
    () => new Map(compatibility?.availableReleases.map((release) => [release.id, release.compatibility]) ?? []),
    [compatibility],
  )

  if (loading) return <LoadingState title="Loading device model" description="Reading firmware lifecycle context…" />
  if (error || !model) {
    return <ErrorState title="Device model could not be loaded" description={error ?? 'The model record is unavailable.'} action={<Link href="/models" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to models</Link>} />
  }

  const desired = model.desiredFirmware.release
  const devicesHref = `/devices?model=${encodeURIComponent(model.id)}`

  return (
    <>
      <PageHeader
        eyebrow={`${model.vendor.name}${model.family ? ` · ${model.family.name}` : ''} · ${model.deviceType.name}`}
        title={model.model}
        description="Concrete model firmware lifecycle context. Supported platforms, desired policy, and current firmware remain separate but connected." 
        actions={<div className="flex flex-wrap gap-2"><Link href={`/firmware/exceptions?scope=MODEL&scopeId=${encodeURIComponent(modelId)}`} className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold">Exceptions</Link><Link href="/models" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage models</Link><Link href={`/models?edit=${encodeURIComponent(model.id)}`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Edit model</Link><Link href={devicesHref} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Devices using model</Link></div>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Devices" value={<Link href={devicesHref} className="text-[var(--accent-light)] hover:underline">{model.deviceCount}</Link>} detail="Inventory records using this concrete model." />
        <SummaryStat label="No action recommended" value={model.technicalStateCounts.current} detail="Devices whose effective policy recommends no action." />
        <SummaryStat label="Action required" value={model.technicalStateCounts.actionRequired} detail="Devices with an update, migration, or review recommendation." />
        <SummaryStat label="Desired firmware" value={desired?.version ?? model.desiredFirmware.firmwareTrain?.name ?? 'None'} detail={model.desiredFirmware.policyId ? `${model.desiredFirmware.policyMode} model baseline` : 'No model-level desired policy.'} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <DesiredFirmwareEditor model={model} compatibility={compatibilityByRelease} onSaved={setModel} />

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><SectionHeading title="Desired firmware history" description="Append-oriented history of explicit desired-firmware changes for this concrete model, including bulk actions." /><AuditHistory events={model.auditHistory} emptyText="No desired-firmware policy changes have been recorded yet." /></section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Vendor firmware catalog" description="All same-vendor catalog releases are visible for reference. Compatibility is shown explicitly; this list is not the desired-firmware selector." />
            {model.availableFirmware.releases.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No releases exist for {model.vendor.name}.</div> : <div className="divide-y divide-[var(--border)]">{model.availableFirmware.releases.map((release) => {
              const compat = compatibilityByRelease.get(release.id)?.status ?? 'UNKNOWN'
              return <Link key={release.id} href={`/firmware/${release.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--surface-raised)]"><span><span className="font-mono font-semibold text-[var(--accent-light)]">{release.version}</span><span className="ml-2 text-xs text-[var(--muted)]">{release.firmwareTrain?.name ?? release.platform}</span></span><span className="text-right text-xs text-[var(--muted)]">{compat}{release.selectable ? ' · policy eligible' : ''}{release.isActive ? '' : ' · archived'}</span></Link>
            })}</div>}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Current firmware distribution" description="Recorded current firmware across devices using this model. This is inventory state, not live network polling." />
            {model.firmwareDistribution.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No devices currently use this model.</div> : <div className="noc-scrollbar overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Current firmware distribution</caption><thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3 font-semibold">Version</th><th className="px-4 py-3 font-semibold">Platform</th><th className="px-4 py-3 text-right font-semibold">Devices</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{model.firmwareDistribution.map((firmware) => <tr key={firmware.firmwareReleaseId ?? 'unrecorded'}><td className="px-4 py-3 font-medium text-[var(--foreground)]">{firmware.version}</td><td className="px-4 py-3 text-[var(--muted-strong)]">{firmware.platform ?? '—'}</td><td className="px-4 py-3 text-right tabular-nums text-[var(--muted-strong)]">{firmware.deviceCount}</td></tr>)}</tbody></table></div>}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><SectionHeading title="Technical firmware state" description="Effective per-device policy compliance, including customer and site overrides." /><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">{[['No action recommended', model.technicalStateCounts.current], ['Action required', model.technicalStateCounts.actionRequired], ['Unknown current', model.technicalStateCounts.unknown], ['No policy', model.technicalStateCounts.noPolicy]].map(([label, value]) => <div key={label} className="bg-[var(--surface)] p-4"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div><div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div></div>)}</div></section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><SectionHeading title="Workflow distribution" description="Lifecycle decisions remain separate from technical firmware compliance." /><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-5">{[['Planned', model.workflowCounts.planned], ['Ignored', model.workflowCounts.ignored], ['Customer declined', model.workflowCounts.customerDeclined], ['Done', model.workflowCounts.done], ['No decision', model.workflowCounts.undecided]].map(([label, value]) => <div key={label} className="bg-[var(--surface)] p-4"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div><div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div></div>)}</div></section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><SectionHeading title="Customers using this model" description="Derived from device inventory assignments." />{model.customers.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No customer devices use this model yet.</div> : <div className="divide-y divide-[var(--border)]">{model.customers.map((customer) => <div key={customer.id} className="flex items-center justify-between gap-4 px-4 py-3"><Link href={`/customers/${customer.id}`} className="font-medium text-[var(--foreground)] hover:text-[var(--accent-light)]">{customer.name}</Link><Link href={`/devices?model=${encodeURIComponent(model.id)}&customer=${encodeURIComponent(customer.id)}`} className="text-sm tabular-nums text-[var(--accent-light)] hover:underline">{customer.deviceCount} device{customer.deviceCount === 1 ? '' : 's'}</Link></div>)}</div>}</section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Model information</h2><Link href={`/models?edit=${encodeURIComponent(model.id)}`} className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Edit model</Link></div>
          <dl className="mt-4 space-y-3 text-sm"><DetailRow label="Vendor" value={model.vendor.name} /><DetailRow label="Family / series" value={model.family?.name ?? '—'} /><DetailRow label="Device type" value={model.deviceType.name} /><DetailRow label="Supported platforms" value={model.supportedPlatforms.length ? model.supportedPlatforms.join(', ') : 'Unknown'} /><DetailRow label="Status" value={model.isActive ? 'Active' : 'Archived'} /><DetailRow label="Catalog releases" value={model.availableFirmware.releases.length} /><DetailRow label="Source" value={model.source} /><DetailRow label="External provider" value={model.externalProvider ?? '—'} /><DetailRow label="External ID" value={model.externalId ?? '—'} /><DetailRow label="Last synchronized" value={model.lastSynchronizedAt ? new Date(model.lastSynchronizedAt).toLocaleString() : 'Never / manual'} /></dl>
          {model.family ? <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs leading-5 text-[var(--muted-strong)]"><strong>{model.family.name}</strong> may provide inherited compatibility evidence. Concrete model support configured above takes precedence.</div> : null}
          {model.notes ? <div className="mt-5 border-t border-[var(--border)] pt-4"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Notes</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{model.notes}</p></div> : null}
        </section>
      </div>
    </>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="border-b border-[var(--border)] px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p></div>
}



function DetailRow({ label, value }: { label: string; value: string | number }) {
  return <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
