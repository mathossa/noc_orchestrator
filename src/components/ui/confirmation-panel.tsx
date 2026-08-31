import type { ReactNode } from 'react'

export function ConfirmationPanel({
  title,
  description,
  details,
  actions,
  danger = false,
}: {
  title: string
  description: string
  details?: ReactNode
  actions: ReactNode
  danger?: boolean
}) {
  return (
    <section
      className={`rounded-lg border p-4 sm:p-5 ${
        danger ? 'border-[#6d3d3d] bg-[#281b1b]' : 'border-[var(--border)] bg-[var(--surface)]'
      }`}
      aria-label={title}
    >
      <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>
      {details ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">{details}</div> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
    </section>
  )
}
