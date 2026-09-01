import { auditActionLabel, type AuditEventRecord, type AuditJsonScalar } from '@/lib/audit-events'

function displayValue(value: AuditJsonScalar | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function eventSummary(event: AuditEventRecord) {
  if (event.action.startsWith('FIRMWARE_LIFECYCLE_')) {
    const state = displayValue(event.after?.state)
    const target = displayValue(event.after?.targetVersion)
    return `${state} · target ${target}`
  }
  if (event.action.startsWith('DESIRED_FIRMWARE_')) {
    return `${displayValue(event.before?.version)} → ${displayValue(event.after?.version)}`
  }
  if (event.action === 'CURRENT_FIRMWARE_CHANGED') {
    return `${displayValue(event.before?.version)} → ${displayValue(event.after?.version)}`
  }
  return 'Lifecycle-significant change'
}

export function AuditHistory({ events, emptyText = 'No lifecycle-significant history has been recorded yet.' }: { events: AuditEventRecord[]; emptyText?: string }) {
  if (events.length === 0) {
    return <div className="px-4 py-6 text-sm text-[var(--muted)]">{emptyText}</div>
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {events.map((event) => {
        const reason = event.after?.reason
        const notes = event.after?.notes
        return (
          <div key={event.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--foreground)]">{auditActionLabel(event.action)}</div>
                <div className="mt-1 text-xs text-[var(--muted-strong)]">{eventSummary(event)}</div>
              </div>
              <div className="text-right text-xs text-[var(--muted)]">
                <div>{new Date(event.createdAt).toLocaleString()}</div>
                <div className="mt-0.5">{event.actor?.name ?? 'System / actor unavailable'}</div>
              </div>
            </div>
            {typeof reason === 'string' && reason ? <div className="mt-2 text-xs leading-5 text-[var(--muted-strong)]"><span className="font-semibold">Reason:</span> {reason}</div> : null}
            {typeof notes === 'string' && notes ? <div className="mt-1 text-xs leading-5 text-[var(--muted)]"><span className="font-semibold">Notes:</span> {notes}</div> : null}
          </div>
        )
      })}
    </div>
  )
}
