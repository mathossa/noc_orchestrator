'use client'

import { DeviceExceptions } from '@/components/firmware/device-exceptions'
import { FirmwareComplianceStatus } from '@/components/devices/firmware-compliance-status'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { AuditHistory } from '@/components/ui/audit-history'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { PlanStatePill } from '@/components/firmware/planning/planning-ui'
import type { DeviceDetailRecord } from '@/lib/devices'

type ApiError = { error?: { message?: string; fields?: Record<string, string> } }

function firmwareAge(days: number | null) {
  if (days === null) return 'Age unknown'
  if (days === 0) return 'Observed today'
  if (days === 1) return 'Observed 1 day ago'
  return `Observed ${days} days ago`
}

function observedCurrentFirmwareVersion(device: DeviceDetailRecord) {
  return (
    device.currentFirmwareRelease?.version ??
    device.currentFirmwareNormalizedVersion ??
    device.currentFirmwareRawVersion ??
    null
  )
}

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<DeviceDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function applyDevice(loaded: DeviceDetailRecord) {
    setDevice(loaded)
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

  if (loading) return <LoadingState title="Loading device" description="Reading recorded inventory, firmware state, exceptions and work planning…" />
  if (error || !device) {
    return <ErrorState title="Device could not be loaded" description={error ?? 'The inventory record is unavailable.'} action={<Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to devices</Link>} />
  }

  const desired = device.desiredFirmware.release
  const activePlan = device.planning.activePlans[0] ?? null
  const currentVersion = observedCurrentFirmwareVersion(device)
  const resolvedCurrent = device.currentFirmwareRelease ?? device.firmwareCompliance.currentFirmware

  return (
    <>
      <PageHeader
        eyebrow={`${device.customer.name} · Device`}
        title={device.name}
        description="Current firmware, desired firmware, technical state, accepted exceptions and work planning remain separate pieces of state."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage devices</Link>
            <Link href={`/customers/${device.customerId}`} className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Customer</Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Current firmware" value={currentVersion ?? 'Unknown'} detail={currentVersion ? `${device.currentFirmwareSource} · ${firmwareAge(device.currentFirmwareAgeDays)}${device.currentFirmwareRelease ? '' : ' · catalog link unresolved'}` : 'No observed current firmware.'} />
        <SummaryStat label="Desired firmware" value={desired?.version ?? 'None'} detail={desired ? `Effective policy · ${desired.status}${desired.isActive ? '' : ' · archived target'}` : 'No resolved preferred target.'} />
        <SummaryStat label="Technical state" value={<FirmwareComplianceStatus result={device.firmwareCompliance} />} detail={device.firmwareCompliance.explanation} />
        <SummaryStat
          label="Planning"
          value={
            activePlan ? <PlanStatePill state={activePlan.state} /> : 'No active plan'
          }
          detail={
            activePlan
              ? `${device.planning.activePlans.length} active plan${device.planning.activePlans.length === 1 ? '' : 's'} · ${device.planning.history.length} historical`
              : `${device.planning.history.length} historical plan${device.planning.history.length === 1 ? '' : 's'}`
          }
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Firmware state</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <DetailRow label="Current release" value={device.currentFirmwareRelease ? <Link href={`/firmware/${device.currentFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{device.currentFirmwareRelease.version}</Link> : currentVersion ? <span className="font-mono font-semibold">{currentVersion} <span className="font-sans font-normal text-[var(--muted)]">(observed; catalog link unresolved)</span></span> : 'Unknown'} />
              <DetailRow label="Raw observation" value={device.currentFirmwareRawVersion ?? '—'} />
              <DetailRow label="Current train" value={resolvedCurrent?.firmwareTrain?.name ?? '—'} />
              <DetailRow label="Current platform" value={resolvedCurrent?.platform ?? (currentVersion ? 'Catalog link unresolved' : 'Unknown')} />
              <DetailRow label="Firmware source" value={currentVersion ? device.currentFirmwareSource : '—'} />
              <DetailRow label="Observed / reported" value={device.currentFirmwareObservedAt ? new Date(device.currentFirmwareObservedAt).toLocaleString() : 'Unknown'} />
              <DetailRow label="Observation age" value={currentVersion ? firmwareAge(device.currentFirmwareAgeDays) : '—'} />
              <DetailRow label="Desired release" value={desired ? <Link href={`/firmware/${desired.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{desired.version}</Link> : 'No resolved preferred target'} />
              <DetailRow label="Desired train" value={desired?.firmwareTrain?.name ?? '—'} />
              <DetailRow label="Desired status" value={desired ? `${desired.status}${desired.isActive ? '' : ' · archived'}` : '—'} />
              <DetailRow label="Technical state" value={<FirmwareComplianceStatus result={device.firmwareCompliance} />} />
              <DetailRow label="Policy source" value={device.firmwareCompliance.policySource ? `${device.firmwareCompliance.policySource.scope} · ${device.firmwareCompliance.policySource.trackName} · v${device.firmwareCompliance.policySource.policyVersion}` : 'No resolved policy'} />
              <DetailRow label="Policy mode" value={device.firmwareCompliance.effectivePolicy.policy?.policyMode ?? '—'} />
              <DetailRow label="Preferred position" value={device.firmwareCompliance.relationToPreferred.replaceAll('_', ' ')} />
              <DetailRow label="Recommendation" value={device.firmwareCompliance.recommendation.replaceAll('_', ' ')} />
              <DetailRow label="Target compatibility" value={device.firmwareCompliance.targetCompatibility?.status ?? 'Unknown'} />
              <DetailRow label="Resolved image" value={device.firmwareCompliance.resolvedTarget?.version ?? 'Unresolved'} />
              <DetailRow label="Explanation" value={device.firmwareCompliance.explanation} />
              <DetailRow
                label="Planning"
                value={
                  activePlan ? (
                    <Link href={`/planning/${activePlan.id}`} className="inline-flex hover:opacity-80">
                      <PlanStatePill state={activePlan.state} />
                    </Link>
                  ) : (
                    'No active plan'
                  )
                }
              />
              <DetailRow
                label="Planning target"
                value={
                  activePlan
                    ? `${activePlan.targetPlatform} ${activePlan.targetVersion}${activePlan.targetImageCode ? ` · ${activePlan.targetImageCode}` : ''}`
                    : '—'
                }
              />
            </dl>
            {desired && !desired.isActive ? <div className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs leading-5 text-amber-200">The effective preferred release is archived in the catalog and requires policy review.</div> : null}
          </section>

          <DeviceExceptions deviceId={deviceId} />
          <section id="planning" className="scroll-mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Firmware planning</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Work plans are separate from technical compliance and accepted exceptions. Manage workflow in the Planning workspace.
                </p>
              </div>
              <Link
                href="/planning/new"
                className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
              >
                Create maintenance plan
              </Link>
            </div>

            {device.planning.activePlans.length ? (
              <div className="mt-4 space-y-3">
                {device.planning.activePlans.map((plan) => (
                  <Link
                    key={plan.id}
                    href={`/planning/${plan.id}`}
                    className="block rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 hover:border-[var(--border-strong)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <PlanStatePill state={plan.state} />
                        <div className="mt-2 font-mono text-sm">
                          {plan.targetPlatform} {plan.targetVersion}
                          {plan.targetImageCode ? ` · ${plan.targetImageCode}` : ''}
                        </div>
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          Recommendation at planning: {plan.recommendation.replaceAll('_', ' ')}
                        </div>
                      </div>
                      <div className="text-right text-xs text-[var(--muted)]">
                        <div>Proposed: {plan.proposedFor ? new Date(plan.proposedFor).toLocaleString() : '—'}</div>
                        <div className="mt-1">Scheduled: {plan.scheduledFor ? new Date(plan.scheduledFor).toLocaleString() : '—'}</div>
                      </div>
                    </div>
                  </Link>
                ))}
                {device.planning.activePlans.length > 1 ? (
                  <div className="rounded-md border border-[#9a6234] bg-[#342218] px-3 py-2 text-xs text-[#ffd0a0]">
                    Multiple active plans overlap this device. Review them before execution.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-[var(--border-strong)] p-4 text-sm text-[var(--muted)]">
                No active firmware work plan currently targets this device.
              </div>
            )}

            {device.planning.history.length ? (
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-strong)]">
                  Completed / cancelled history
                </h3>
                <div className="mt-3 space-y-2">
                  {device.planning.history.map((plan) => (
                    <Link
                      key={plan.id}
                      href={`/planning/${plan.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"
                    >
                      <span className="flex items-center gap-2">
                        <PlanStatePill state={plan.state} />
                        <span className="font-mono">{plan.targetVersion}</span>
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {plan.completedAt
                          ? new Date(plan.completedAt).toLocaleString()
                          : plan.cancelledAt
                            ? new Date(plan.cancelledAt).toLocaleString()
                            : 'Historical'}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {device.lifecycle ? (
              <details className="mt-5 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
                <summary className="cursor-pointer font-semibold">Legacy lifecycle migration evidence</summary>
                <p className="mt-2">
                  Legacy state {device.lifecycle.state} is retained for migration/audit compatibility but is no longer the source of Planning UI state.
                </p>
              </details>
            ) : null}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Device firmware audit history</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Append-oriented device audit history. Work-plan transitions are shown in the Planning workspace.</p>
            </div>
            <AuditHistory events={device.auditHistory} />
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Inventory notes</h2>
            {device.notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{device.notes}</p> : <p className="mt-3 text-sm text-[var(--muted)]">No device notes recorded.</p>}
            <div className="mt-4 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">Firmware-significant device changes are retained in audit history; generic inventory CRUD noise is intentionally not logged.</div>
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Inventory context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Customer" value={<Link href={`/customers/${device.customerId}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.customer.name}</Link>} />
            <DetailRow label="Site" value={device.site ? <Link href={`/customers/${device.customerId}/sites/${device.site.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{device.site.organizationUnit ? `${device.site.organizationUnit.name} / ` : ''}{device.site.name}</Link> : 'Unassigned'} />
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