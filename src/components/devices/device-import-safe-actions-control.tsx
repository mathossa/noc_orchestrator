'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

type SafeActionResult = {
  totalApplied: number
  passes: number
  reachedPassLimit: boolean
  remainingManualReferences: number
  applied: {
    mappings: number
    coreCreated: number
    coreLinkedExisting: number
    sitesCreated: number
    sitesLinkedExisting: number
    modelsCreated: number
    modelsLinkedExisting: number
    familyAssignments: number
    familiesCreated: number
    familiesReused: number
    firmwareCreated: number
    firmwareLinkedExisting: number
  }
}

type SafeActionPayload = {
  data?: SafeActionResult
  error?: { message?: string }
}

export function DeviceImportSafeActionsControl({ batchId }: { batchId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SafeActionResult | null>(null)

  async function applyAllSafeActions() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/safe-actions`, { method: 'POST' })
      const payload = await response.json() as SafeActionPayload
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? 'Safe import actions could not be applied.')
      }
      setResult(payload.data)
      if (payload.data.totalApplied > 0) window.location.reload()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Safe import actions could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="fixed bottom-5 right-5 z-50 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-[var(--accent)] bg-[var(--surface-raised)]/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-light)]">Recommended actions</div>
          <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">Dependency-aware safe reconciliation</div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Applies exact/high-confidence mappings and clearly prepared Customer, Site, Model, Family and Firmware actions. Ambiguous cases stay for review.</p>
        </div>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void applyAllSafeActions()}>
          {busy ? 'Applying…' : 'Apply all safe actions'}
        </Button>
      </div>
      {error ? <p className="mt-3 text-xs text-red-300" role="alert">{error}</p> : null}
      {result && result.totalApplied === 0 ? <p className="mt-3 text-xs text-[var(--muted-strong)]">No additional safe actions are available. {result.remainingManualReferences.toLocaleString()} reference{result.remainingManualReferences === 1 ? '' : 's'} still require review.</p> : null}
      {result?.reachedPassLimit ? <p className="mt-3 text-xs text-amber-200">The conservative pass limit was reached. Run safe actions again after the workspace refreshes.</p> : null}
    </aside>
  )
}
