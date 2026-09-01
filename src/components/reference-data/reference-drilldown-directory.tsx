'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import type { ReferenceKind, ReferenceRecord } from '@/lib/reference-data'

type ApiError = { error?: { message?: string } }

export function ReferenceDrilldownDirectory({
  kind,
  basePath,
  title,
  description,
}: {
  kind: Extract<ReferenceKind, 'vendors' | 'contract-types'>
  basePath: '/vendors' | '/contracts'
  title: string
  description: string
}) {
  const [records, setRecords] = useState<ReferenceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/reference-data/${kind}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: ReferenceRecord[] } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Drill-down records could not be loaded.')
        if (!cancelled) setRecords(payload.data ?? [])
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Drill-down records could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [kind])

  return (
    <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
      </div>
      {loading ? <LoadingState title="Loading drill-down links" /> : error ? <ErrorState title="Drill-down links unavailable" description={error} /> : records.length === 0 ? <div className="px-4 py-6 text-sm text-[var(--muted)]">No records are configured yet.</div> : (
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-3">
          {records.map((record) => <Link key={record.id} href={`${basePath}/${record.id}`} className={`bg-[var(--surface)] p-4 hover:bg-[var(--surface-raised)] ${record.isActive ? '' : 'opacity-60'}`}><div className="font-semibold text-[var(--accent-light)]">{record.name}</div><div className="mt-1 text-xs text-[var(--muted)]">{record.code} · {record.isActive ? 'Active' : 'Archived'}{kind === 'contract-types' ? ` · firmware management ${record.firmwareManagementEnabled ? 'enabled' : 'disabled'}` : ''}</div></Link>)}
        </div>
      )}
    </section>
  )
}
