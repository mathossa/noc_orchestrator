export type TechnicalFirmwareState = 'CURRENT' | 'ACTION_REQUIRED' | 'UNKNOWN' | 'NO_POLICY'
export type WorkflowState = 'PLANNED' | 'IGNORED' | 'CUSTOMER_DECLINED' | 'DONE'

const technicalStyles: Record<TechnicalFirmwareState, { label: string; className: string; dot: string }> = {
  CURRENT: {
    label: 'Current',
    className: 'border-[#315d47] bg-[#173326] text-[#a8e7c1]',
    dot: 'bg-[#6fcf97]',
  },
  ACTION_REQUIRED: {
    label: 'Action required',
    className: 'border-[#6d5930] bg-[#342b18] text-[#efd18d]',
    dot: 'bg-[#e4b95b]',
  },
  UNKNOWN: {
    label: 'Unknown',
    className: 'border-[var(--border-strong)] bg-[var(--surface-muted)] text-[var(--muted-strong)]',
    dot: 'bg-[var(--muted)]',
  },
  NO_POLICY: {
    label: 'No policy',
    className: 'border-[#506269] bg-[#1b2528] text-[#b9c8cd]',
    dot: 'bg-[var(--info)]',
  },
}

const workflowStyles: Record<WorkflowState, { label: string; className: string }> = {
  PLANNED: {
    label: 'Planned',
    className: 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]',
  },
  IGNORED: {
    label: 'Ignored',
    className: 'border-[var(--border-strong)] bg-transparent text-[var(--muted-strong)]',
  },
  CUSTOMER_DECLINED: {
    label: 'Customer declined',
    className: 'border-[#806635] bg-transparent text-[#e7c77e]',
  },
  DONE: {
    label: 'Done',
    className: 'border-[#397555] bg-transparent text-[#9bdab5]',
  },
}

export function TechnicalStatusBadge({ state }: { state: TechnicalFirmwareState }) {
  const style = technicalStyles[state]

  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${style.className}`}
      aria-label={`Technical firmware state: ${style.label}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}

export function WorkflowStatusBadge({ state }: { state: WorkflowState }) {
  const style = workflowStyles[state]

  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${style.className}`}
      aria-label={`Workflow state: ${style.label}`}
    >
      {style.label}
    </span>
  )
}
