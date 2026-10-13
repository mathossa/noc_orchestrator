import Link from 'next/link'

export type InventoryStage = 0 | 1 | 2 | 3

export type InventoryStageLinks = {
  customers?: string
  sites?: string
  deviceTypes?: string
}

/** Names resolved from the canonical inventory scope, not inferred from URL segments. */
export type InventoryStageSelections = {
  customers?: string
  sites?: string
  deviceTypes?: string
}

const stages = [
  { id: 'customers', label: 'Customers', description: 'Select a customer' },
  { id: 'sites', label: 'Sites', description: 'Select a site' },
  { id: 'deviceTypes', label: 'Device types', description: 'Select a type' },
  { id: 'devices', label: 'Devices', description: 'View devices' },
] as const

/** Readable, scoped navigation for the existing inventory drill-down (no parallel data model). */
export function InventoryPath({
  current,
  links = {},
  selections = {},
}: {
  current: InventoryStage
  links?: InventoryStageLinks
  selections?: InventoryStageSelections
}) {
  return (
    <nav aria-label="Inventory exploration steps" className="mb-5">
      <ol className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const href = index < current ? links[stage.id as keyof InventoryStageLinks] : undefined
          const active = index === current
          const selectedName = stage.id === 'devices' ? undefined : selections[stage.id]
          const description = selectedName?.trim() || stage.description
          const content = (
            <>
              <span
                aria-hidden="true"
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                    : index < current
                      ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                      : 'bg-[var(--surface-raised)] text-[var(--muted)]',
                ].join(' ')}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{stage.label}</span>
                <span
                  className={[
                    'block truncate text-xs',
                    selectedName?.trim() ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]',
                  ].join(' ')}
                  title={description}
                >
                  {description}
                </span>
              </span>
            </>
          )
          const classes = [
            'flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
            active
              ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--foreground)]'
              : href
                ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent-muted)] hover:bg-[var(--surface-muted)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]',
          ].join(' ')

          return (
            <li key={stage.id}>
              {href ? (
                <Link href={href} className={classes}>
                  {content}
                </Link>
              ) : (
                <div className={classes} aria-current={active ? 'step' : undefined}>
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
