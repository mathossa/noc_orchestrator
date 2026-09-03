'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type ReviewRow = {
  id: string
  rowNumber: number
  status: 'IGNORED' | 'EXCLUDED'
  statusReason: string | null
  statusSource: string | null
  mappedData: unknown
}

type ReviewData = {
  total: number
  returned: number
  truncated: boolean
  counts: Record<string, number>
  rows: ReviewRow[]
}

type Payload = { data?: ReviewData; error?: { message?: string } }

function mappedRecord(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function rowLabel(row: ReviewRow) {
  const mapped = mappedRecord(row.mappedData)
  for (const key of ['hostname', 'name', 'model', 'serialNumber', 'externalId']) {
    const value = mapped[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return `Source row ${row.rowNumber}`
}

function rowDetail(row: ReviewRow) {
  const mapped = mappedRecord(row.mappedData)
  return [mapped.vendor, mapped.model, mapped.currentFirmware]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' · ')
}

export function DeviceImportIgnoredRowsPanel({ batchId }: { batchId: string }) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/rows/review`)
    const payload = await response.json() as Payload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Ignored rows could not be loaded.')
    setData(payload.data)
  }, [batchId])

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/rows/review`).then(async (response) => {
      const payload = await response.json() as Payload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Ignored rows could not be loaded.')
      return payload.data
    }).then(
      (next) => { if (!cancelled) setData(next) },
      (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Ignored rows could not be loaded.') },
    )
    return () => { cancelled = true }
  }, [batchId])

  const groups = useMemo(() => {
    const grouped = new Map<string, { key: string; status: string; reason: string; source: string; rows: ReviewRow[] }>()
    for (const row of data?.rows ?? []) {
      const reason = row.statusReason || 'No reason recorded'
      const source = row.statusSource || 'UNKNOWN'
      const key = `${row.status}|${source}|${reason}`
      const group = grouped.get(key)
      if (group) group.rows.push(row)
      else grouped.set(key, { key, status: row.status, reason, source, rows: [row] })
    }
    return [...grouped.values()].sort((left, right) => right.rows.length - left.rows.length || left.reason.localeCompare(right.reason))
  }, [data])

  async function restore(rowNumbers: number[]) {
    if (!rowNumbers.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/rows/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RESTORE', rowNumbers }),
      })
      const payload = await response.json() as { data?: { affected: number }; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Rows could not be restored.')
      await load()
      setNotice(`${payload.data.affected.toLocaleString()} row${payload.data.affected === 1 ? '' : 's'} restored to the active import.`)
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Rows could not be restored.')
    } finally {
      setBusy(false)
    }
  }

  if (!data && !error) return null
  const ignored = data?.counts.IGNORED ?? 0
  const excluded = data?.counts.EXCLUDED ?? 0
  if (!ignored && !excluded && !error) return null

  return <details className="mb-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
    <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">
      Ignored / excluded device rows · {(ignored + excluded).toLocaleString()}
    </summary>
    <div className="border-t border-[var(--border)] p-4 sm:p-5">
      <p className="text-sm text-[var(--muted)]">These source rows are still stored in the staged batch; they are not deleted and will not be published while ignored or excluded. Restore a row or a whole reason group if it was filtered by mistake.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm"><span><strong>{ignored.toLocaleString()}</strong> ignored</span><span><strong>{excluded.toLocaleString()}</strong> excluded</span>{data?.truncated ? <span className="text-amber-200">Showing the first {data.returned.toLocaleString()} of {data.total.toLocaleString()}</span> : null}</div>
      {error ? <div className="mt-3 rounded-md border border-[#754040] bg-[#2a1b1b] px-3 py-2 text-sm text-[#f0b0b0]">{error}</div> : null}
      {notice ? <div className="mt-3 rounded-md border border-[#285f48] bg-[#142b22] px-3 py-2 text-sm text-[#a9e8c6]">{notice}</div> : null}
      <div className="mt-4 space-y-3">
        {groups.map((group) => <details key={group.key} className="overflow-hidden rounded-md border border-[var(--border)]">
          <summary className="cursor-pointer bg-[var(--surface-raised)] px-3 py-3">
            <span className="font-semibold">{group.status}</span> · {group.reason} · {group.rows.length.toLocaleString()} row{group.rows.length === 1 ? '' : 's'}
          </summary>
          <div className="border-t border-[var(--border)]">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-[var(--muted)]"><span>Source: {group.source}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => void restore(group.rows.map((row) => row.rowNumber))}>Restore group</Button></div>
            <div className="divide-y divide-[var(--border)]">{group.rows.map((row) => <div key={row.id} className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[90px_minmax(220px,1fr)_minmax(220px,1fr)_auto] md:items-center"><span className="font-mono text-xs">Row {row.rowNumber}</span><span className="font-medium">{rowLabel(row)}</span><span className="text-xs text-[var(--muted)]">{rowDetail(row) || 'No mapped device details'}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => void restore([row.rowNumber])}>Restore</Button></div>)}</div>
          </div>
        </details>)}
      </div>
    </div>
  </details>
}
