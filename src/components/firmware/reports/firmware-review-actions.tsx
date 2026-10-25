'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

type ApiError = { error?: { message?: string } }

export function GenerateFirmwareReviewReportButton({
  cycleId,
}: {
  cycleId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        '/api/v1/firmware-reviews/' +
          encodeURIComponent(cycleId) +
          '/reports',
        { method: 'POST' },
      )
      const payload = (await response.json()) as {
        data?: { version: number }
      } & ApiError
      if (!response.ok || !payload.data)
        throw new Error(
          payload.error?.message ?? 'Report version could not be generated.',
        )
      router.push(
        '/reports/' +
          encodeURIComponent(cycleId) +
          '?version=' +
          payload.data.version,
      )
      router.refresh()
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : 'Report version could not be generated.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="primary" disabled={busy} onClick={() => void generate()}>
        {busy ? 'Generating…' : 'Generate new report version'}
      </Button>
      {error ? (
        <span className="max-w-72 text-right text-xs text-[var(--danger)]" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
