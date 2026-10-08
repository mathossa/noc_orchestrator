'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatAmsterdamTimestamp } from '@/lib/format-amsterdam-timestamp'

export type InventorySourceSyncRun = {
  id: string
  trigger: string
  status: string
  batchId: string | null
  fetchedCount: number
  stagedCount: number
  autoPublishedCount: number
  reviewRequiredCount: number
  ignoredCount: number
  errorCount: number
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

type ScheduleStatus = {
  enabled: boolean
  expression: string | null
  timezone: string | null
  nextRunAt: string | null
  lastJobId: string | null
}

async function responseData<T>(response: Response): Promise<T> {
  const json = await response.json()
  if (!response.ok) {
    throw new Error(json?.error?.message ?? 'Unable to read inventory sync schedule.')
  }
  return json.data as T
}

export function InventorySourceSchedulePanel({
  provider,
  sourceId,
  enabled,
  connectionTestPassed,
  hasEnabledScope,
  syncRuns,
}: {
  provider: 'auvik' | 'meraki'
  sourceId: string
  enabled: boolean
  connectionTestPassed: boolean
  hasEnabledScope: boolean
  syncRuns: readonly InventorySourceSyncRun[]
}) {
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null)
  const [expression, setExpression] = useState('0 3 * * *')
  const [timezone, setTimezone] = useState('Europe/Amsterdam')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const endpoint = `/api/v1/inventory-sources/${provider}/${sourceId}/schedule`

  useEffect(() => {
    let mounted = true
    void fetch(endpoint)
      .then(responseData<ScheduleStatus>)
      .then((value) => {
        if (!mounted) return
        setSchedule(value)
        if (value.expression) setExpression(value.expression)
        if (value.timezone) setTimezone(value.timezone)
      })
      .catch((error: unknown) => {
        if (mounted) {
          setMessage(error instanceof Error ? error.message : 'Unable to load schedule.')
        }
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [endpoint])

  const save = async (requestedEnabled: boolean) => {
    setBusy(true)
    setMessage(null)
    try {
      const value = await responseData<ScheduleStatus>(await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: requestedEnabled,
          expression,
          timezone,
        }),
      }))
      setSchedule(value)
      setMessage(requestedEnabled ? 'Inventory sync schedule saved.' : 'Inventory sync schedule disabled.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update schedule.')
    } finally {
      setBusy(false)
    }
  }

  const disabledReason = !enabled
    ? 'Enable the inventory connection first.'
    : !connectionTestPassed
      ? 'Run a successful connection test first.'
      : !hasEnabledScope
        ? 'Enable at least one location and click Save settings first.'
        : null

  return (
    <>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Schedule</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Scheduled syncs auto-publish safe changes and skip uncertain records without blocking the next run.
              Skipped records remain auditable; no scheduled job requires manual approval.
            </p>
          </div>
          <StatusBadge tone={schedule?.enabled ? 'success' : 'neutral'}>
            {schedule?.enabled ? 'Enabled' : 'Disabled'}
          </StatusBadge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Recurring expression</span>
            <input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="0 3 * * *" className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Timezone</span>
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 font-mono" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span>Next run: {schedule?.nextRunAt ? formatAmsterdamTimestamp(schedule.nextRunAt) : '—'}</span>
          <div className="flex gap-2">
            {schedule?.enabled ? (
              <Button disabled={busy || loading} onClick={() => void save(false)}>
                Disable schedule
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={busy || loading || disabledReason !== null}
              onClick={() => void save(true)}
            >
              {busy ? 'Saving…' : 'Save schedule'}
            </Button>
          </div>
        </div>
        {disabledReason ? <p className="mt-2 text-xs text-[var(--muted)]">{disabledReason}</p> : null}
        {message ? <p role="status" className="mt-2 text-xs text-[var(--accent-light)]">{message}</p> : null}
      </section>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-semibold">Sync history</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Durable manual/scheduled run records. Provider failures remain visible instead of being reported as a full success.
          </p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {syncRuns.length === 0 ? (
            <div className="px-5 py-6 text-sm text-[var(--muted)]">No sync runs yet.</div>
          ) : syncRuns.map((run) => (
            <div key={run.id} className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[140px_110px_1fr_auto] md:items-center">
              <div>
                <StatusBadge tone={run.status === 'SUCCEEDED' ? 'success' : run.status === 'FAILED' ? 'danger' : run.status === 'PARTIAL' ? 'warning' : 'info'}>
                  {run.status}
                </StatusBadge>
              </div>
              <div className="text-xs text-[var(--muted)]">{run.trigger}</div>
              <div>
                <span className="font-semibold">{run.stagedCount}</span> staged ·{' '}
                <span className="font-semibold">{run.autoPublishedCount}</span> published ·{' '}
                <span className="font-semibold">{run.reviewRequiredCount}</span>{' '}
                {run.trigger === 'SCHEDULED' ? 'skipped (unattended)' : 'review'} ·{' '}
                <span className="font-semibold">{run.errorCount}</span> errors
                {run.errorMessage ? <div className="mt-1 text-xs text-[var(--danger)]">{run.errorMessage}</div> : null}
              </div>
              <div className="text-xs text-[var(--muted)]">{formatAmsterdamTimestamp(run.startedAt)}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
