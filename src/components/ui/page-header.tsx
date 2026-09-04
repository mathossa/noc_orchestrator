import Link from 'next/link'
import type { ReactNode } from 'react'

export type PageBreadcrumb = {
  label: string
  href?: string
}

export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  meta,
}: {
  title: string
  description?: string
  eyebrow?: string
  breadcrumbs?: PageBreadcrumb[]
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className="mb-6 border-b border-[var(--border)] pb-5">
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
            {breadcrumbs.map((item, index) => {
              const current = index === breadcrumbs.length - 1
              return (
                <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-2">
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {item.href && !current ? (
                    <Link href={item.href} className="truncate hover:text-[var(--foreground)] hover:underline">
                      {item.label}
                    </Link>
                  ) : (
                    <span className="truncate" aria-current={current ? 'page' : undefined}>
                      {item.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-[28px]">{title}</h1>
          {description ? <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-strong)]">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
