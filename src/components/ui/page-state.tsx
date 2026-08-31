import type { ReactNode } from 'react'

function StateFrame({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-52 items-center justify-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-10 text-center">
      <div className="max-w-lg">{children}</div>
    </section>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <StateFrame>
      <div aria-hidden="true" className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-lg text-[var(--muted)]">
        —
      </div>
      <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </StateFrame>
  )
}

export function LoadingState({ title, description }: { title: string; description?: string }) {
  return (
    <StateFrame>
      <div role="status" aria-live="polite">
        <div aria-hidden="true" className="mx-auto mb-4 h-7 w-7 animate-pulse rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" />
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
        {description ? <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      </div>
    </StateFrame>
  )
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <StateFrame>
      <div role="alert">
        <div aria-hidden="true" className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-[#744141] bg-[#332020] font-bold text-[#f0a0a0]">
          !
        </div>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
        {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
      </div>
    </StateFrame>
  )
}
