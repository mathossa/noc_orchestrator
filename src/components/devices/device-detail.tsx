'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { WorkflowStatusBadge } from '@/components/ui/status-badge'
import type { DeviceDetailRecord } from '@/lib/devices'

type ApiError = { error?: { message?: string } }

function firmwareAge(days: number | null) {
  if (days === null) return 'Age unknown'
  if (days === 0) return 'Observed today'
  if (days === 1) return 'Observed 1 day ago'
  return `Observed ${days} days ago`
}

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<DeviceDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/devices/${deviceId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: DeviceDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Device could not be loaded.')
        if (!cancelled) setDevice(payload.data ?? null)
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

  if (loading) return <LoadingState title="Loading device" description="Reading recorded inventory and firmware lifecycle context…" />
  if (error || !device) {
    return <ErrorState title="Device could not be loaded" description={error ?? 'The inventory record is unavailable.'} action={<Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to devices</Link>} />
  }

  return (
    <>
      <PageHeader
        eyebrow={`${device.customer.name} · Device`}
        title={device.name}
        description="Recorded firmware lifecycle context for this device. No generic NMS health, performance graphs, or live polling are included."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage devices</Link>
            <Link href={`/customers/${device.customerId}`} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Customer</Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Current firmware" value={device.currentFirmwareRelease?.version ?? 'Unknown'} detail={device.currentFirmwareRelease ? `${device.currentFirmwareSource} · ${firmwareAge(device.currentFirmwareAgeDays)}` : 'No recorded current firmware release.'} />
        <SummaryStat label="Desired firmware" value="—" detail="Exact desired release arrives with model policy in Issue #9." />
        <SummaryStat label="Technical state" value="—" detail="Canonical current/action-required resolution arrives in Issue #10." />
        <SummaryStat label="Workflow" value={device.lifecycle?.state.replaceAll('_', ' ') ?? 'No decision'} detail="Workflow decisions remain independent from technical firmware state." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Firmware state</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <DetailRow label="Current release" value={device.currentFirmwareRelease ? <Link href={`/firmware/${device.currentFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{device.currentFirmwareRelease.version}</Link> : 'Unknown'} />
              <DetailRow label="Platform" value={device.currentFirmwareRelease?.platform ?? device.deviceModel.platform ?? '—'} />
              <DetailRow label="Firmware source" value={device.currentFirmwareRelease ? device.currentFirmwareSource : '—'} />
              <DetailRow label="Observed / reported" value={device.currentFirmwareObservedAt ? new Date(device.currentFirmwareObservedAt).toLocaleString() : 'Unknown'} />
              <DetailRow label="Observation age" value={device.currentFirmwareRelease ? firmwareAge(device.currentFirmwareAgeDays) : '—'} />
              <DetailRow label="Desired release" value="Not resolved yet (#9)" />
              <DetailRow label="Technical state" value="Not resolved yet (#10)" />
              <DetailRow label="Workflow" value={device.lifecycle ? <WorkflowStatusBadge state={device.lifecycle.state} /> : 'No lifecycle decision'} />
              <DetailRow label="Workflow target" value={device.lifecycle ? `${device.lifecycle.targetFirmwareRelease.platform} ${device.lifecycle.targetFirmwareRelease.version}` : '—'} />
            </dl>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Inventory notes</h2>
            {device.notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{device.notes}</p> : <p className="mt-3 text-sm text-[var(--muted)]">No device notes recorded.</p>}
            <div className="mt-4 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">Audit/history entry points will become active when Issue #12 introduces append-only audit behavior.</div>
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Inventory context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Customer" value={<Link href={`/customers/${device.customerId}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.customer.name}</Link>} />
            <DetailRow label="Site" value={device.site ? <Link href={`/customers/${device.customerId}/sites/${device.site.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.site.name}</Link> : 'Unassigned'} />
            <DetailRow label="Contract" value={device.customer.contractType?.name ?? 'No contract type'} />
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
