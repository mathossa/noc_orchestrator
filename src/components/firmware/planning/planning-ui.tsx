import type { ReactNode } from 'react'
import type { FirmwareWorkPlanState } from '@/lib/firmware-work-planning'

export const planStateLabel: Record<FirmwareWorkPlanState, string> = {
  PROPOSED: 'Proposed',
  AWAITING_CUSTOMER: 'Awaiting customer',
  APPROVED: 'Approved',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}

export function PlanStatePill({
  state,
  stale = false,
}: {
  state: FirmwareWorkPlanState
  stale?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1 text-xs font-semibold">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          stale ? 'bg-[#f0a75a]' : 'bg-[var(--accent)]'
        }`}
      />
      {planStateLabel[state]}
      {stale ? ' · review' : ''}
    </span>
  )
}

export function PlanningSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

export function PlanningError({ message }: { message: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]"
    >
      {message}
    </div>
  )
}

export function PlanningStatus({ message }: { message: string }) {
  if (!message) return null
  return (
    <div
      role="status"
      className="rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]"
    >
      {message}
    </div>
  )
}
