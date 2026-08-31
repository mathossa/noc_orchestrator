import type { ReactNode } from 'react'

export function SummaryStat({
  label,
  value,
  detail,
  accessory,
}: {
  label: string
  value: ReactNode
  detail?: string
  accessory?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{label}</p>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">{value}</div>
        </div>
        {accessory ? <div className="shrink-0">{accessory}</div> : null}
      </div>
      {detail ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{detail}</p> : null}
    </section>
  )
}
