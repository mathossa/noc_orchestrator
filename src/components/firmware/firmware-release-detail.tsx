'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { firmwareReleaseDecisions } from '@/lib/firmware-catalog-defaults'
import { deviceFilterHref } from '@/lib/drilldown-links'
import type { FirmwareReleaseDetailRecord } from '@/lib/firmware-releases'
import type { FirmwareTrainRecord } from '@/lib/firmware-trains'

type ApiError = { error?: { message?: string } }

type EditForm = {
  firmwareTrainId: string
  decision: string
  releaseNotesUrl: string
  notes: string
}

function editFormFor(release: FirmwareReleaseDetailRecord): EditForm {
  return {
    firmwareTrainId: release.firmwareTrainId ?? '',
    decision: release.decision,
    releaseNotesUrl: release.releaseNotesUrl ?? '',
    notes: release.notes ?? '',
  }
}

function formatBytes(value: string | null) {
  if (!value) return '—'
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return `${value} bytes`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

export function FirmwareReleaseDetail({ releaseId }: { releaseId: string }) {
  const [release, setRelease] = useState<FirmwareReleaseDetailRecord | null>(null)
  const [trains, setTrains] = useState<FirmwareTrainRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    firmwareTrainId: '',
    decision: 'NEEDS_REVIEW',
    releaseNotesUrl: '',
    notes: '',
  })

  async function loadRelease() {
    const response = await fetch(`/api/v1/firmware-releases/${releaseId}`, { cache: 'no-store' })
    const payload = (await response.json()) as { data?: FirmwareReleaseDetailRecord } & ApiError
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Firmware release could not be loaded.')
    setRelease(payload.data)
    setEditForm(editFormFor(payload.data))
    return payload.data
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch(`/api/v1/firmware-releases/${releaseId}`, { cache: 'no-store' }),
      fetch('/api/v1/firmware-trains', { cache: 'no-store' }),
    ])
      .then(async ([releaseResponse, trainResponse]) => {
        const releasePayload = (await releaseResponse.json()) as { data?: FirmwareReleaseDetailRecord } & ApiError
        const trainPayload = (await trainResponse.json()) as { data?: FirmwareTrainRecord[] } & ApiError
        if (!releaseResponse.ok || !releasePayload.data) throw new Error(releasePayload.error?.message ?? 'Firmware release could not be loaded.')
        if (!trainResponse.ok) throw new Error(trainPayload.error?.message ?? 'Firmware trains could not be loaded.')
        if (!cancelled) {
          setRelease(releasePayload.data)
          setEditForm(editFormFor(releasePayload.data))
          setTrains(trainPayload.data ?? [])
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Firmware release could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [releaseId])

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setEditError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/v1/firmware-releases/${releaseId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firmwareTrainId: editForm.firmwareTrainId || null,
          decision: editForm.decision,
          releaseNotesUrl: editForm.releaseNotesUrl || null,
          notes: editForm.notes || null,
        }),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'Firmware release could not be updated.')
      await loadRelease()
      setEditing(false)
      setMessage('Firmware release updated.')
    } catch (saveError: unknown) {
      setEditError(saveError instanceof Error ? saveError.message : 'Firmware release could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState title="Loading firmware release" description="Reading catalog metadata and usage…" />
  if (error || !release) {
    return (
      <ErrorState
        title="Firmware release could not be loaded"
        description={error ?? 'The catalog record is unavailable.'}
        action={
          <Link
            href="/firmware"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold"
          >
            Back to firmware
          </Link>
        }
      />
    )
  }

  const currentDevicesHref = deviceFilterHref({ currentFirmware: release.id })
  const desiredDevicesHref = deviceFilterHref({ desiredFirmware: release.id })
  const matchingTrains = trains.filter(
    (train) =>
      train.isActive &&
      train.vendorId === release.vendorId &&
      train.platform.normalize('NFKC').trim().toLocaleLowerCase('en-US') ===
        release.platform.normalize('NFKC').trim().toLocaleLowerCase('en-US'),
  )

  return (
    <>
      <PageHeader
        eyebrow="Firmware release"
        title={`${release.vendor.name} ${release.version}`}
        breadcrumbs={[
          { label: 'Firmware catalog', href: '/firmware' },
          ...(release.firmwareTrain
            ? [{ label: release.firmwareTrain.name, href: `/firmware/trains/${release.firmwareTrain.id}` }]
            : []),
          { label: release.version },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing((value) => !value)
                setEditError(null)
                setMessage(null)
              }}
            >
              {editing ? 'Cancel edit' : 'Edit release'}
            </Button>
            <ButtonLink href={currentDevicesHref}>Devices currently on release</ButtonLink>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat
          label="Current on devices"
          value={
            <Link href={currentDevicesHref} className="text-[var(--accent-light)] hover:underline">
              {release.usage.currentDevices}
            </Link>
          }
          detail="Devices whose recorded current firmware points to this exact release."
        />
        <SummaryStat
          label="Customers / sites"
          value={`${release.usage.customers} / ${release.usage.sites}`}
          detail="Operational spread of devices currently running this release."
        />
        <SummaryStat
          label="Train"
          value={release.firmwareTrain?.name ?? 'Unassigned'}
          detail={release.platform}
        />
        <SummaryStat
          label="Release decision"
          value={release.decision === 'NEEDS_REVIEW' ? 'Needs review' : release.decision}
          detail="Allowed/blocked state is separate from preferred/minimum train policy."
        />
      </div>

      {release.catalogState === 'BLOCKED' || release.catalogState === 'WITHDRAWN' ? (
        <div
          className="mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]"
          role="alert"
        >
          This exact release is {release.catalogState.toLowerCase()} and cannot be selected as a new desired target.
        </div>
      ) : null}

      {message ? <div className="mt-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}

      {editing ? (
        <form id="edit-release" onSubmit={saveEdit} className="mt-4 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold">Edit release</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Update operational catalog decisions and train assignment. Vendor, platform, and exact version stay stable so historical device and planning references keep their identity.
            </p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Exact release" htmlFor="release-edit-version">
              <TextInput id="release-edit-version" value={release.version} readOnly />
            </FormField>
            <FormField label="Train" htmlFor="release-edit-train">
              <SelectInput id="release-edit-train" value={editForm.firmwareTrainId} onChange={(event) => setEditForm({ ...editForm, firmwareTrainId: event.target.value })}>
                <option value="">Unassigned</option>
                {matchingTrains.map((train) => <option key={train.id} value={train.id}>{train.name} · {train.state}</option>)}
              </SelectInput>
            </FormField>
            <FormField label="Release decision" htmlFor="release-edit-decision">
              <SelectInput id="release-edit-decision" value={editForm.decision} onChange={(event) => setEditForm({ ...editForm, decision: event.target.value })}>
                {firmwareReleaseDecisions.map((decision) => <option key={decision} value={decision}>{decision === 'NEEDS_REVIEW' ? 'Needs review' : decision[0] + decision.slice(1).toLowerCase()}</option>)}
              </SelectInput>
            </FormField>
            <FormField label="Release notes URL" htmlFor="release-edit-notes-url">
              <TextInput id="release-edit-notes-url" type="url" value={editForm.releaseNotesUrl} onChange={(event) => setEditForm({ ...editForm, releaseNotesUrl: event.target.value })} />
            </FormField>
            <div className="md:col-span-2">
              <FormField label="Notes" htmlFor="release-edit-notes">
                <TextArea id="release-edit-notes" value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} />
              </FormField>
            </div>
          </div>
          {editError ? <p className="mt-3 text-sm text-red-300" role="alert">{editError}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setEditing(false); setEditForm(editFormFor(release)); setEditError(null) }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save release'}</Button>
          </div>
        </form>
      ) : null}

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Release identity</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Core identity and decision are shown first. Detailed provenance is collapsed unless you need it.
            </p>
          </div>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <DetailRow
            label="Vendor"
            value={
              <Link href={`/vendors/${release.vendor.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">
                {release.vendor.name}
              </Link>
            }
          />
          <DetailRow label="Platform" value={release.platform} />
          <DetailRow
            label="Train"
            value={
              release.firmwareTrain ? (
                <Link href={`/firmware/trains/${release.firmwareTrain.id}`} className="text-[var(--accent-light)] hover:underline">
                  {release.firmwareTrain.name}
                </Link>
              ) : (
                'Unassigned'
              )
            }
          />
          <DetailRow label="Exact version" value={release.version} mono />
          <DetailRow label="Release decision" value={release.decision === 'NEEDS_REVIEW' ? 'Needs review' : release.decision} />
          <DetailRow label="Record state" value={release.isActive ? 'Active' : 'Archived'} />
        </dl>

        {release.releaseNotesUrl ? (
          <a
            className="mt-4 inline-block text-sm font-semibold text-[var(--accent-light)] hover:underline"
            href={release.releaseNotesUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open release notes
          </a>
        ) : null}

        <details className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-raised)]">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Advanced metadata</summary>
          <dl className="space-y-3 border-t border-[var(--border)] p-3 text-sm">
            <DetailRow label="Logical release" value={release.logicalVersion} mono />
            <DetailRow label="Variant" value={release.variant ?? '—'} mono />
            <DetailRow label="Image code" value={release.imageCode ?? '—'} mono />
            <DetailRow label="Variant rule" value={release.variantEquivalence} />
            <DetailRow label="Catalog state" value={release.catalogState} />
            <DetailRow label="Policy eligibility" value={release.policyEligibility} />
            <DetailRow label="Policy targets" value={String(release.usage.targetPolicies)} />
            <DetailRow label="Historical lifecycle targets" value={String(release.usage.lifecycleTargets)} />
            <DetailRow label="Release date" value={release.releasedAt ? new Date(release.releasedAt).toLocaleDateString() : '—'} />
            <DetailRow label="Filename" value={release.filename ?? '—'} />
            <DetailRow label="File size" value={formatBytes(release.fileSizeBytes)} />
            <DetailRow label="SHA256" value={release.sha256 ?? '—'} mono />
            <DetailRow label="Source" value={release.source} />
            <DetailRow
              label="Last synchronized"
              value={release.lastSynchronizedAt ? new Date(release.lastSynchronizedAt).toLocaleString() : 'Never / manual'}
            />
            <DetailRow label="External provider" value={release.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={release.externalId ?? '—'} />
          </dl>
          {release.notes ? (
            <div className="border-t border-[var(--border)] p-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">
              {release.notes}
            </div>
          ) : null}
        </details>

        {release.usage.targetPolicies > 0 ? (
          <div className="mt-4 text-xs text-[var(--muted)]">
            This release is referenced by {release.usage.targetPolicies} explicit policy target{release.usage.targetPolicies === 1 ? '' : 's'}.
            {' '}<Link href={desiredDevicesHref} className="font-semibold text-[var(--accent-light)] hover:underline">View devices desiring this release</Link>
          </div>
        ) : null}
      </section>
    </>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className={`min-w-0 break-words text-[var(--muted-strong)] ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}
