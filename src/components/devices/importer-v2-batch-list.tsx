'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

type Batch = {
  id: string
  name: string
  provider: string
  profileVersion: string
  status: string
  rowCount: number
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message ?? 'Request failed.')
  return body.data as T
}

export function ImporterV2BatchList({ batches }: { batches: Batch[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (batch: Batch) => {
    const confirmed = window.confirm(
      `Delete staged import “${batch.name}”?\n\nAll staged rows and reconciliation decisions for this unpublished batch will be removed. Canonical inventory is not changed.`,
    )
    if (!confirmed) return

    setBusyId(batch.id)
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batch.id}`, {
        method: 'DELETE',
      })
      await responseData(response)
      router.refresh()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Unable to delete staged import.',
      )
    } finally {
      setBusyId(null)
    }
  }

  if (batches.length === 0) {
    return (
      <div className="p-6 text-sm text-[var(--muted)]">
        No staged imports yet. Upload an XLSX workbook above to start one.
      </div>
    )
  }

  return (
    <>
      {error ? (
        <div className="border-b border-[#8f4747] bg-[#512b2b] px-4 py-2 text-sm text-[#ffd7d7]" role="alert">
          {error}
        </div>
      ) : null}
      <ul className="divide-y divide-[var(--border)]">
        {batches.map((batch) => (
          <li
            key={batch.id}
            className="grid grid-cols-[minmax(0,1fr)_120px_100px_150px_110px] items-center gap-3 px-4 py-3 text-sm hover:bg-[var(--surface-muted)]"
          >
            <Link
              href={`/devices/import/${batch.id}`}
              className="min-w-0 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <span className="block truncate font-semibold text-[var(--foreground)]">{batch.name}</span>
              <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">Profile v{batch.profileVersion}</span>
            </Link>
            <span className="text-[var(--muted-strong)]">{batch.provider}</span>
            <span className="tabular-nums text-[var(--muted-strong)]">{batch.rowCount.toLocaleString()}</span>
            <span className="text-[var(--accent-light)]">{batch.status}</span>
            <Button
              variant="ghost"
              disabled={busyId === batch.id}
              onClick={() => void remove(batch)}
            >
              {busyId === batch.id ? 'Deleting…' : 'Delete'}
            </Button>
          </li>
        ))}
      </ul>
    </>
  )
}
