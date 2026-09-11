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

function durationLabel(duration: string, review: string | null) {
  if (review) return `review ${review}`
  switch (duration) {
    case 'PERMANENT': return 'permanent'
    case 'POLICY_CHANGE': return 'until policy change'
    case 'UNTIL_EOL': return 'until EOL'
    case 'TEMPORARY': return 'temporary'
    default: return 'accepted exception'
  }
}

function DecisionBadge({
  deviceId,
  label,
  detail,
  title,
  tone = 'normal',
}: {
  deviceId: string
  label: string
  detail?: string | null
  title: string
  tone?: 'normal' | 'review' | 'expired'
}) {
  const styles = {
    normal: 'border-[var(--accent-muted)] bg-[var(--surface-raised)] text-[var(--accent-light)]',
    review: 'border-yellow-400/40 bg-yellow-500/10 text-yellow-200',
    expired: 'border-[var(--border-strong)] bg-[var(--surface-muted)] text-[var(--muted-strong)]',
  }

  return (
    <Link
      href={`/devices/${deviceId}`}
      className={`inline-flex max-w-full items-start rounded-md border px-2.5 py-1.5 text-left align-middle hover:brightness-110 ${styles[tone]}`}
      title={title}
    >
      <span className="min-w-0 whitespace-normal">
        <span className="block text-xs font-semibold leading-4">{label}</span>
        {detail ? <span className="block text-[11px] font-normal leading-4">{detail}</span> : null}
      </span>
    </Link>
  )
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
    const scope = scopeName(summary.effective.scope)
    const detail = `${scope} · ${durationLabel(summary.effective.duration, review)}`
    const title = [
      `Reason: ${summary.effective.reasonLabel}`,
      `Scope: ${scope} · ${summary.effective.scopeLabel}`,
      summary.state === 'REVIEW_DUE' ? 'State: Review due' : 'State: Accepted exception',
      review ? `Review: ${review}` : null,
      summary.inheritedCount > 0 ? `${summary.inheritedCount} broader inherited exception${summary.inheritedCount === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join('\n')

    return (
      <DecisionBadge
        deviceId={deviceId}
        label={summary.effective.reasonLabel}
        detail={detail}
        title={title}
        tone={summary.state === 'REVIEW_DUE' ? 'review' : 'normal'}
      />
    )
  }

  if (summary.state === 'ACTIVE') {
    return (
      <DecisionBadge
        deviceId={deviceId}
        label="Active exception"
        detail="No action currently"
        title={`${summary.activeCount} matching exception record${summary.activeCount === 1 ? '' : 's'}; no action currently needs suppression.`}
      />
    )
  }

  if (summary.state === 'REVIEW_DUE') {
    const review = dateLabel(summary.reviewDueAt)
    return (
      <DecisionBadge
        deviceId={deviceId}
        label="Exception review due"
        detail={review ? `Review ${review}` : 'Policy or target changed'}
        title={`Policy changed or a prior exception needs review${review ? ` on ${review}` : ''}.`}
        tone="review"
      />
    )
  }

  if (summary.state === 'EXPIRED') {
    return (
      <DecisionBadge
        deviceId={deviceId}
        label="Expired exception"
        detail="No longer suppresses action"
        title="The prior exception remains in history but no longer suppresses action."
        tone="expired"
      />
    )
  }

  return <span className="text-xs text-[var(--muted)]">No exception</span>
}
