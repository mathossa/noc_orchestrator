import type { ReactNode } from 'react'

export function WorkspacePanel({
  children,
  className = '',
  padding = true,
}: {
  children: ReactNode
  className?: string
  padding?: boolean
}) {
  return (
    <section
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] ${padding ? 'p-4 sm:p-5' : ''} ${className}`}
    >
      {children}
    </section>
  )
}

export function WorkspaceSectionHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StickyWorkspaceActions({
  children,
  label = 'Workspace actions',
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <aside
      aria-label={label}
      className="sticky top-4 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 shadow-xl lg:top-6"
    >
      {children}
    </aside>
  )
}
