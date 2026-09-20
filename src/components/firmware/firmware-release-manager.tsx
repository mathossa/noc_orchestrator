'use client'

import Link from 'next/link'
import { useMemo, useState, useEffect, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type {
  FirmwareReleaseFieldErrors,
  FirmwareReleaseRecord,
  FirmwareReleaseReference,
} from '@/lib/firmware-releases'
import type { FirmwareTrainRecord } from '@/lib/firmware-trains'
import { firmwareReleaseDecisions } from '@/lib/firmware-catalog-defaults'

type ApiError = { error?: { message?: string; fields?: FirmwareReleaseFieldErrors } }
type ReleasePayload = {
  data?: FirmwareReleaseRecord[]
  meta?: { vendors?: FirmwareReleaseReference[] }
} & ApiError
type TrainPayload = { data?: FirmwareTrainRecord[] } & ApiError

type PlatformKey = string

type AddForm = {
  vendorId: string
  platform: string
  firmwareTrainId: string
  version: string
  decision: string
  makePreferred: boolean
  logicalVersion: string
  variant: string
  imageCode: string
  releaseNotesUrl: string
  notes: string
}

const emptyAddForm: AddForm = {
  vendorId: '',
  platform: '',
  firmwareTrainId: '',
  version: '',
  decision: 'ALLOWED',
  makePreferred: false,
  logicalVersion: '',
  variant: '',
  imageCode: '',
  releaseNotesUrl: '',
  notes: '',
}

function normalized(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function platformKey(vendorId: string, platform: string): PlatformKey {
  return `${vendorId}::${normalized(platform)}`
}

function decisionLabel(decision: FirmwareReleaseRecord['decision']) {
  if (decision === 'NEEDS_REVIEW') return 'Needs review'
  if (decision === 'ALLOWED') return 'Allowed'
  if (decision === 'BLOCKED') return 'Blocked'
  return 'Withdrawn'
}

function decisionClass(decision: FirmwareReleaseRecord['decision']) {
  if (decision === 'ALLOWED') return 'text-emerald-300'
  if (decision === 'NEEDS_REVIEW') return 'text-amber-300'
  return 'text-red-300'
}

export function FirmwareReleaseManager() {
  const [records, setRecords] = useState<FirmwareReleaseRecord[]>([])
  const [vendors, setVendors] = useState<FirmwareReleaseReference[]>([])
  const [trains, setTrains] = useState<FirmwareTrainRecord[]>([])
  const [selectedKey, setSelectedKey] = useState<PlatformKey | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [form, setForm] = useState<AddForm>(emptyAddForm)
  const [reviewTrain, setReviewTrain] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<FirmwareReleaseFieldErrors>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchCatalog() {
    const [releaseResponse, trainResponse] = await Promise.all([
      fetch('/api/v1/firmware-releases', { cache: 'no-store' }),
      fetch('/api/v1/firmware-trains', { cache: 'no-store' }),
    ])
    const releases = (await releaseResponse.json()) as ReleasePayload
    const trainData = (await trainResponse.json()) as TrainPayload
    if (!releaseResponse.ok) throw new Error(releases.error?.message ?? 'Firmware catalog could not be loaded.')
    if (!trainResponse.ok) throw new Error(trainData.error?.message ?? 'Firmware trains could not be loaded.')
    return {
      records: releases.data ?? [],
      vendors: releases.meta?.vendors ?? [],
      trains: trainData.data ?? [],
    }
  }

  function applyCatalog(payload: Awaited<ReturnType<typeof fetchCatalog>>) {
    setRecords(payload.records)
    setVendors(payload.vendors)
    setTrains(payload.trains)
    setSelectedKey((current) => {
      if (current) return current
      const firstTrain = payload.trains.find((train) => train.isActive)
      if (firstTrain) return platformKey(firstTrain.vendorId, firstTrain.platform)
      const firstRelease = payload.records.find((release) => release.isActive)
      return firstRelease ? platformKey(firstRelease.vendorId, firstRelease.platform) : null
    })
  }

  useEffect(() => {
    let cancelled = false
    void fetchCatalog()
      .then((payload) => {
        if (!cancelled) applyCatalog(payload)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Firmware catalog could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function reload() {
    applyCatalog(await fetchCatalog())
  }

  const platforms = useMemo(() => {
    const map = new Map<PlatformKey, { key: PlatformKey; vendorId: string; vendorName: string; platform: string; trainCount: number; releaseCount: number }>()
    for (const train of trains) {
      if (!showArchived && !train.isActive) continue
      const key = platformKey(train.vendorId, train.platform)
      const current = map.get(key) ?? {
        key,
        vendorId: train.vendorId,
        vendorName: train.vendor.name,
        platform: train.platform,
        trainCount: 0,
        releaseCount: 0,
      }
      current.trainCount += 1
      map.set(key, current)
    }
    for (const release of records) {
      if (!showArchived && !release.isActive) continue
      const key = platformKey(release.vendorId, release.platform)
      const current = map.get(key) ?? {
        key,
        vendorId: release.vendorId,
        vendorName: release.vendor.name,
        platform: release.platform,
        trainCount: 0,
        releaseCount: 0,
      }
      current.releaseCount += 1
      map.set(key, current)
    }
    return [...map.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.platform.localeCompare(b.platform, 'en', { numeric: true }))
  }, [trains, records, showArchived])

  const selected = platforms.find((platform) => platform.key === selectedKey) ?? platforms[0] ?? null
  const selectedTrains = useMemo(() => {
    if (!selected) return []
    return trains
      .filter((train) => platformKey(train.vendorId, train.platform) === selected.key)
      .filter((train) => showArchived || train.isActive)
      .sort((a, b) => {
        const stateOrder = { PREFERRED: 0, ACCEPTED: 1, DEPRECATED: 2 }
        return stateOrder[a.state] - stateOrder[b.state] || a.name.localeCompare(b.name, 'en', { numeric: true })
      })
  }, [trains, selected, showArchived])

  const selectedReleases = useMemo(() => {
    if (!selected) return []
    return records
      .filter((release) => platformKey(release.vendorId, release.platform) === selected.key)
      .filter((release) => showArchived || release.isActive)
      .filter((release) => !reviewOnly || release.decision === 'NEEDS_REVIEW')
  }, [records, selected, showArchived, reviewOnly])

  const releaseGroups = useMemo(() => {
    const groups = new Map<string, FirmwareReleaseRecord[]>()
    for (const release of selectedReleases) {
      const key = `${release.firmwareTrainId ?? 'unassigned'}::${release.logicalVersion}`
      const group = groups.get(key)
      if (group) group.push(release)
      else groups.set(key, [release])
    }
    return [...groups.entries()]
      .map(([key, releases]) => ({
        key,
        logicalVersion: releases[0].logicalVersion,
        trainName: releases[0].firmwareTrain?.name ?? 'Unassigned train',
        releases: releases.sort((a, b) => a.version.localeCompare(b.version, 'en', { numeric: true })),
      }))
      .sort((a, b) => a.logicalVersion.localeCompare(b.logicalVersion, 'en', { numeric: true }))
  }, [selectedReleases])

    const reviewCount = records.filter((release) => release.isActive && release.decision === 'NEEDS_REVIEW').length

  function openAddRelease() {
    if (!selected) return
    const defaultTrain = selectedTrains.find((train) => train.state === 'PREFERRED') ?? selectedTrains[0] ?? null
    setForm({
      ...emptyAddForm,
      vendorId: selected.vendorId,
      platform: selected.platform,
      firmwareTrainId: defaultTrain?.id ?? '',
    })
    setFieldErrors({})
    setAdvancedOpen(false)
    setAddOpen(true)
    setError(null)
    setMessage(null)
  }

  async function createRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFieldErrors({})
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/v1/firmware-releases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vendorId: form.vendorId,
          platform: form.platform,
          firmwareTrainId: form.firmwareTrainId || null,
          version: form.version,
          decision: form.decision,
          logicalVersion: form.logicalVersion || null,
          variant: form.variant || null,
          imageCode: form.imageCode || null,
          releaseNotesUrl: form.releaseNotesUrl || null,
          notes: form.notes || null,
        }),
      })
      const payload = (await response.json()) as { data?: FirmwareReleaseRecord } & ApiError
      if (!response.ok || !payload.data) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'Firmware release could not be saved.')
      }
      if (form.makePreferred) {
        if (!form.firmwareTrainId) throw new Error('Choose a train before making the release preferred.')
        const trainResponse = await fetch(`/api/v1/firmware-trains/${form.firmwareTrainId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preferredFirmwareReleaseId: payload.data.id }),
        })
        const trainPayload = (await trainResponse.json()) as ApiError
        if (!trainResponse.ok) throw new Error(trainPayload.error?.message ?? 'Release was added, but could not be made preferred.')
      }
      setMessage(`${payload.data.version} added to the catalog.`)
      setAddOpen(false)
      await reload()
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Firmware release could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function reviewRelease(
    release: FirmwareReleaseRecord,
    action: 'ALLOWED' | 'BLOCKED' | 'ARCHIVE' | 'REACTIVATE' | 'PREFERRED',
  ) {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const chosenTrainId = reviewTrain[release.id] ?? release.firmwareTrainId ?? ''
      const patch =
        action === 'ARCHIVE'
          ? { isActive: false }
          : action === 'REACTIVATE'
            ? { isActive: true }
            : {
                decision: action === 'PREFERRED' ? 'ALLOWED' : action,
                ...(chosenTrainId !== (release.firmwareTrainId ?? '') ? { firmwareTrainId: chosenTrainId || null } : {}),
              }
      const response = await fetch(`/api/v1/firmware-releases/${release.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'Firmware release could not be reviewed.')

      if (action === 'PREFERRED') {
        if (!chosenTrainId) throw new Error('Choose a train before making this release preferred.')
        const trainResponse = await fetch(`/api/v1/firmware-trains/${chosenTrainId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preferredFirmwareReleaseId: release.id }),
        })
        const trainPayload = (await trainResponse.json()) as ApiError
        if (!trainResponse.ok) throw new Error(trainPayload.error?.message ?? 'Release was allowed, but could not be made preferred.')
      }

      setMessage(
        action === 'ARCHIVE'
          ? `${release.version} archived.`
          : action === 'REACTIVATE'
            ? `${release.version} reactivated.`
            : action === 'PREFERRED'
              ? `${release.version} allowed and made preferred.`
              : `${release.version} marked ${action.toLowerCase()}.`,
      )
      await reload()
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : 'Firmware review could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState title="Loading firmware catalog" description="Loading platforms, trains, releases, and review state…" />

  return (
    <>
      <PageHeader
        eyebrow="Firmware catalog"
        title="Firmware catalog"
        description="Global firmware truth and defaults: platform → train → exact releases. Customer, site, device, and deliberate legacy-track deviations remain firmware policy."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/firmware/trains" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">
              Manage trains
            </Link>
            <Button onClick={openAddRelease} disabled={!selected}>Add release</Button>
          </div>
        }
      />

      {reviewCount > 0 ? (
        <button
          type="button"
          onClick={() => setReviewOnly((value) => !value)}
          className="mb-4 flex w-full items-center justify-between rounded-md border border-amber-700/60 bg-amber-950/20 px-4 py-3 text-left text-sm text-amber-200"
        >
          <span><strong>{reviewCount} firmware release{reviewCount === 1 ? '' : 's'} need review</strong> · imported observations never become allowed or preferred automatically.</span>
          <span className="font-semibold">{reviewOnly ? 'Show platform catalog' : 'Review now'}</span>
        </button>
      ) : null}

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      {addOpen ? (
        <form onSubmit={createRelease} className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Add release</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Only train, version, and release decision are needed for the normal case. Train assignment stays explicit.</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Platform" htmlFor="catalog-add-platform">
              <TextInput id="catalog-add-platform" value={form.platform} readOnly />
            </FormField>
            <FormField label="Train" htmlFor="catalog-add-train" error={fieldErrors.firmwareTrainId}>
              <SelectInput id="catalog-add-train" value={form.firmwareTrainId} onChange={(event) => setForm({ ...form, firmwareTrainId: event.target.value })} required>
                <option value="">Choose train…</option>
                {selectedTrains.filter((train) => train.isActive).map((train) => <option key={train.id} value={train.id}>{train.name} · {train.state}</option>)}
              </SelectInput>
            </FormField>
            <FormField label="Version" htmlFor="catalog-add-version" error={fieldErrors.version}>
              <TextInput id="catalog-add-version" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="17.15.6" required />
            </FormField>
            <FormField label="Release decision" htmlFor="catalog-add-decision" error={fieldErrors.decision}>
              <SelectInput id="catalog-add-decision" value={form.decision} onChange={(event) => setForm({ ...form, decision: event.target.value })}>
                {firmwareReleaseDecisions.map((decision) => <option key={decision} value={decision}>{decision === 'NEEDS_REVIEW' ? 'Needs review' : decision[0] + decision.slice(1).toLowerCase()}</option>)}
              </SelectInput>
            </FormField>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.makePreferred} onChange={(event) => setForm({ ...form, makePreferred: event.target.checked })} />
            Make preferred for this train
          </label>

          <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="mt-4 text-sm font-semibold text-[var(--accent-light)] hover:underline">
            {advancedOpen ? 'Hide advanced details' : 'Advanced details (optional)'}
          </button>
          {advancedOpen ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <FormField label="Logical/base release" htmlFor="catalog-add-logical"><TextInput id="catalog-add-logical" value={form.logicalVersion} onChange={(event) => setForm({ ...form, logicalVersion: event.target.value })} placeholder="Derived when supported" /></FormField>
              <FormField label="Variant/rebuild" htmlFor="catalog-add-variant"><TextInput id="catalog-add-variant" value={form.variant} onChange={(event) => setForm({ ...form, variant: event.target.value })} /></FormField>
              <FormField label="Image code" htmlFor="catalog-add-image"><TextInput id="catalog-add-image" value={form.imageCode} onChange={(event) => setForm({ ...form, imageCode: event.target.value })} placeholder="WC / YA / YC" /></FormField>
              <FormField label="Release notes URL" htmlFor="catalog-add-notes-url"><TextInput id="catalog-add-notes-url" type="url" value={form.releaseNotesUrl} onChange={(event) => setForm({ ...form, releaseNotesUrl: event.target.value })} /></FormField>
              <div className="md:col-span-2"><FormField label="Notes" htmlFor="catalog-add-notes"><TextArea id="catalog-add-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></FormField></div>
            </div>
          ) : null}
          <div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add release'}</Button></div>
        </form>
      ) : null}

      <div className="mb-3 flex justify-end">
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Vendor / platform</h2>
          </div>
          {platforms.length === 0 ? <div className="p-4 text-sm text-[var(--muted)]">No firmware platforms yet.</div> : (
            <div className="divide-y divide-[var(--border)]">
              {platforms.map((platform) => (
                <button
                  key={platform.key}
                  type="button"
                  onClick={() => { setSelectedKey(platform.key); setReviewOnly(false) }}
                  className={`w-full px-4 py-3 text-left hover:bg-[var(--surface-raised)] ${selected?.key === platform.key ? 'bg-[var(--surface-raised)]' : ''}`}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{platform.vendorName}</div>
                  <div className="mt-1 font-semibold">{platform.platform}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{platform.trainCount} train{platform.trainCount === 1 ? '' : 's'} · {platform.releaseCount} release{platform.releaseCount === 1 ? '' : 's'}</div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="min-w-0 space-y-5">
          {!selected ? <EmptyState title="No firmware platform selected" description="Create a release train first, then add exact releases." /> : (
            <>
              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{selected.vendorName}</div>
                    <h2 className="mt-1 text-lg font-semibold">{selected.platform}</h2>
                  </div>
                  <Button onClick={openAddRelease}>Add release</Button>
                </div>
                {selectedTrains.length === 0 ? (
                  <div className="p-5 text-sm text-[var(--muted)]">No release trains are configured for this platform. Train creation is explicit; it is never derived from version strings.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                        <tr><th className="px-4 py-3">Train</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Preferred release</th><th className="px-4 py-3">Minimum acceptable</th><th className="px-4 py-3 text-right">Devices</th></tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {selectedTrains.map((train) => (
                          <tr key={train.id} className={train.isActive ? '' : 'opacity-60'}>
                            <td className="px-4 py-3"><Link href={`/firmware/trains/${train.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{train.name}</Link></td>
                            <td className="px-4 py-3"><span className={train.state === 'PREFERRED' ? 'font-semibold text-emerald-300' : train.state === 'DEPRECATED' ? 'text-amber-300' : ''}>{train.state[0] + train.state.slice(1).toLowerCase()}</span></td>
                            <td className="px-4 py-3 font-mono text-xs">{train.preferredRelease?.logicalVersion ?? train.preferredRelease?.version ?? '—'}</td>
                            <td className="px-4 py-3 font-mono text-xs">{train.minimumAcceptableRelease?.logicalVersion ?? train.minimumAcceptableRelease?.version ?? '—'}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{train.deviceCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold">{reviewOnly ? 'Releases needing review' : 'Releases'}</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">Exact variants stay canonical underneath the engineer-facing logical release.</p>
                  </div>
                  {reviewOnly ? <button type="button" className="text-xs font-semibold text-[var(--accent-light)] hover:underline" onClick={() => setReviewOnly(false)}>Show all platform releases</button> : null}
                </div>
                {releaseGroups.length === 0 ? <div className="p-5 text-sm text-[var(--muted)]">No releases match this view.</div> : (
                  <div className="divide-y divide-[var(--border)]">
                    {releaseGroups.map((group) => (
                      <div key={group.key} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <Link href={`/firmware/${group.releases[0].id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{group.logicalVersion}</Link>
                            <div className="mt-1 text-xs text-[var(--muted)]">
                              {group.trainName} · {group.releases.length} exact variant{group.releases.length === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface-raised)]">
                          {group.releases.map((release) => {
                            const matchingTrains = selectedTrains.filter((train) => train.isActive)
                            const chosenTrainId = reviewTrain[release.id] ?? release.firmwareTrainId ?? ''
                            return (
                              <div key={release.id} className={`p-3 ${release.isActive ? '' : 'opacity-60'}`}>
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <Link href={`/firmware/${release.id}`} className="font-mono text-xs font-semibold text-[var(--accent-light)] hover:underline">{release.version}</Link>
                                    <div className="mt-1 text-xs text-[var(--muted)]">
                                      {[release.imageCode ? `image ${release.imageCode}` : null, release.variant ? `variant ${release.variant}` : null]
                                        .filter(Boolean)
                                        .join(' · ') || 'canonical exact release'}
                                      {' · '}
                                      <span className={decisionClass(release.decision)}>{decisionLabel(release.decision)}</span>
                                      {release.isActive ? '' : ' · Archived'}
                                    </div>
                                  </div>
                                  {release.decision === 'NEEDS_REVIEW' && release.isActive ? (
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      <select aria-label={`Train for ${release.version}`} value={chosenTrainId} onChange={(event) => setReviewTrain({ ...reviewTrain, [release.id]: event.target.value })} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-xs">
                                        <option value="">No train</option>
                                        {matchingTrains.map((train) => <option key={train.id} value={train.id}>{train.name}</option>)}
                                      </select>
                                      <Button variant="ghost" disabled={saving} onClick={() => void reviewRelease(release, 'ALLOWED')}>Allow</Button>
                                      <Button variant="ghost" disabled={saving || !chosenTrainId} onClick={() => void reviewRelease(release, 'PREFERRED')}>Allow + preferred</Button>
                                      <Button variant="ghost" disabled={saving} onClick={() => void reviewRelease(release, 'BLOCKED')}>Block</Button>
                                      <Button variant="ghost" disabled={saving} onClick={() => void reviewRelease(release, 'ARCHIVE')}>Archive</Button>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      disabled={saving}
                                      onClick={() => void reviewRelease(release, release.isActive ? 'ARCHIVE' : 'REACTIVATE')}
                                    >
                                      {release.isActive ? 'Archive' : 'Reactivate'}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </>
  )
}
