'use client'

import Link from 'next/link'
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { DeviceExceptions } from '@/components/firmware/device-exceptions'
import { Button, ButtonLink } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { TextArea } from '@/components/ui/form-controls'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { AuditHistory } from '@/components/ui/audit-history'
import { WorkflowStatusBadge } from '@/components/ui/status-badge'
import { DeviceEditModal } from './device-edit-modal'
import { FirmwareComplianceStatus } from './firmware-compliance-status'
import { InventoryStatusBadge } from './inventory-explorer'
import { deviceFirmwareSummary } from '@/lib/device-overview'
import type { DeviceDetailRecord } from '@/lib/devices'

type ApiPayload = { data?: DeviceDetailRecord; error?: { message?: string } }
type Action = 'ADD_NOTE' | 'FLAG' | 'RESOLVE_FLAG'
type DeviceTab =
  | 'overview'
  | 'firmware'
  | 'compliance'
  | 'network'
  | 'notes'
  | 'history'

const tabs: Array<{ id: DeviceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'network', label: 'Network' },
  { id: 'notes', label: 'Notes & issues' },
  { id: 'history', label: 'History' },
]

function humanize(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function firmwareAge(days: number | null) {
  if (days === null) return 'Unknown'
  if (days === 0) return 'Observed today'
  if (days === 1) return 'Observed 1 day ago'
  return 'Observed ' + days + ' days ago'
}

function formatDate(value: string | null | undefined, empty = '—') {
  if (!value) return empty
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? empty : date.toLocaleString()
}

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<DeviceDetailRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/devices/' + deviceId, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as ApiPayload
        if (!response.ok || !payload.data)
          throw new Error(
            payload.error?.message ?? 'Device could not be loaded.',
          )
        setDevice(payload.data)
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Device could not be loaded.',
          )
      })
    return () => controller.abort()
  }, [deviceId])

  if (error)
    return (
      <ErrorState
        title="Device could not be loaded"
        description={error}
        action={<ButtonLink href="/devices">Back to devices</ButtonLink>}
      />
    )

  if (!device)
    return (
      <LoadingState
        title="Loading device"
        description="Reading inventory and maintenance plans…"
      />
    )

  return (
    <DeviceWorkspace key={device.id} device={device} onUpdate={setDevice} />
  )
}

