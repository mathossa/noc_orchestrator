'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import type { FirmwareTrainDetailRecord } from '@/lib/firmware-trains'

type ApiError = { error?: { message?: string } }

export function FirmwareTrainDetail({ trainId }: { trainId: string }) {
  const [train, setTrain] = useState<FirmwareTrainDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/firmware-trains/${trainId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: FirmwareTrainDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Firmware train could not be loaded.')
        if (!cancelled) setTrain(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Firmware train could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [trainId])

  if (loading) return <LoadingState title="Loading firmware train" />
  if (error || !train) {
    return <ErrorState title="Firmware train could not be loaded" description={error ?? 'The firmware train is unavailable.'} />
  }

  return (
    <>
      <PageHeader
        eyebrow={`${train.vendor.name} · ${train.platform}`}
        title={train.name}
        description="An explicit release family containing exact firmware releases. Membership is managed directly and is never inferred from version strings."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/firmware/trains" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Manage trains</Link>
            <Link href="/firmware" className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Firmware releases</Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Releases" value={train.releaseCount} detail="Exact catalog releases assigned to this train." />
        <SummaryStat label="State" value={train.isActive ? 'Active' : 'Archived'} detail="Archival does not detach existing releases." />
        <SummaryStat label="Platform" value={train.platform} detail="Platform/family scope for train membership." />
        <SummaryStat label="Desired firmware" value="Exact release" detail="Issue #9 will target exact releases, not a moving train by default." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Releases in this train</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Individual versions remain opaque vendor strings and retain their own catalog status.</p>
          </div>
          {train.releases.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[var(--muted)]">No firmware releases are assigned to this train yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  <tr><th className="px-4 py-3">Version</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Released</th><th className="px-4 py-3">State</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {train.releases.map((release) => (
                    <tr key={release.id} className={release.isActive ? '' : 'opacity-60'}>
                      <td className="px-4 py-3"><Link href={`/firmware/${release.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{release.version}</Link></td>
                      <td className="px-4 py-3">{release.status}</td>
                      <td className="px-4 py-3 text-[var(--muted-strong)]">{release.releasedAt ? new Date(release.releasedAt).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-xs">{release.isActive ? 'Active' : 'Archived'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Train information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Vendor" value={train.vendor.name} />
            <DetailRow label="Platform" value={train.platform} />
            <DetailRow label="Train" value={train.name} />
            <DetailRow label="Source" value={train.source} />
            <DetailRow label="External provider" value={train.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={train.externalId ?? '—'} />
          </dl>
          {train.notes ? <p className="mt-5 whitespace-pre-wrap border-t border-[var(--border)] pt-4 text-sm leading-6 text-[var(--muted-strong)]">{train.notes}</p> : null}
        </section>
      </div>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd>
    </div>
  )
}
