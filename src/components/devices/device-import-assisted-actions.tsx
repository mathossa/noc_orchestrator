'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

const SAFE_SUGGESTION_SCORE = 0.97
const MAX_PASSES = 6
const MAX_ITEMS_PER_PASS = 250

type ApiError = { error?: { message?: string } }
type Reference = {
  id: string
  status: string
  suggestedTargetId: string | null
  suggestionScore: number | null
}
type Workspace = {
  batch: { id: string; profileId: string | null; profileName: string | null; status: string }
  references: Reference[]
}
type WorkspacePayload = { data?: Workspace } & ApiError

function safeSuggestions(workspace: Workspace) {
  return workspace.references.filter((reference) =>
    reference.status === 'UNRESOLVED' &&
    Boolean(reference.suggestedTargetId) &&
    (reference.suggestionScore ?? 0) >= SAFE_SUGGESTION_SCORE,
  )
}

const linkClass = 'rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]'

export function DeviceImportAssistedActions({ batchId }: { batchId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}`)
      .then(async (response) => {
        const payload = await response.json() as WorkspacePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Assisted import actions could not be loaded.')
        return payload.data
      })
      .then(
        (data) => { if (!cancelled) setWorkspace(data) },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Assisted import actions could not be loaded.') },
      )
    return () => { cancelled = true }
  }, [batchId])

  const safeCount = useMemo(() => workspace ? safeSuggestions(workspace).length : 0, [workspace])

  async function applySafeSuggestions() {
    if (!workspace || !safeCount) return
    setBusy(true)
    setError(null)
    try {
      let current = workspace
      let applied = 0
      for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const suggestions = safeSuggestions(current).slice(0, MAX_ITEMS_PER_PASS)
        if (!suggestions.length) break
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: suggestions.map((reference) => ({
              referenceId: reference.id,
              targetId: reference.suggestedTargetId!,
              remember: Boolean(current.batch.profileId),
            })),
          }),
        })
        const payload = await response.json() as WorkspacePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Safe suggestions could not be applied.')
        applied += suggestions.length
        current = payload.data
        setWorkspace(current)
      }
      if (applied) window.location.reload()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Safe suggestions could not be applied.')
      setBusy(false)
    }
  }

  if (!workspace || workspace.batch.status === 'PUBLISHED') return null

  return <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold">Assisted actions</div>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
          Exact and remembered mappings are automatic. Apply only high-confidence suggestions in one click, then review prefilled Site, Model/Family, and Firmware creation proposals instead of creating records one by one.
        </p>
        {error ? <p className="mt-2 text-xs font-medium text-[#f0a0a0]">{error}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={busy || !safeCount} onClick={() => void applySafeSuggestions()}>
          {busy ? 'Applying safe suggestions…' : `Apply ${safeCount} safe suggestion${safeCount === 1 ? '' : 's'}`}
        </Button>
        <Link href={`/devices/import/${batchId}/sites`} className={linkClass}>Review/create Sites</Link>
        <Link href={`/devices/import/${batchId}/models`} className={linkClass}>Models + Families</Link>
        <Link href={`/devices/import/${batchId}/firmware`} className={linkClass}>Review/create Firmware</Link>
        <Link href={`/devices/import/${batchId}/bulk`} className={linkClass}>Bulk resolve exceptions</Link>
      </div>
    </div>
  </section>
}