export function DeviceWorkspace({
  device,
  onUpdate,
}: {
  device: DeviceDetailRecord
  onUpdate: (device: DeviceDetailRecord) => void
}) {
  const [activeTab, setActiveTab] = useState<DeviceTab>('overview')
  const [panel, setPanel] = useState<Action | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const sitePath =
    '/devices/customers/' +
    device.customerId +
    '/sites/' +
    (device.siteId ?? 'unassigned')
  const groupPath =
    sitePath + '/types/' + device.deviceModel.deviceType.id
  const desired = device.desiredFirmware.release
  const current =
    device.currentFirmwareRelease?.version ??
    device.currentFirmwareNormalizedVersion ??
    device.currentFirmwareRawVersion
  const currentPlatform =
    device.currentFirmwareRelease?.platform ??
    device.firmwareCompliance.currentFirmware?.platform
  const migration = Boolean(
    currentPlatform && desired && currentPlatform !== desired.platform,
  )
  const actionTitle =
    panel === 'ADD_NOTE'
      ? 'Add note'
      : panel === 'FLAG'
        ? 'Flag issue'
        : 'Resolve issue'

  function openAction(next: Action) {
    setText('')
    setError(null)
    setMessage('')
    setActionsOpen(false)
    setPanel(next)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(
        '/api/v1/devices/' + device.id + '/annotations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: panel, text }),
        },
      )
      const payload = (await response.json()) as ApiPayload
      if (!response.ok || !payload.data)
        throw new Error(
          payload.error?.message ?? 'Annotation could not be saved.',
        )

      onUpdate(payload.data)
      setMessage(
        panel === 'ADD_NOTE'
          ? 'Note added.'
          : panel === 'FLAG'
            ? 'Issue flagged.'
            : 'Issue resolved.',
      )
      setPanel(null)
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Annotation could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={device.name}
        eyebrow="Device"
        breadcrumbs={[
          { label: 'Devices', href: '/devices' },
          {
            label: device.customer.name,
            href: '/devices/customers/' + device.customerId,
          },
          {
            label: device.site?.name ?? 'Unassigned devices',
            href: sitePath,
          },
          {
            label: device.deviceModel.deviceType.name,
            href: groupPath,
          },
          { label: device.name },
        ]}
        description={
          device.deviceModel.vendor.name +
          ' ' +
          device.deviceModel.model +
          ' · ' +
          device.deviceModel.deviceType.name
        }
        meta={
          <>
            <InventoryStatusBadge status={device.inventoryStatus} />
            {!device.isActive ? (
              <span className="text-[var(--warning)]">Archived device</span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button onClick={() => setEditOpen(true)}>Edit device</Button>
            <div className="relative">
              <Button
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                onClick={() => setActionsOpen((open) => !open)}
              >
                Actions <span aria-hidden="true">⌄</span>
              </Button>
              {actionsOpen ? (
                <div
                  role="menu"
                  aria-label="Device actions"
                  className="absolute right-0 z-20 mt-2 min-w-44 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]"
                    onClick={() => openAction('ADD_NOTE')}
                  >
                    Add note
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)]"
                    onClick={() =>
                      openAction(device.issueReason ? 'RESOLVE_FLAG' : 'FLAG')
                    }
                  >
                    {device.issueReason ? 'Resolve issue' : 'Flag issue'}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        }
      />

      {message ? (
        <p role="status" className="mb-3 text-sm text-[var(--success)]">
          {message}
        </p>
      ) : null}

      <nav
        aria-label="Device detail sections"
        className="mb-5 overflow-x-auto border-b border-[var(--border)]"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                className={
                  'border-b-2 px-4 py-3 text-sm font-semibold transition ' +
                  (active
                    ? 'border-[var(--accent)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-strong)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]')
                }
                onClick={() => {
                  setActionsOpen(false)
                  setActiveTab(tab.id)
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      {activeTab === 'overview' ? (
        <OverviewTab
          device={device}
          sitePath={sitePath}
          current={current}
          currentPlatform={currentPlatform}
          migration={migration}
          onOpenFirmware={() => setActiveTab('firmware')}
          onOpenNotes={() => setActiveTab('notes')}
        />
      ) : null}

      {activeTab === 'firmware' ? <FirmwareTab device={device} /> : null}

      {activeTab === 'compliance' ? (
        <ComplianceTab device={device} />
      ) : null}

      {activeTab === 'network' ? (
        <NetworkTab device={device} sitePath={sitePath} />
      ) : null}

      {activeTab === 'notes' ? (
        <NotesIssuesTab
          device={device}
          onAddNote={() => openAction('ADD_NOTE')}
          onIssue={() =>
            openAction(device.issueReason ? 'RESOLVE_FLAG' : 'FLAG')
          }
        />
      ) : null}

      {activeTab === 'history' ? <HistoryTab device={device} /> : null}

      {editOpen ? (
        <DeviceEditModal
          device={device}
          onClose={() => setEditOpen(false)}
          onSaved={onUpdate}
        />
      ) : null}

      {panel ? (
        <Modal
          title={actionTitle}
          busy={saving}
          onClose={() => setPanel(null)}
        >
          <form onSubmit={save}>
            {panel === 'RESOLVE_FLAG' ? (
              <p className="text-sm">
                Resolve “{device.issueReason}”? The issue remains in history.
              </p>
            ) : (
              <>
                <label
                  className="mb-2 block text-sm font-semibold"
                  htmlFor="device-annotation"
                >
                  {panel === 'FLAG' ? 'What needs investigation?' : 'Note'}
                </label>
                <TextArea
                  id="device-annotation"
                  required
                  maxLength={1000}
                  rows={4}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </>
            )}

            {error ? (
              <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button disabled={saving} onClick={() => setPanel(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : actionTitle}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}

function OverviewTab({
  device,
  sitePath,
  current,
  currentPlatform,
  migration,
  onOpenFirmware,
  onOpenNotes,
}: {
  device: DeviceDetailRecord
  sitePath: string
  current: string | null | undefined
  currentPlatform: string | undefined
  migration: boolean
  onOpenFirmware: () => void
  onOpenNotes: () => void
}) {
  const desired = device.desiredFirmware.release
  const exception = device.exceptionSummary
  const source = device.externalProvider ?? humanize(device.source)

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
      <PanelCard title="Device information">
        <DetailList>
          <DetailRow label="Hostname" value={device.hostname ?? '—'} />
          <DetailRow
            label="Management IP"
            value={device.managementAddress ?? '—'}
          />
          <DetailRow label="Serial number" value={device.serialNumber ?? '—'} />
          <DetailRow
            label="Model"
            value={
              <Link
                href={'/models/' + device.deviceModel.id}
                className="font-medium text-[var(--accent-light)] hover:underline"
              >
                {device.deviceModel.model}
              </Link>
            }
          />
          <DetailRow label="Vendor" value={device.deviceModel.vendor.name} />
          <DetailRow
            label="Device type"
            value={device.deviceModel.deviceType.name}
          />
          <DetailRow
            label="Site"
            value={
              device.site ? (
                <Link
                  href={sitePath}
                  className="font-medium text-[var(--accent-light)] hover:underline"
                >
                  {device.site.name}
                </Link>
              ) : (
                'Unassigned'
              )
            }
          />
          <DetailRow
            label="Customer"
            value={
              <Link
                href={'/devices/customers/' + device.customerId}
                className="font-medium text-[var(--accent-light)] hover:underline"
              >
                {device.customer.name}
              </Link>
            }
          />
          <DetailRow
            label="Contract"
            value={device.effectiveContractType?.name ?? 'No contract type'}
          />
          <DetailRow
            label="Source"
            value={
              device.externalProvider ? (
                <>
                  {source}
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {humanize(device.source)}
                  </span>
                </>
              ) : (
                source
              )
            }
          />
          <DetailRow label="External ID" value={device.externalId ?? '—'} />
          <DetailRow
            label="Last synchronized"
            value={formatDate(device.lastSynchronizedAt, 'Never / manual')}
          />
        </DetailList>
      </PanelCard>

      <div className="space-y-5">
        <PanelCard title="Firmware">
          <DetailList>
            <DetailRow
              label="Current version"
              value={
                current
                  ? migration && currentPlatform
                    ? currentPlatform + ' ' + current
                    : current
                  : 'Unknown'
              }
            />
            <DetailRow
              label="Preferred version"
              value={
                desired
                  ? migration
                    ? desired.platform + ' ' + desired.version
                    : desired.version
                  : 'No resolved preferred target'
              }
            />
            <DetailRow
              label="Minimum acceptable"
              value={device.firmwareCompliance.minimum?.version ?? '—'}
            />
            <DetailRow
              label="Train"
              value={
                desired?.firmwareTrain?.name ??
                device.firmwareCompliance.preferredTarget?.firmwareTrain?.name ??
                '—'
              }
            />
          </DetailList>
          <button
            type="button"
            aria-label="View firmware details"
            className="mt-4 text-sm font-semibold text-[var(--accent-light)] hover:underline"
            onClick={onOpenFirmware}
          >
            View firmware details →
          </button>
        </PanelCard>

        <PanelCard title="Status & compliance">
          <DetailList>
            <DetailRow
              label="Technical compliance"
              value={
                <FirmwareComplianceStatus result={device.firmwareCompliance} />
              }
            />
            <DetailRow
              label="Recommendation"
              value={humanize(device.firmwareCompliance.recommendation)}
            />
            <DetailRow
              label="Exception state"
              value={humanize(exception.state)}
            />
            <DetailRow
              label="Workflow"
              value={
                device.lifecycle ? (
                  <WorkflowStatusBadge state={device.lifecycle.state} />
                ) : (
                  '—'
                )
              }
            />
            {device.issueReason ? (
              <DetailRow
                label="Device issue"
                value={
                  <button
                    type="button"
                    className="text-left font-medium text-[var(--info)] hover:underline"
                    onClick={onOpenNotes}
                  >
                    Needs investigation
                  </button>
                }
              />
            ) : null}
          </DetailList>
        </PanelCard>

        <PanelCard title="Maintenance">
          {device.planning.activePlans.length ? (
            <ul className="space-y-3">
              {device.planning.activePlans.map((plan) => (
                <li key={plan.id}>
                  <Link
                    className="text-sm font-semibold text-[var(--accent-light)] hover:underline"
                    href={'/planning/' + plan.id}
                  >
                    {plan.title ?? 'Maintenance plan'}
                  </Link>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {humanize(plan.state)}
                    {plan.scheduledFor
                      ? ' · ' + formatDate(plan.scheduledFor)
                      : plan.proposedFor
                        ? ' · proposed ' + formatDate(plan.proposedFor)
                        : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Not included in a maintenance plan.
            </p>
          )}
          <Link
            className="mt-4 inline-block text-sm font-semibold text-[var(--accent-light)] hover:underline"
            href="/planning"
          >
            Open maintenance planning →
          </Link>
        </PanelCard>
      </div>
    </div>
  )
}

function FirmwareTab({ device }: { device: DeviceDetailRecord }) {
  const desired = device.desiredFirmware.release
  const currentVersion =
    device.currentFirmwareRelease?.version ??
    device.currentFirmwareNormalizedVersion ??
    device.currentFirmwareRawVersion
  const resolvedCurrent =
    device.currentFirmwareRelease ?? device.firmwareCompliance.currentFirmware

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <PanelCard title="Observed firmware">
          <DetailList>
            <DetailRow
              label="Current release"
              value={
                device.currentFirmwareRelease ? (
                  <Link
                    href={'/firmware/' + device.currentFirmwareRelease.id}
                    className="font-mono font-semibold text-[var(--accent-light)] hover:underline"
                  >
                    {device.currentFirmwareRelease.version}
                  </Link>
                ) : (
                  currentVersion ?? 'Unknown'
                )
              }
            />
            <DetailRow
              label="Raw observation"
              value={device.currentFirmwareRawVersion ?? '—'}
            />
            <DetailRow
              label="Current platform"
              value={resolvedCurrent?.platform ?? 'Unknown'}
            />
            <DetailRow
              label="Current train"
              value={resolvedCurrent?.firmwareTrain?.name ?? '—'}
            />
            <DetailRow
              label="Firmware source"
              value={currentVersion ? humanize(device.currentFirmwareSource) : '—'}
            />
            <DetailRow
              label="Observed / reported"
              value={formatDate(device.currentFirmwareObservedAt, 'Unknown')}
            />
            <DetailRow
              label="Observation age"
              value={currentVersion ? firmwareAge(device.currentFirmwareAgeDays) : '—'}
            />
          </DetailList>
        </PanelCard>

        <PanelCard title="Effective target">
          <DetailList>
            <DetailRow
              label="Preferred release"
              value={
                desired ? (
                  <Link
                    href={'/firmware/' + desired.id}
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
              label="Minimum acceptable"
              value={device.firmwareCompliance.minimum?.version ?? '—'}
            />
            <DetailRow
              label="Maximum"
              value={device.firmwareCompliance.maximum?.version ?? '—'}
            />
            <DetailRow
              label="Desired train"
              value={desired?.firmwareTrain?.name ?? '—'}
            />
            <DetailRow
              label="Policy source"
              value={
                device.firmwareCompliance.policySource
                  ? device.firmwareCompliance.policySource.scope +
                    ' · ' +
                    device.firmwareCompliance.policySource.trackName +
                    ' · v' +
                    device.firmwareCompliance.policySource.policyVersion
                  : 'No resolved policy'
              }
            />
            <DetailRow
              label="Policy mode"
              value={
                device.firmwareCompliance.effectivePolicy.policy?.policyMode
                  ? humanize(
                      device.firmwareCompliance.effectivePolicy.policy.policyMode,
                    )
                  : '—'
              }
            />
          </DetailList>
        </PanelCard>
      </div>

      <PanelCard title="Firmware details">
        <p className="mb-4 text-sm text-[var(--muted-strong)]">
          {deviceFirmwareSummary(device)}
        </p>
        <DetailList>
          <DetailRow
            label="Technical state"
            value={<FirmwareComplianceStatus result={device.firmwareCompliance} />}
          />
          <DetailRow
            label="Preferred position"
            value={humanize(device.firmwareCompliance.relationToPreferred)}
          />
          <DetailRow
            label="Recommendation"
            value={humanize(device.firmwareCompliance.recommendation)}
          />
          <DetailRow
            label="Target compatibility"
            value={
              device.firmwareCompliance.targetCompatibility?.status
                ? humanize(device.firmwareCompliance.targetCompatibility.status)
                : 'Unknown'
            }
          />
          <DetailRow
            label="Resolved image"
            value={device.firmwareCompliance.resolvedTarget?.version ?? 'Unresolved'}
          />
          <DetailRow
            label="Explanation"
            value={device.firmwareCompliance.explanation}
          />
        </DetailList>
        {desired && !desired.isActive ? (
          <p className="mt-4 text-sm text-[var(--warning)]">
            The effective preferred release is archived and requires policy
            review.
          </p>
        ) : null}
      </PanelCard>
    </div>
  )
}

function ComplianceTab({ device }: { device: DeviceDetailRecord }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <PanelCard title="Compliance">
          <DetailList>
            <DetailRow
              label="Technical compliance"
              value={<FirmwareComplianceStatus result={device.firmwareCompliance} />}
            />
            <DetailRow
              label="Recommendation"
              value={humanize(device.firmwareCompliance.recommendation)}
            />
            <DetailRow
              label="Preferred position"
              value={humanize(device.firmwareCompliance.relationToPreferred)}
            />
            <DetailRow
              label="Policy track"
              value={
                device.firmwareCompliance.effectiveTrack
                  ? device.firmwareCompliance.effectiveTrack.name
                  : '—'
              }
            />
            <DetailRow
              label="Explanation"
              value={device.firmwareCompliance.explanation}
            />
          </DetailList>
        </PanelCard>

        <PanelCard title="Workflow">
          <DetailList>
            <DetailRow
              label="Lifecycle state"
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
                  ? device.lifecycle.targetFirmwareRelease.platform +
                    ' ' +
                    device.lifecycle.targetFirmwareRelease.version
                  : '—'
              }
            />
            <DetailRow
              label="Active maintenance plans"
              value={String(device.planning.activePlans.length)}
            />
            <DetailRow
              label="Exception state"
              value={humanize(device.exceptionSummary.state)}
            />
          </DetailList>
        </PanelCard>
      </div>

      <DeviceExceptions deviceId={device.id} />
    </div>
  )
}

export function NetworkTab({
  device,
  sitePath,
}: {
  device: DeviceDetailRecord
  sitePath: string
}) {
  const topology = device.topology
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <PanelCard title="Management identity">
          <DetailList>
            <DetailRow label="Hostname" value={device.hostname ?? '—'} />
            <DetailRow
              label="Management address"
              value={device.managementAddress ?? '—'}
            />
            <DetailRow
              label="Site"
              value={
                device.site ? (
                  <Link
                    href={sitePath}
                    className="font-medium text-[var(--accent-light)] hover:underline"
                  >
                    {device.site.name}
                  </Link>
                ) : (
                  'Unassigned'
                )
              }
            />
            <DetailRow label="Vendor" value={device.deviceModel.vendor.name} />
            <DetailRow label="Model" value={device.deviceModel.model} />
            <DetailRow
              label="Device type"
              value={device.deviceModel.deviceType.name}
            />
          </DetailList>
        </PanelCard>

        <PanelCard title="Inventory source">
          <DetailList>
            <DetailRow label="Source" value={humanize(device.source)} />
            <DetailRow
              label="External provider"
              value={device.externalProvider ?? '—'}
            />
            <DetailRow label="External ID" value={device.externalId ?? '—'} />
            <DetailRow
              label="Last synchronized"
              value={formatDate(device.lastSynchronizedAt, 'Never / manual')}
            />
            <DetailRow
              label="Current firmware source"
              value={humanize(device.currentFirmwareSource)}
            />
          </DetailList>
        </PanelCard>
      </div>

      {topology?.kind === 'STACK' && topology.members.length > 0 ? (
        <PanelCard title="Stack members">
          <p className="mb-4 text-sm text-[var(--muted-strong)]">
            Physical members belong to this logical stack. They remain available
            as hardware and firmware evidence here, but are not separate
            Inventory, compliance, planning, or reporting devices.
          </p>
          <div className="overflow-x-auto rounded-md border border-[var(--border)]">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-[var(--surface-raised)] text-xs uppercase tracking-[0.06em] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Serial</th>
                  <th className="px-3 py-2">Firmware</th>
                  <th className="px-3 py-2">Source ID</th>
                  <th className="px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {topology.members.map((member) => (
                  <tr key={member.id}>
                    <td className="px-3 py-2 font-mono font-semibold">
                      {member.position}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {member.name ?? member.hostname ?? 'Unnamed member'}
                      </div>
                      {!member.isActive ? (
                        <div className="mt-0.5 text-xs text-[var(--warning)]">
                          No longer active
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {member.deviceModel?.model ?? 'Unknown model'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {member.serialNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {member.firmwareRelease?.version ??
                        member.normalizedFirmwareVersion ??
                        member.rawFirmwareVersion ??
                        member.rawSoftwareVersion ??
                        '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {member.sourceId ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted-strong)]">
                      {formatDate(member.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      ) : null}
    </div>
  )
}

function NotesIssuesTab({
  device,
  onAddNote,
  onIssue,
}: {
  device: DeviceDetailRecord
  onAddNote: () => void
  onIssue: () => void
}) {
  return (
    <PanelCard
      title="Notes & issues"
      actions={
        <>
          <Button onClick={onAddNote}>Add note</Button>
          <Button onClick={onIssue}>
            {device.issueReason ? 'Resolve issue' : 'Flag issue'}
          </Button>
        </>
      }
    >
      {device.issueReason ? (
        <section
          aria-label="Open device issue"
          className="border-b border-[var(--border)] pb-5"
        >
          <h3 className="text-sm font-semibold">Needs investigation</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--muted-strong)]">
            {device.issueReason}
          </p>
          {device.issueFlaggedAt ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Flagged {formatDate(device.issueFlaggedAt)}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="border-b border-[var(--border)] pb-5 text-sm text-[var(--muted)]">
          No open device issue.
        </p>
      )}

      <section aria-label="Device notes" className="pt-5">
        <h3 className="text-sm font-semibold">Device notes</h3>
        {device.notes ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--muted-strong)]">
            {device.notes}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No device notes recorded.
          </p>
        )}
      </section>
    </PanelCard>
  )
}

function HistoryTab({ device }: { device: DeviceDetailRecord }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <PanelCard title="Record history">
          <DetailList>
            <DetailRow label="Created" value={formatDate(device.createdAt)} />
            <DetailRow label="Updated" value={formatDate(device.updatedAt)} />
            <DetailRow
              label="Last synchronized"
              value={formatDate(device.lastSynchronizedAt, 'Never / manual')}
            />
            <DetailRow
              label="Source"
              value={device.externalProvider ?? humanize(device.source)}
            />
          </DetailList>
        </PanelCard>

        <PanelCard title="Previous decisions">
          {device.lifecycle ? (
            <DetailList>
              <DetailRow
                label="Lifecycle state"
                value={<WorkflowStatusBadge state={device.lifecycle.state} />}
              />
              <DetailRow
                label="Target"
                value={
                  device.lifecycle.targetFirmwareRelease.platform +
                  ' ' +
                  device.lifecycle.targetFirmwareRelease.version
                }
              />
              <DetailRow
                label="Decided"
                value={formatDate(device.lifecycle.decidedAt)}
              />
              <DetailRow
                label="Reason"
                value={device.lifecycle.reason ?? '—'}
              />
            </DetailList>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No previous lifecycle decision.
            </p>
          )}

          {device.planning.history.length ? (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <h3 className="text-sm font-semibold">Previous maintenance plans</h3>
              <ul className="mt-3 space-y-2">
                {device.planning.history.map((plan) => (
                  <li key={plan.id}>
                    <Link
                      href={'/planning/' + plan.id}
                      className="text-sm text-[var(--accent-light)] hover:underline"
                    >
                      {plan.title ?? 'Maintenance plan'} · {humanize(plan.state)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </PanelCard>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-semibold">Audit history</h2>
        </div>
        <AuditHistory
          events={device.auditHistory}
          emptyText="No changes recorded."
        />
      </section>
    </div>
  )
}

function PanelCard({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

function DetailList({ children }: { children: ReactNode }) {
  return <dl className="space-y-3">{children}</dl>
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(130px,0.8fr)_minmax(0,1.2fr)] gap-4 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-[var(--foreground)]">
        {value}
      </dd>
    </div>
  )
}
