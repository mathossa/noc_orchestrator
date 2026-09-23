'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { TextArea } from '@/components/ui/form-controls'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { InventoryStatusBadge } from './inventory-explorer'
import { DeviceDiagnostics } from './device-diagnostics'
import { deviceFirmwareSummary } from '@/lib/device-overview'
import type { DeviceDetailRecord } from '@/lib/devices'

type ApiPayload = { data?: DeviceDetailRecord; error?: { message?: string } }
type Action = 'ADD_NOTE' | 'FLAG' | 'RESOLVE_FLAG'

export function DeviceDetail({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<DeviceDetailRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/v1/devices/${deviceId}`, {
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
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
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
  return <DeviceOverview key={device.id} device={device} onUpdate={setDevice} />
}

export function DeviceOverview({
  device,
  onUpdate,
}: {
  device: DeviceDetailRecord
  onUpdate: (device: DeviceDetailRecord) => void
}) {
  const [panel, setPanel] = useState<'details' | Action | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const sitePath = `/devices/customers/${device.customerId}/sites/${device.siteId ?? 'unassigned'}`
  const groupPath = `${sitePath}/types/${device.deviceModel.deviceType.id}`
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
  const exception = device.exceptionSummary
  const title =
    panel === 'ADD_NOTE'
      ? 'Add note'
      : panel === 'FLAG'
        ? 'Flag issue'
        : 'Resolve issue'

  function open(next: typeof panel) {
    setText('')
    setError(null)
    setMessage('')
    setPanel(next)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/devices/${device.id}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: panel, text }),
      })
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
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
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
            href: `/devices/customers/${device.customerId}`,
          },
          { label: device.site?.name ?? 'Unassigned devices', href: sitePath },
          { label: device.deviceModel.deviceType.name, href: groupPath },
          { label: device.name },
        ]}
        description={`${device.deviceModel.model} · ${device.deviceModel.deviceType.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => open('ADD_NOTE')}>Add note</Button>
            {!device.issueReason ? (
              <Button onClick={() => open('FLAG')}>Flag issue</Button>
            ) : null}
            <ButtonLink
              href={'/devices/manage?edit=' + encodeURIComponent(device.id)}
            >
              Edit device
            </ButtonLink>
          </div>
        }
      />
      {message ? (
        <p role="status" className="mb-3 text-sm text-[var(--success)]">
          {message}
        </p>
      ) : null}
      {!device.isActive ? (
        <p className="mb-3 text-sm text-[var(--warning)]">Archived device</p>
      ) : null}

      <section
        aria-label="Device overview"
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">Firmware</h2>
              <InventoryStatusBadge status={device.inventoryStatus} />
            </div>
            <p
              className="mt-3 font-mono text-xl"
              aria-label="Current firmware and effective target"
            >
              {migration ? `${currentPlatform} ` : ''}
              {current ?? 'Unknown'}
              {device.inventoryStatus.code !== 'CURRENT' && desired ? (
                <>
                  {' '}
                  <span className="text-[var(--muted)]">→</span>{' '}
                  {migration ? `${desired.platform} ` : ''}
                  {desired.version}
                </>
              ) : null}
            </p>
            <p className="mt-2 text-sm">{deviceFirmwareSummary(device)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
              <span>
                {device.currentFirmwareAgeDays === null
                  ? 'Observation date unknown'
                  : device.currentFirmwareAgeDays === 0
                    ? 'Observed today'
                    : `Observed ${device.currentFirmwareAgeDays} days ago`}
              </span>
              <button
                className="text-[var(--accent-light)] hover:underline"
                onClick={() => open('details')}
              >
                Firmware details
              </button>
            </div>
          </div>
          <div className="border-t border-[var(--border)] pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
            <h2 className="text-sm font-semibold">Maintenance</h2>
            {device.planning.activePlans.length ? (
              <ul className="mt-3 space-y-3">
                {device.planning.activePlans.map((plan) => (
                  <li key={plan.id}>
                    <Link
                      className="text-sm font-semibold text-[var(--accent-light)] hover:underline"
                      href={'/planning/' + plan.id}
                    >
                      {plan.title ?? 'Maintenance plan'}
                    </Link>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {plan.state.replaceAll('_', ' ').toLowerCase()}
                      {plan.scheduledFor
                        ? ' · ' + new Date(plan.scheduledFor).toLocaleString()
                        : plan.proposedFor
                          ? ' · proposed ' +
                            new Date(plan.proposedFor).toLocaleString()
                          : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Not included in a maintenance plan.
              </p>
            )}
            <Link
              className="mt-3 inline-block text-xs text-[var(--accent-light)] hover:underline"
              href="/planning"
            >
              Open maintenance planning →
            </Link>
          </div>
        </div>
        {device.managementAddress ||
        device.serialNumber ||
        (device.hostname && device.hostname !== device.name) ? (
          <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--border)] px-5 py-3">
            {device.managementAddress ? (
              <CopyFact
                label="Management address"
                value={device.managementAddress}
              />
            ) : null}
            {device.serialNumber ? (
              <CopyFact label="Serial" value={device.serialNumber} />
            ) : null}
            {device.hostname && device.hostname !== device.name ? (
              <CopyFact label="Hostname" value={device.hostname} />
            ) : null}
          </dl>
        ) : null}
      </section>

      {exception.state !== 'NONE' ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
          <span>
            {exception.state === 'ACTIVE'
              ? 'Exception'
              : exception.state === 'REVIEW_DUE'
                ? 'Exception review due'
                : 'Exception expired'}
            {exception.effective
              ? `: ${exception.effective.reasonLabel} · ${exception.effective.scope.toLowerCase()}`
              : ''}
          </span>
          <Button variant="ghost" onClick={() => open('details')}>
            View exception
          </Button>
        </div>
      ) : null}
      {device.issueReason ? (
        <section
          aria-label="Open device issue"
          className="mt-4 rounded-md border border-[var(--info-border)] bg-[var(--info-soft)] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Needs investigation</h2>
            <Button onClick={() => open('RESOLVE_FLAG')}>Resolve issue</Button>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {device.issueReason}
          </p>
        </section>
      ) : null}
      {device.notes ? (
        <section aria-label="Device notes" className="mt-4 text-sm">
          <h2 className="font-semibold">Notes</h2>
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[var(--muted-strong)]">
            {device.notes}
          </p>
        </section>
      ) : null}
      <div className="mt-4">
        <Button variant="ghost" onClick={() => open('details')}>
          Details &amp; history
        </Button>
      </div>

      {panel === 'details' ? (
        <Modal
          title="Device details & history"
          panel
          onClose={() => setPanel(null)}
        >
          <DeviceDiagnostics device={device} />
        </Modal>
      ) : null}
      {panel && panel !== 'details' ? (
        <Modal title={title} busy={saving} onClose={() => setPanel(null)}>
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
                {saving ? 'Saving…' : title}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}

function CopyFact({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setMessage('Copied')
    } catch {
      setMessage('Select the value to copy')
    }
  }
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 text-sm">
        <span className="select-all break-all font-mono">{value}</span>
        <button
          className="text-xs text-[var(--accent-light)] hover:underline"
          aria-label={'Copy ' + label}
          onClick={() => void copy()}
        >
          Copy
        </button>
        <span role="status" className="text-xs">
          {message}
        </span>
      </dd>
    </div>
  )
}
