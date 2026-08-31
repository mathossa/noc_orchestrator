'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import type { FirmwareReleaseDetailRecord } from '@/lib/firmware-releases'

type ApiError = { error?: { message?: string } }

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/firmware-releases/${releaseId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: FirmwareReleaseDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Firmware release could not be loaded.')
        if (!cancelled) setRelease(payload.data ?? null)
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

  if (loading) return <LoadingState title="Loading firmware release" description="Reading catalog metadata and usage…" />
  if (error || !release) {
    return <ErrorState title="Firmware release could not be loaded" description={error ?? 'The catalog record is unavailable.'} action={<Link href="/firmware" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to firmware</Link>} />
  }

  return (
    <>
      <PageHeader
        eyebrow="Firmware release"
        title={`${release.vendor.name} ${release.version}`}
        description={`${release.platform} catalog entry. Catalog status is descriptive and does not make this release desired firmware.`}
        actions={<Link href="/firmware" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage firmware</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Current on devices" value={release.usage.currentDevices} detail="Devices whose recorded current firmware points to this release." />
        <SummaryStat label="Policy targets" value={release.usage.targetPolicies} detail="Policies that explicitly target this release." />
        <SummaryStat label="Lifecycle targets" value={release.usage.lifecycleTargets} detail="Current lifecycle decisions targeting this release." />
        <SummaryStat label="Matching models" value={release.matchingModels.length} detail="Models sharing this vendor and platform/family." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Applicable model foundation</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Models are matched by vendor and platform/family. Desired-state assignment remains separate.</p>
          </div>
          {release.matchingModels.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[var(--muted)]">No models currently use this vendor/platform combination.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-4 py-3">Model</th><th className="px-4 py-3">Device type</th><th className="px-4 py-3">Devices</th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {release.matchingModels.map((model) => <tr key={model.id}><td className="px-4 py-3"><Link href={`/models/${model.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{model.model}</Link></td><td className="px-4 py-3 text-[var(--muted-strong)]">{model.deviceType.name}</td><td className="px-4 py-3">{model.deviceCount}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Release metadata</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Vendor" value={release.vendor.name} />
            <DetailRow label="Platform" value={release.platform} />
            <DetailRow label="Version" value={release.version} />
            <DetailRow label="Catalog status" value={release.status} />
            <DetailRow label="Record state" value={release.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Release date" value={release.releasedAt ? new Date(release.releasedAt).toLocaleDateString() : '—'} />
            <DetailRow label="Filename" value={release.filename ?? '—'} />
            <DetailRow label="File size" value={formatBytes(release.fileSizeBytes)} />
            <DetailRow label="SHA256" value={release.sha256 ?? '—'} mono />
            <DetailRow label="Source" value={release.source} />
            <DetailRow label="External provider" value={release.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={release.externalId ?? '—'} />
          </dl>
          {release.releaseNotesUrl ? <a className="mt-4 inline-block text-sm font-semibold text-[var(--accent-light)] hover:underline" href={release.releaseNotesUrl} target="_blank" rel="noreferrer">Open release notes</a> : null}
          {release.notes ? <div className="mt-4 border-t border-[var(--border)] pt-4 text-sm leading-6 text-[var(--muted-strong)] whitespace-pre-wrap">{release.notes}</div> : null}
        </section>
      </div>
    </>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) {
  return <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt><dd className={`min-w-0 break-words text-[var(--muted-strong)] ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd></div>
}
