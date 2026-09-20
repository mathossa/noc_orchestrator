'use client'

import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput } from '@/components/ui/form-controls'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import {
  evaluateReleaseAgainstTrain,
  firmwareTrainStates,
} from '@/lib/firmware-catalog-defaults'
import type { FirmwareTrainDetailRecord } from '@/lib/firmware-trains'

type ApiError = { error?: { message?: string } }

function labelState(state: string) {
  return state[0] + state.slice(1).toLowerCase()
}

export function FirmwareTrainDetail({ trainId }: { trainId: string }) {
  const [train, setTrain] = useState<FirmwareTrainDetailRecord | null>(null)
  const [state, setState] = useState('ACCEPTED')
  const [preferredId, setPreferredId] = useState('')
  const [minimumId, setMinimumId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const response = await fetch(`/api/v1/firmware-trains/${trainId}`, { cache: 'no-store' })
    const payload = (await response.json()) as { data?: FirmwareTrainDetailRecord } & ApiError
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Firmware train could not be loaded.')
    setTrain(payload.data)
    setState(payload.data.state)
    setPreferredId(payload.data.preferredFirmwareReleaseId ?? '')
    setMinimumId(payload.data.minimumAcceptableFirmwareReleaseId ?? '')
  }

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/firmware-trains/${trainId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: FirmwareTrainDetailRecord } & ApiError
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Firmware train could not be loaded.')
        if (!cancelled) {
          setTrain(payload.data)
          setState(payload.data.state)
          setPreferredId(payload.data.preferredFirmwareReleaseId ?? '')
          setMinimumId(payload.data.minimumAcceptableFirmwareReleaseId ?? '')
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Firmware train could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [trainId])

  async function saveDefaults() {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/v1/firmware-trains/${trainId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          preferredFirmwareReleaseId: preferredId || null,
          minimumAcceptableFirmwareReleaseId: minimumId || null,
        }),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'Train defaults could not be saved.')
      await load()
      setMessage('Train defaults updated.')
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Train defaults could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState title="Loading firmware train" />
  if (error && !train) return <ErrorState title="Firmware train could not be loaded" description={error} />
  if (!train) return <ErrorState title="Firmware train could not be loaded" description="The firmware train is unavailable." />

  const allowedReleases = train.releases.filter((release) => release.isActive && release.decision === 'ALLOWED')
  const preferredRelease = train.releases.find((release) => release.id === train.preferredFirmwareReleaseId) ?? null
  const minimumRelease = train.releases.find((release) => release.id === train.minimumAcceptableFirmwareReleaseId) ?? null
  const logicalReleaseGroups = [...train.releases.reduce((groups, release) => {
    const group = groups.get(release.logicalVersion)
    if (group) group.push(release)
    else groups.set(release.logicalVersion, [release])
    return groups
  }, new Map<string, FirmwareTrainDetailRecord['releases']>()).entries()]
    .map(([logicalVersion, releases]) => {
      const exact = [...releases].sort((a, b) => a.version.localeCompare(b.version, 'en', { numeric: true }))
      const representative =
        exact.find((release) => release.id === train.preferredFirmwareReleaseId) ??
        exact.find((release) => release.id === train.minimumAcceptableFirmwareReleaseId) ??
        exact[0]
      return {
        logicalVersion,
        releases: exact,
        representative,
        deviceCount: exact.reduce((total, release) => total + release.deviceCount, 0),
      }
    })
    .sort((a, b) => a.logicalVersion.localeCompare(b.logicalVersion, 'en', { numeric: true }))

  return (
    <>
      <PageHeader
        eyebrow={`${train.vendor.name} · ${train.platform}`}
        title={train.name}
        description="Global train defaults. Scoped Customer, Site, Device, and deliberate model-family deviations remain firmware policy."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/firmware" className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Firmware catalog</Link>
            <Link href="/firmware/trains" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage trains</Link>
          </div>
        }
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="State" value={labelState(train.state)} detail={train.state === 'PREFERRED' ? 'Globally preferred train for this platform.' : 'Available as a catalog train without replacing scoped policy.'} />
        <SummaryStat label="Preferred release" value={train.preferredRelease?.logicalVersion ?? train.preferredRelease?.version ?? '—'} detail="The normal install target inside this train." />
        <SummaryStat label="Minimum acceptable" value={train.minimumAcceptableRelease?.logicalVersion ?? train.minimumAcceptableRelease?.version ?? '—'} detail={train.minimumAcceptableRelease ? 'Allowed releases at/above this boundary are acceptable.' : 'No minimum: only the preferred release is acceptable.'} />
        <SummaryStat label="Running devices" value={train.deviceCount} detail={`Across ${train.releaseCount} exact catalog release${train.releaseCount === 1 ? '' : 's'} in this train.`} />
      </div>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Train defaults</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Preferred/minimum choices must be active Allowed releases in this train. Unsupported ordering is rejected rather than guessed.</p>
          </div>
          <Button disabled={saving} onClick={() => void saveDefaults()}>{saving ? 'Saving…' : 'Save defaults'}</Button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Train state</span>
            <SelectInput value={state} onChange={(event) => setState(event.target.value)}>
              {firmwareTrainStates.map((value) => <option key={value} value={value}>{labelState(value)}</option>)}
            </SelectInput>
          </label>
          <label className="text-sm">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Preferred release</span>
            <SelectInput value={preferredId} onChange={(event) => {
              const next = event.target.value
              setPreferredId(next)
              if (!next) setMinimumId('')
            }}>
              <option value="">Not configured</option>
              {allowedReleases.map((release) => <option key={release.id} value={release.id}>{release.logicalVersion}{release.version !== release.logicalVersion ? ` · ${release.version}` : ''}</option>)}
            </SelectInput>
          </label>
          <label className="text-sm">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Minimum acceptable</span>
            <SelectInput value={minimumId} disabled={!preferredId} onChange={(event) => setMinimumId(event.target.value)}>
              <option value="">None — preferred only</option>
              {allowedReleases.map((release) => <option key={release.id} value={release.id}>{release.logicalVersion}{release.version !== release.logicalVersion ? ` · ${release.version}` : ''}</option>)}
            </SelectInput>
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Releases in this train</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Release viability is evaluated before preferred/minimum policy. Exact images and variants remain available on release detail.</p>
        </div>
        {train.releases.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--muted)]">No firmware releases are assigned to this train yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr><th className="px-4 py-3">Release</th><th className="px-4 py-3">Decision</th><th className="px-4 py-3">Train position</th><th className="px-4 py-3 text-right">Devices</th><th className="px-4 py-3">Record</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {logicalReleaseGroups.map((group) => {
                  const evaluation = evaluateReleaseAgainstTrain({
                    vendorKey: train.vendor.code,
                    platform: train.platform,
                    release: group.representative,
                    preferredRelease,
                    minimumAcceptableRelease: minimumRelease,
                  })
                  const decisions = [...new Set(group.releases.map((release) => release.decision))]
                  const hasExactDetails =
                    group.releases.length > 1 ||
                    group.releases.some((release) =>
                      release.version !== release.logicalVersion || release.imageCode || release.variant,
                    )
                  return (
                    <Fragment key={group.logicalVersion}>
                      <tr>
                        <td className="px-4 py-3">
                          <Link href={`/firmware/${group.representative.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{group.logicalVersion}</Link>
                          <div className="mt-1 text-xs text-[var(--muted)]">{group.releases.length} exact variant{group.releases.length === 1 ? '' : 's'}</div>
                        </td>
                        <td className="px-4 py-3">{decisions.map((decision) => decision === 'NEEDS_REVIEW' ? 'Needs review' : labelState(decision)).join(' / ')}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{evaluation.position.replaceAll('_', ' ')}</div>
                          <div className="mt-1 max-w-xl text-xs text-[var(--muted)]">{evaluation.reason}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{group.deviceCount}</td>
                        <td className="px-4 py-3 text-xs">{group.releases.every((release) => release.isActive) ? 'Active' : 'Includes archived'}</td>
                      </tr>
                      {hasExactDetails ? (
                        <tr>
                          <td colSpan={5} className="bg-[var(--surface-raised)] px-4 py-2">
                            <details>
                              <summary className="cursor-pointer text-xs font-semibold text-[var(--muted-strong)]">Exact images / variants</summary>
                              <div className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface)]">
                                {group.releases.map((release) => (
                                  <div key={release.id} className={`flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs ${release.isActive ? '' : 'opacity-60'}`}>
                                    <div>
                                      <Link href={`/firmware/${release.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{release.version}</Link>
                                      <span className="ml-2 text-[var(--muted)]">
                                        {[release.imageCode ? `image ${release.imageCode}` : null, release.variant ? `variant ${release.variant}` : null].filter(Boolean).join(' · ') || 'exact identity'}
                                      </span>
                                    </div>
                                    <div className="text-[var(--muted)]">
                                      {release.decision === 'NEEDS_REVIEW' ? 'Needs review' : labelState(release.decision)} · {release.deviceCount} device{release.deviceCount === 1 ? '' : 's'}{release.isActive ? '' : ' · archived'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
