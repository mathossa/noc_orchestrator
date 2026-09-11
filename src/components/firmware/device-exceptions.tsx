'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { listFirmwareExceptions } from '@/lib/firmware-exception-store'
type Data = Awaited<ReturnType<typeof listFirmwareExceptions>>
export function DeviceExceptions({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/v1/firmware-exceptions?deviceId=${encodeURIComponent(deviceId)}`,
    )
      .then(async (r) => {
        const p = await r.json()
        if (!r.ok) throw Error(p.error?.message)
        if (!cancelled) setData(p.data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [deviceId])
  const resolution = data?.resolutions[0]
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Firmware exceptions</h2>
      <p className="my-2 text-sm text-[var(--muted)]">
        {error ||
          (!data
            ? 'Loading exceptions…'
            : resolution?.selectedId
              ? 'Accepted exception; the technical recommendation remains visible above.'
              : 'No exception suppresses the current recommendation.')}
      </p>
      {data?.records.map((r) => (
        <p className="my-2 text-sm" key={r.id}>
          {r.reasonCode.replaceAll('_', ' ')} · {r.scopeLabel} · {r.status}
          {r.expiresAt
            ? ` · Review ${new Date(r.expiresAt).toLocaleDateString()}`
            : ''}
          {resolution?.selectedId === r.id ? ' · Effective decision' : ''}
        </p>
      ))}
      <Link
        className="text-sm text-[var(--accent-light)] hover:underline"
        href={`/firmware/exceptions?scope=DEVICE&scopeId=${encodeURIComponent(deviceId)}`}
      >
        Manage exceptions and inherited history →
      </Link>
    </section>
  )
}
