import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const controlClass =
  'h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition-colors hover:border-[var(--muted)] focus:border-[var(--accent)]'

export function FilterBar({
  children,
  actions,
  summary,
  label = 'Filters',
}: {
  children: ReactNode
  actions?: ReactNode
  summary?: ReactNode
  label?: string
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3" aria-label={label}>
      {summary ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 text-xs text-[var(--muted-strong)]">
          {summary}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  )
}

export function FilterSearch({
  label = 'Search',
  id = 'filter-search',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--muted-strong)]">{label}</span>
      <input id={id} type="search" className={controlClass} {...props} />
    </label>
  )
}

export function FilterSelect({
  label,
  id,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  id: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--muted-strong)]">{label}</span>
      <select id={id} className={controlClass} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
