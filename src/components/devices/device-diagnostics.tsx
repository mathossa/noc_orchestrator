import Link from 'next/link'
import type { ReactNode } from 'react'
import type { DeviceDetailRecord } from '@/lib/devices'
import { FirmwareComplianceStatus } from './firmware-compliance-status'
import { DeviceExceptions } from '@/components/firmware/device-exceptions'
import { WorkflowStatusBadge } from '@/components/ui/status-badge'
import { AuditHistory } from '@/components/ui/audit-history'

function firmwareAge(days: number | null) {
  return days === null ? 'Unknown' : `${days} days ago`
}

export function DeviceDiagnostics({ device }: { device: DeviceDetailRecord }) {
  const desired = device.desiredFirmware.release
  const currentVersion =
    device.currentFirmwareRelease?.version ??
    device.currentFirmwareNormalizedVersion ??
    device.currentFirmwareRawVersion
  const resolvedCurrent =
    device.currentFirmwareRelease ?? device.firmwareCompliance.currentFirmware
  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-semibold">Firmware details</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <DetailRow
            label="Current release"
            value={
              device.currentFirmwareRelease ? (
                <Link
                  href={`/firmware/${device.currentFirmwareRelease.id}`}
                  className="font-mono font-semibold text-[var(--accent-light)] hover:underline"
                >
                  {device.currentFirmwareRelease.version}
                </Link>
              ) : currentVersion ? (
                <span className="font-mono font-semibold">
                  {currentVersion}{' '}
                  <span className="font-sans font-normal text-[var(--muted)]">
                    (observed; catalog link unresolved)
                  </span>
                </span>
              ) : (
                'Unknown'
              )
            }
          />
          <DetailRow
            label="Raw observation"
            value={device.currentFirmwareRawVersion ?? '—'}
          />
          <DetailRow
            label="Current train"
            value={resolvedCurrent?.firmwareTrain?.name ?? '—'}
          />
          <DetailRow
            label="Current platform"
            value={
              resolvedCurrent?.platform ??
              (currentVersion ? 'Catalog link unresolved' : 'Unknown')
            }
          />
          <DetailRow
            label="Firmware source"
            value={currentVersion ? device.currentFirmwareSource : '—'}
          />
          <DetailRow
            label="Observed / reported"
            value={
              device.currentFirmwareObservedAt
                ? new Date(device.currentFirmwareObservedAt).toLocaleString()
                : 'Unknown'
            }
          />
          <DetailRow
            label="Observation age"
            value={
              currentVersion ? firmwareAge(device.currentFirmwareAgeDays) : '—'
            }
          />
          <DetailRow
            label="Desired release"
            value={
              desired ? (
                <Link
                  href={`/firmware/${desired.id}`}
                  className="font-mono font-semibold text-[var(--accent-light)] hover:underline"
                >
                  {desired.version}
                </Link>
              ) : (
                'No resolved preferred target'
              )
            }
          />
          <DetailRow
            label="Desired train"
            value={desired?.firmwareTrain?.name ?? '—'}
          />
          <DetailRow
            label="Desired status"
            value={
              desired
                ? `${desired.status}${desired.isActive ? '' : ' · archived'}`
                : '—'
            }
          />
          <DetailRow
            label="Technical state"
            value={
              <FirmwareComplianceStatus result={device.firmwareCompliance} />
            }
          />
          <DetailRow
            label="Policy source"
            value={
              device.firmwareCompliance.policySource
                ? `${device.firmwareCompliance.policySource.scope} · ${device.firmwareCompliance.policySource.trackName} · v${device.firmwareCompliance.policySource.policyVersion}`
                : 'No resolved policy'
            }
          />
          <DetailRow
            label="Policy mode"
            value={
              device.firmwareCompliance.effectivePolicy.policy?.policyMode ??
              '—'
            }
          />
          <DetailRow
            label="Preferred position"
            value={device.firmwareCompliance.relationToPreferred.replaceAll(
              '_',
              ' ',
            )}
          />
          <DetailRow
            label="Recommendation"
            value={device.firmwareCompliance.recommendation.replaceAll(
              '_',
              ' ',
            )}
          />
          <DetailRow
            label="Target compatibility"
            value={
              device.firmwareCompliance.targetCompatibility?.status ?? 'Unknown'
            }
          />
          <DetailRow
            label="Resolved image"
            value={
              device.firmwareCompliance.resolvedTarget?.version ?? 'Unresolved'
            }
          />
          <DetailRow
            label="Explanation"
            value={device.firmwareCompliance.explanation}
          />
          <DetailRow
            label="Workflow"
            value={
              device.lifecycle ? (
                <WorkflowStatusBadge state={device.lifecycle.state} />
              ) : (
                'No lifecycle decision'
              )
            }
          />
          <DetailRow
            label="Workflow target"
            value={
              device.lifecycle
                ? `${device.lifecycle.targetFirmwareRelease.platform} ${device.lifecycle.targetFirmwareRelease.version}`
                : '—'
            }
          />
        </dl>
        {desired && !desired.isActive ? (
          <div className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs leading-5 text-amber-200">
            The effective preferred release is archived in the catalog and
            requires policy review.
          </div>
        ) : null}
      </section>
      <DeviceExceptions deviceId={device.id} />
      <section>
        <h3 className="font-semibold">Inventory and source</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <DetailRow
            label="Customer"
            value={
              <Link
                href={`/customers/${device.customerId}`}
                className="font-semibold text-[var(--accent-light)] hover:underline"
              >
                {device.customer.name}
              </Link>
            }
          />
          <DetailRow
            label="Site"
            value={
              device.site ? (
                <Link
                  href={`/customers/${device.customerId}/sites/${device.site.id}`}
                  className="font-semibold text-[var(--accent-light)] hover:underline"
                >
                  {device.site.organizationUnit
                    ? `${device.site.organizationUnit.name} / `
                    : ''}
                  {device.site.name}
                </Link>
              ) : (
                'Unassigned'
              )
            }
          />
          <DetailRow
            label="Contract"
            value={device.effectiveContractType?.name ?? 'No contract type'}
          />
          <DetailRow
            label="Contract source"
            value={
              device.contractSource === 'SITE'
                ? 'Site override'
                : device.contractSource === 'CUSTOMER'
                  ? 'Customer default'
                  : 'No contract'
            }
          />
          {device.contractSource === 'SITE' ? (
            <DetailRow
              label="Customer default"
              value={
                device.customer.contractType?.name ?? 'No customer default'
              }
            />
          ) : null}
          <DetailRow label="Vendor" value={device.deviceModel.vendor.name} />
          <DetailRow
            label="Model"
            value={
              <Link
                href={`/models/${device.deviceModel.id}`}
                className="font-semibold text-[var(--accent-light)] hover:underline"
              >
                {device.deviceModel.model}
              </Link>
            }
          />
          <DetailRow
            label="Device type"
            value={device.deviceModel.deviceType.name}
          />
          <DetailRow label="Hostname" value={device.hostname ?? '—'} />
          <DetailRow
            label="Management"
            value={device.managementAddress ?? '—'}
          />
          <DetailRow label="Serial number" value={device.serialNumber ?? '—'} />
          <DetailRow
            label="Record state"
            value={device.isActive ? 'Active' : 'Archived'}
          />
        </dl>
        <section className="mt-6">
          <h3 className="text-sm font-semibold">Source and synchronization</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Source" value={device.source} />
            <DetailRow
              label="External provider"
              value={device.externalProvider ?? '—'}
            />
            <DetailRow label="External ID" value={device.externalId ?? '—'} />
            <DetailRow
              label="Last synchronized"
              value={
                device.lastSynchronizedAt
                  ? new Date(device.lastSynchronizedAt).toLocaleString()
                  : 'Never / manual'
              }
            />
            <DetailRow
              label="Created"
              value={new Date(device.createdAt).toLocaleString()}
            />
            <DetailRow
              label="Updated"
              value={new Date(device.updatedAt).toLocaleString()}
            />
          </dl>
        </section>
      </section>
      {device.lifecycle ? (
        <section>
          <h3 className="font-semibold">Previous device decision</h3>
          <p className="mt-2 text-sm">
            {device.lifecycle.state.replaceAll('_', ' ')} ·{' '}
            {device.lifecycle.targetFirmwareRelease.version}
          </p>
          <p className="mt-1 text-sm">{device.lifecycle.reason}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">
            {device.lifecycle.notes}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Recorded {new Date(device.lifecycle.decidedAt).toLocaleString()} ·{' '}
            {device.lifecycle.decidedBy?.name ?? 'Actor unavailable'}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Planned: {device.lifecycle.plannedFor ?? '—'} · Review:{' '}
            {device.lifecycle.reviewAt ?? '—'} · Completed:{' '}
            {device.lifecycle.completedAt ?? '—'}
          </p>
        </section>
      ) : null}
      {device.planning.history.length ? (
        <section>
          <h3 className="font-semibold">Previous maintenance plans</h3>
          {device.planning.history.map((plan) => (
            <p key={plan.id} className="mt-2 text-sm">
              <Link
                className="text-[var(--accent-light)] hover:underline"
                href={'/planning/' + plan.id}
              >
                {plan.title ?? 'Maintenance plan'} ·{' '}
                {plan.state.toLowerCase().replaceAll('_', ' ')}
              </Link>
            </p>
          ))}
        </section>
      ) : null}
      {device.notes ? (
        <section>
          <h3 className="font-semibold">Device notes</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">{device.notes}</p>
        </section>
      ) : null}
      <section>
        <h3 className="font-semibold">History</h3>
        <AuditHistory
          events={device.auditHistory}
          emptyText="No changes recorded."
        />
      </section>
    </div>
  )
}
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 border-b border-[var(--border)] pb-2">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value}</dd>
    </div>
  )
}
