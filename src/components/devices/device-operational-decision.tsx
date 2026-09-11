import Link from 'next/link'
import type { DeviceExceptionSummary } from '@/lib/device-exception-summary-store'

function scopeName(scope: string) {
  switch (scope) {
    case 'DEVICE': return 'Device'
    case 'SITE': return 'Site'
    case 'CUSTOMER': return 'Customer'
    case 'MODEL': return 'Model'
    case 'FAMILY': return 'Family'
    default: return scope
  }
}

function dateLabel(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString()
}

export function DeviceOperationalDecision({
  deviceId,
  summary,
}: {
  deviceId: string
  summary: DeviceExceptionSummary
}) {
  if (summary.effective) {
    const review = dateLabel(summary.effective.expiresAt)
    return (
      <div className="min-w-[190px]">
        <Link
          href={`/devices/${deviceId}`}
          className="inline-flex rounded-md border border-[var(--accent-muted)] bg-[var(--surface-raised)] px-2 py-1 text-xs font-semibold text-[var(--accent-light)] hover:border-[var(--accent)]"
        >
          {summary.effective.reasonLabel}
        </Link>
        <div className="mt-1 text-xs text-[var(--muted-strong)]">
          {scopeName(summary.effective.scope)} · {summary.effective.scopeLabel}
        </div>
        <div className="mt-1 text-xs text-[var(--muted)]">
          {summary.state === 'REVIEW_DUE' ? 'Review due' : 'Accepted exception'}
          {review ? ` · review ${review}` : ''}
          {summary.inheritedCount > 0 ? ` · +${summary.inheritedCount} inherited` : ''}
        </div>
      </div>
    )
  }

  if (summary.state === 'ACTIVE') {
    return (
      <div className="min-w-[190px] text-xs">
        <Link href={`/devices/${deviceId}`} className="font-semibold text-[var(--accent-light)] hover:underline">
          Active exception
        </Link>
        <div className="mt-1 text-[var(--muted)]">
          {summary.activeCount} matching record{summary.activeCount === 1 ? '' : 's'} · no action currently needs suppression.
        </div>
      </div>
    )
  }

  if (summary.state === 'REVIEW_DUE') {
    const review = dateLabel(summary.reviewDueAt)
    return (
      <div className="min-w-[190px] text-xs">
        <Link href={`/devices/${deviceId}`} className="font-semibold text-[var(--accent-light)] hover:underline">
          Exception review due
        </Link>
        <div className="mt-1 text-[var(--muted)]">
          Policy changed or prior exception needs review{review ? ` · ${review}` : ''}.
        </div>
      </div>
    )
  }

  if (summary.state === 'EXPIRED') {
    return (
      <div className="min-w-[190px] text-xs">
        <Link href={`/devices/${deviceId}`} className="font-semibold text-[var(--muted-strong)] hover:underline">
          Expired exception
        </Link>
        <div className="mt-1 text-[var(--muted)]">No exception currently suppresses action.</div>
      </div>
    )
  }

  return <span className="text-xs text-[var(--muted)]">No exception</span>
}
