import type { ReactNode } from 'react'

import type { TechnicalFirmwareState } from '@/lib/firmware-state'

export type WorkflowState = 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'
export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'required' | 'recommended'

const toneStyles: Record<StatusTone, { className: string; dot: string }> = {
  required: {
    className: 'border-[var(--required-border)] bg-[var(--required-soft)] text-[var(--required)]',
    dot: 'bg-[var(--required)]',
  },
  recommended: {
    className: 'border-[var(--recommended-border)] bg-[var(--recommended-soft)] text-[var(--recommended)]',
    dot: 'bg-[var(--recommended)]',
  },
  neutral: {
    className: 'border-[var(--border-strong)] bg-[var(--surface-muted)] text-[var(--muted-strong)]',
    dot: 'bg-[var(--muted)]',
  },
  accent: {
    className: 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]',
    dot: 'bg-[var(--accent)]',
  },
  success: {
    className: 'border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success)]',
    dot: 'bg-[var(--success)]',
  },
  warning: {
    className: 'border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning)]',
    dot: 'bg-[var(--warning)]',
  },
  danger: {
    className: 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]',
    dot: 'bg-[var(--danger)]',
  },
  info: {
    className: 'border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]',
    dot: 'bg-[var(--info)]',
  },
}

export function StatusBadge({
  children,
  tone = 'neutral',
  dot = true,
  ariaLabel,
}: {
  children: ReactNode
  tone?: StatusTone
  dot?: boolean
  ariaLabel?: string
}) {
  const style = toneStyles[tone]

  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${style.className}`}
      aria-label={ariaLabel}
    >
      {dot ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} /> : null}
      {children}
    </span>
  )
}

const technicalStyles: Record<TechnicalFirmwareState, { label: string; tone: StatusTone }> = {
  CURRENT: { label: 'No action recommended', tone: 'success' },
  ACTION_REQUIRED: { label: 'Action required', tone: 'warning' },
  UNKNOWN: { label: 'Unknown', tone: 'neutral' },
  NO_POLICY: { label: 'No policy', tone: 'info' },
}

const workflowStyles: Record<WorkflowState, { label: string; tone: StatusTone }> = {
  PLANNED: { label: 'Planned', tone: 'accent' },
  IGNORED: { label: 'Ignored', tone: 'neutral' },
  CUSTOMER_DECLINED: { label: 'Customer declined', tone: 'warning' },
  DONE: { label: 'Done', tone: 'success' },
}

export function TechnicalStatusBadge({ state }: { state: TechnicalFirmwareState }) {
  const style = technicalStyles[state]

  return (
    <StatusBadge tone={style.tone} ariaLabel={`Technical firmware state: ${style.label}`}>
      {style.label}
    </StatusBadge>
  )
}

export function WorkflowStatusBadge({ state }: { state: WorkflowState }) {
  const style = workflowStyles[state]

  return (
    <StatusBadge tone={style.tone} dot={false} ariaLabel={`Workflow state: ${style.label}`}>
      {style.label}
    </StatusBadge>
  )
}
