'use client'

import Link from 'next/link'
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
  const [selectedReleaseId, setSelectedReleaseId] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [policyMessage, setPolicyMessage] = useState<string | null>(null)

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
          setSelectedReleaseId(loaded?.desiredFirmware.release?.id ?? '')
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

  const selectableReleases = useMemo(
    () => model?.availableFirmware.releases.filter((release) => {
      if (!release.selectable) return false
      return compatibilityByRelease.get(release.id)?.status !== 'INCOMPATIBLE'
    }) ?? [],
    [compatibilityByRelease, model],
  )

  if (loading) return <LoadingState title="Loading device model" description="Reading firmware lifecycle context…" />
  if (error || !model) {
    return <ErrorState title="Device model could not be loaded" description={error ?? 'The model record is unavailable.'} action={<Link href="/models" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to models</Link>} />
  }

  const desired = model.desiredFirmware.release
  const desiredNormallySelectable = desired
    ? desired.isActive && ['APPROVED', 'RECOMMENDED'].includes(desired.status.toUpperCase())
    : false
  const currentDesiredNeedsWarning = desired ? !desiredNormallySelectable : false
  const currentDesiredIsInSelectableList = desired
    ? selectableReleases.some((release) => release.id === desired.id)
    : false

  async function saveDesiredFirmware() {
    setSavingPolicy(true)
    setPolicyError(null)
    setPolicyMessage(null)
    try {
      const response = await fetch(`/api/v1/models/${modelId}/desired-firmware`, {
        method: selectedReleaseId ? 'PUT' : 'DELETE',
        headers: selectedReleaseId ? { 'Content-Type': 'application/json' } : undefined,
        body: selectedReleaseId ? JSON.stringify({ firmwareReleaseId: selectedReleaseId }) : undefined,
      })
      const payload = (await response.json()) as { data?: DeviceModelDetailRecord } & ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'Desired firmware could not be saved.')
      if (!payload.data) throw new Error('Desired firmware was saved, but the refreshed model was unavailable.')
      setModel(payload.data)
      setSelectedReleaseId(payload.data.desiredFirmware.release?.id ?? '')
      const selectedCompatibility = selectedReleaseId ? compatibilityByRelease.get(selectedReleaseId) : null
      setPolicyMessage(
        payload.data.desiredFirmware.release
          ? selectedCompatibility?.status === 'UNKNOWN'
            ? 'Desired firmware saved. Compatibility is still unknown and requires review.'
            : 'Desired firmware policy saved.'
          : 'Desired firmware policy cleared.',
      )
    } catch (saveError: unknown) {
      setPolicyError(saveError instanceof Error ? saveError.message : 'Desired firmware could not be saved.')
    } finally {
      setSavingPolicy(false)
    }
  }

  const devicesHref = `/devices?model=${encodeURIComponent(model.id)}`

  return (
    <>
      <PageHeader
        eyebrow={`${model.vendor.name}${model.family ? ` · ${model.family.name}` : ''} · ${model.deviceType.name}`}
        title={model.model}
        description="Concrete model firmware lifecycle context. Supported platforms, desired policy, and current firmware remain separate but connected." 
        actions={<div className="flex flex-wrap gap-2"><Link href="/models" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage models</Link><Link href={`/models?edit=${encodeURIComponent(model.id)}`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Edit model</Link><Link href={devicesHref} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Devices using model</Link></div>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Devices" value={<Link href={devicesHref} className="text-[var(--accent-light)] hover:underline">{model.deviceCount}</Link>} detail="Inventory records using this concrete model." />
        <SummaryStat label="No action recommended" value={model.technicalStateCounts.current} detail="Devices whose effective policy recommends no action." />
        <SummaryStat label="Action required" value={model.technicalStateCounts.actionRequired} detail="Devices with a different exact recorded release." />
        <SummaryStat label="Desired firmware" value={desired?.version ?? 'None'} detail={desired ? `Exact model baseline · ${desired.status}` : 'No model-level desired policy.'} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <section id="desired-firmware-policy" className="scroll-mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Desired firmware policy" description="Desired state is policy intent. Known incompatible releases are not offered; unknown compatibility may still be selected and remains visible as review-required." />
            <div className="grid gap-px bg-[var(--border)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="bg-[var(--surface)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Current model baseline</div>
                {desired ? (
                  <div className="mt-3 space-y-3">
                    <Link href={`/firmware/${desired.id}`} className="inline-flex font-mono text-xl font-semibold text-[var(--accent-light)] hover:underline">{desired.version}</Link>
                    <dl className="space-y-2 text-sm">
                      <PolicyDetail label="Train" value={desired.firmwareTrain?.name ?? 'No train'} />
                      <PolicyDetail label="Status" value={desired.status} />
                      <PolicyDetail label="Compatibility" value={compatibilityByRelease.get(desired.id)?.status ?? 'UNKNOWN'} />
                      <PolicyDetail label="Catalog state" value={desired.isActive ? 'Active' : 'Archived'} />
                    </dl>
                    {currentDesiredNeedsWarning ? <div className="rounded-md border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs leading-5 text-amber-200">This existing desired target is {desired.isActive ? `currently ${desired.status}` : 'archived'}. It remains explicit policy history until deliberately changed or cleared.</div> : null}
                  </div>
                ) : (
                  <><div className="mt-2 text-base font-semibold">No desired firmware</div><p className="mt-1 text-xs leading-5 text-[var(--muted)]">No concrete-model baseline is set; family or device-scoped policy may still apply.</p></>
                )}
              </div>

              <div className="bg-[var(--surface)] p-4">
                <label htmlFor="desired-firmware" className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Desired firmware</label>
                <select id="desired-firmware" value={selectedReleaseId} onChange={(event) => { setSelectedReleaseId(event.target.value); setPolicyError(null); setPolicyMessage(null) }} className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]">
                  <option value="">No desired firmware</option>
                  {desired && !currentDesiredIsInSelectableList ? <option value={desired.id} disabled>{desired.version} · {desired.status} · current policy</option> : null}
                  {selectableReleases.map((release) => {
                    const status = compatibilityByRelease.get(release.id)?.status ?? 'UNKNOWN'
                    return <option key={release.id} value={release.id}>{release.version} · {release.platform} · {status === 'COMPATIBLE' ? 'compatible' : 'compatibility unknown'}{release.firmwareTrain ? ` · ${release.firmwareTrain.name}` : ''}</option>
                  })}
                </select>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Only active policy-eligible same-vendor releases that are not explicitly incompatible are offered. UNKNOWN is allowed as policy intent and will remain review-required; explicit INCOMPATIBLE is blocked.</p>
                <button type="button" onClick={() => void saveDesiredFirmware()} disabled={savingPolicy || selectedReleaseId === (desired?.id ?? '')} className="mt-4 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">{savingPolicy ? 'Saving…' : selectedReleaseId ? 'Save desired firmware' : 'Clear desired firmware'}</button>
                {policyError ? <p className="mt-3 text-sm text-red-300">{policyError}</p> : null}
                {policyMessage ? <p className="mt-3 text-sm text-emerald-300">{policyMessage}</p> : null}
              </div>
            </div>
          </section>

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

function PolicyDetail({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="text-[var(--muted-strong)]">{value}</dd></div>
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
