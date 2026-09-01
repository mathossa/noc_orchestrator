'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { AuditHistory } from '@/components/ui/audit-history'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { TechnicalStatusBadge, WorkflowStatusBadge } from '@/components/ui/status-badge'
import type { DeviceDetailRecord } from '@/lib/devices'
import type { FirmwareWorkflowState } from '@/lib/firmware-lifecycle'

type ApiError = { error?: { message?: string; fields?: Record<string, string> } }

function firmwareAge(days: number | null) {
  if (days === null) return 'Age unknown'
  if (days === 0) return 'Observed today'
  if (days === 1) return 'Observed 1 day ago'
  return `Observed ${days} days ago`
}

function localDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<DeviceDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflowState, setWorkflowState] = useState<FirmwareWorkflowState>('PLANNED')
  const [reason, setReason] = useState('')
  const [lifecycleNotes, setLifecycleNotes] = useState('')
  const [plannedFor, setPlannedFor] = useState('')
  const [reviewAt, setReviewAt] = useState('')
  const [savingLifecycle, setSavingLifecycle] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null)

  function applyDevice(loaded: DeviceDetailRecord) {
    setDevice(loaded)
    setWorkflowState(loaded.lifecycle?.state ?? 'PLANNED')
    setReason(loaded.lifecycle?.reason ?? '')
    setLifecycleNotes(loaded.lifecycle?.notes ?? '')
    setPlannedFor(localDateTime(loaded.lifecycle?.plannedFor))
    setReviewAt(localDateTime(loaded.lifecycle?.reviewAt))
  }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/devices/${deviceId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: DeviceDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Device could not be loaded.')
        if (!cancelled && payload.data) applyDevice(payload.data)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Device could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [deviceId])

  async function saveLifecycleDecision() {
    setSavingLifecycle(true)
    setLifecycleError(null)
    setLifecycleMessage(null)
    try {
      const response = await fetch(`/api/v1/devices/${deviceId}/lifecycle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: workflowState,
          reason,
          notes: lifecycleNotes,
          plannedFor: plannedFor || null,
          reviewAt: reviewAt || null,
        }),
      })
      const payload = (await response.json()) as { data?: DeviceDetailRecord } & ApiError
      if (!response.ok) {
        const fieldMessage = payload.error?.fields ? Object.values(payload.error.fields)[0] : null
        throw new Error(fieldMessage ?? payload.error?.message ?? 'Lifecycle decision could not be saved.')
      }
      if (!payload.data) throw new Error('Lifecycle decision was saved, but the refreshed device was unavailable.')
      applyDevice(payload.data)
      setLifecycleMessage('Lifecycle decision saved.')
    } catch (saveError: unknown) {
      setLifecycleError(saveError instanceof Error ? saveError.message : 'Lifecycle decision could not be saved.')
    } finally {
      setSavingLifecycle(false)
    }
  }

  if (loading) return <LoadingState title="Loading device" description="Reading recorded inventory and firmware lifecycle context…" />
  if (error || !device) {
    return <ErrorState title="Device could not be loaded" description={error ?? 'The inventory record is unavailable.'} action={<Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to devices</Link>} />
  }

  const desired = device.desiredFirmware.release
  const needsReason = workflowState === 'IGNORED' || workflowState === 'CUSTOMER_DECLINED'

  return (
    <>
      <PageHeader
        eyebrow={`${device.customer.name} · Device`}
        title={device.name}
        description="Current firmware, desired firmware, technical state, and operational lifecycle decisions are separate pieces of state."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage devices</Link>
            <Link href={`/customers/${device.customerId}`} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Customer</Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Current firmware" value={device.currentFirmwareRelease?.version ?? 'Unknown'} detail={device.currentFirmwareRelease ? `${device.currentFirmwareSource} · ${firmwareAge(device.currentFirmwareAgeDays)}` : 'No recorded current firmware release.'} />
        <SummaryStat label="Desired firmware" value={desired?.version ?? 'None'} detail={desired ? `Model policy · ${desired.status}${desired.isActive ? '' : ' · archived target'}` : 'No desired model policy.'} />
        <SummaryStat label="Technical state" value={<TechnicalStatusBadge state={device.technicalState.state} />} detail="Exact current-versus-desired comparison." />
        <SummaryStat label="Workflow" value={device.lifecycle ? <WorkflowStatusBadge state={device.lifecycle.state} /> : 'No decision'} detail="Operational decision; it never changes technical compliance." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Firmware state</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <DetailRow label="Current release" value={device.currentFirmwareRelease ? <Link href={`/firmware/${device.currentFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{device.currentFirmwareRelease.version}</Link> : 'Unknown'} />
              <DetailRow label="Current train" value={device.currentFirmwareRelease?.firmwareTrain?.name ?? '—'} />
              <DetailRow label="Platform" value={device.currentFirmwareRelease?.platform ?? device.deviceModel.platform ?? '—'} />
              <DetailRow label="Firmware source" value={device.currentFirmwareRelease ? device.currentFirmwareSource : '—'} />
              <DetailRow label="Observed / reported" value={device.currentFirmwareObservedAt ? new Date(device.currentFirmwareObservedAt).toLocaleString() : 'Unknown'} />
              <DetailRow label="Observation age" value={device.currentFirmwareRelease ? firmwareAge(device.currentFirmwareAgeDays) : '—'} />
              <DetailRow label="Desired release" value={desired ? <Link href={`/firmware/${desired.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{desired.version}</Link> : 'No model policy'} />
              <DetailRow label="Desired train" value={desired?.firmwareTrain?.name ?? '—'} />
              <DetailRow label="Desired status" value={desired ? `${desired.status}${desired.isActive ? '' : ' · archived'}` : '—'} />
              <DetailRow label="Technical state" value={<TechnicalStatusBadge state={device.technicalState.state} />} />
              <DetailRow label="Workflow" value={device.lifecycle ? <WorkflowStatusBadge state={device.lifecycle.state} /> : 'No lifecycle decision'} />
              <DetailRow label="Workflow target" value={device.lifecycle ? `${device.lifecycle.targetFirmwareRelease.platform} ${device.lifecycle.targetFirmwareRelease.version}` : '—'} />
            </dl>
            {desired && !desired.isActive ? <div className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs leading-5 text-amber-200">The model&apos;s desired release is archived in the catalog. It remains the explicit desired target until the model policy is changed or cleared.</div> : null}
          </section>

          <section id="lifecycle-decision" className="scroll-mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Lifecycle decision</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Record what the NOC intends to do. Saving here does not modify current firmware, desired firmware, or technical state.</p>
              </div>
              {device.lifecycle ? <WorkflowStatusBadge state={device.lifecycle.state} /> : null}
            </div>

            {!desired ? (
              <div className="mt-4 rounded-md border border-[var(--warning)]/40 bg-[#2b2415] px-3 py-2 text-xs leading-5 text-[#efd18d]">Set an exact desired firmware policy on the model before creating or changing a lifecycle decision. Any existing decision remains visible as historical operational context.</div>
            ) : (
              <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--muted-strong)]">Saving snapshots target <strong className="font-mono text-[var(--foreground)]">{desired.version}</strong>. Later model-policy changes do not silently rewrite this decision.</div>
            )}

            {device.lifecycle ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <DetailRow label="Stored target" value={`${device.lifecycle.targetFirmwareRelease.platform} ${device.lifecycle.targetFirmwareRelease.version}`} />
                <DetailRow label="Decided" value={new Date(device.lifecycle.decidedAt).toLocaleString()} />
                <DetailRow label="Decided by" value={device.lifecycle.decidedBy?.name ?? 'Actor unavailable'} />
                <DetailRow label="Completed" value={device.lifecycle.completedAt ? new Date(device.lifecycle.completedAt).toLocaleString() : '—'} />
              </dl>
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[var(--muted-strong)]">
                Workflow state
                <select value={workflowState} onChange={(event) => { setWorkflowState(event.target.value as FirmwareWorkflowState); setLifecycleError(null); setLifecycleMessage(null) }} className="mt-1.5 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]">
                  <option value="PLANNED">Planned</option>
                  <option value="IGNORED">Ignored</option>
                  <option value="CUSTOMER_DECLINED">Customer declined</option>
                  <option value="DONE">Done</option>
                </select>
              </label>

              {workflowState === 'PLANNED' ? (
                <label className="text-sm font-medium text-[var(--muted-strong)]">
                  Planned for
                  <input type="datetime-local" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} className="mt-1.5 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]" />
                </label>
              ) : null}

              {needsReason ? (
                <label className="text-sm font-medium text-[var(--muted-strong)] sm:col-span-2">
                  Reason <span className="text-[var(--warning)]">*</span>
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={workflowState === 'CUSTOMER_DECLINED' ? 'Why did the customer decline?' : 'Why is no action being taken now?'} className="mt-1.5 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]" />
                </label>
              ) : (
                <label className="text-sm font-medium text-[var(--muted-strong)] sm:col-span-2">
                  Reason <span className="font-normal text-[var(--muted)]">(optional)</span>
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional decision context" className="mt-1.5 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]" />
                </label>
              )}

              {needsReason ? (
                <label className="text-sm font-medium text-[var(--muted-strong)]">
                  Review at <span className="font-normal text-[var(--muted)]">(optional)</span>
                  <input type="datetime-local" value={reviewAt} onChange={(event) => setReviewAt(event.target.value)} className="mt-1.5 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]" />
                </label>
              ) : null}

              <label className={`text-sm font-medium text-[var(--muted-strong)] ${needsReason ? '' : 'sm:col-span-2'}`}>
                Notes <span className="font-normal text-[var(--muted)]">(optional)</span>
                <textarea value={lifecycleNotes} onChange={(event) => setLifecycleNotes(event.target.value)} rows={3} placeholder="Operational context, maintenance details, customer communication…" className="mt-1.5 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]" />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <div className="min-h-5 text-sm">
                {lifecycleError ? <span className="text-red-300">{lifecycleError}</span> : null}
                {lifecycleMessage ? <span className="text-emerald-300">{lifecycleMessage}</span> : null}
              </div>
              <button type="button" disabled={savingLifecycle || !desired} onClick={() => void saveLifecycleDecision()} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">{savingLifecycle ? 'Saving…' : device.lifecycle ? 'Update decision' : 'Save decision'}</button>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Firmware lifecycle history</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Append-oriented history of current-firmware recordings and operational lifecycle decisions for this device.</p>
            </div>
            <AuditHistory events={device.auditHistory} />
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Inventory notes</h2>
            {device.notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{device.notes}</p> : <p className="mt-3 text-sm text-[var(--muted)]">No device notes recorded.</p>}
            <div className="mt-4 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">Lifecycle-significant changes are retained in the audit history above; generic inventory CRUD noise is intentionally not logged.</div>
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Inventory context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Customer" value={<Link href={`/customers/${device.customerId}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.customer.name}</Link>} />
            <DetailRow label="Site" value={device.site ? <Link href={`/customers/${device.customerId}/sites/${device.site.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.site.name}</Link> : 'Unassigned'} />
            <DetailRow label="Contract" value={device.effectiveContractType?.name ?? 'No contract type'} />
            <DetailRow label="Contract source" value={device.contractSource === 'SITE' ? 'Site override' : device.contractSource === 'CUSTOMER' ? 'Customer default' : 'No contract'} />
            {device.contractSource === 'SITE' ? <DetailRow label="Customer default" value={device.customer.contractType?.name ?? 'No customer default'} /> : null}
            <DetailRow label="Vendor" value={device.deviceModel.vendor.name} />
            <DetailRow label="Model" value={<Link href={`/models/${device.deviceModel.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.deviceModel.model}</Link>} />
            <DetailRow label="Device type" value={device.deviceModel.deviceType.name} />
            <DetailRow label="Hostname" value={device.hostname ?? '—'} />
            <DetailRow label="Management" value={device.managementAddress ?? '—'} />
            <DetailRow label="Serial number" value={device.serialNumber ?? '—'} />
            <DetailRow label="Record state" value={device.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Source" value={device.source} />
            <DetailRow label="External provider" value={device.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={device.externalId ?? '—'} />
            <DetailRow label="Last synchronized" value={device.lastSynchronizedAt ? new Date(device.lastSynchronizedAt).toLocaleString() : 'Never / manual'} />
            <DetailRow label="Created" value={new Date(device.createdAt).toLocaleString()} />
            <DetailRow label="Updated" value={new Date(device.updatedAt).toLocaleString()} />
          </dl>
        </section>
      </div>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid grid-cols-[145px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd></div>
}
