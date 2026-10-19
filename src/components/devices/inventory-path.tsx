import Link from 'next/link'

export type InventoryStage = 0 | 1 | 2 | 3

export type InventoryStageLinks = {
  customers?: string
  sites?: string
  deviceTypes?: string
  devices?: string
}

/** Human-readable names from the canonical inventory scope. */
export type InventoryStageSelections = {
  customers?: string
  sites?: string
  deviceTypes?: string
  devices?: string
}

const stages = [
  { id: 'customers', label: 'Customers' },
  { id: 'sites', label: 'Sites' },
  { id: 'deviceTypes', label: 'Device types' },
  { id: 'devices', label: 'Devices' },
] as const

/**
 * The single inventory breadcrumb, from overview to individual device detail.
 * Earlier steps navigate back; on a device detail the Devices step returns to its list.
 */
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
    <nav aria-label="Inventory exploration steps" className="mb-4">
      <ol className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const selectedName = selections[stage.id]?.trim()
          const active = index === current
          const href = index < current || (active && stage.id === 'devices' && selectedName)
            ? links[stage.id]
            : undefined
          const classes = [
            'flex min-h-11 min-w-0 items-center rounded-md border px-3 py-2 transition-colors',
            active
              ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--foreground)]'
              : href
                ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent-muted)] hover:bg-[var(--surface-muted)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]',
          ].join(' ')
          const content = (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-[13px] font-semibold">{stage.label}</span>
              {selectedName ? (
                <span className="min-w-0 truncate text-xs text-[var(--muted-strong)]" title={selectedName}>
                  {selectedName}
                </span>
              ) : null}
            </span>
          )

          return (
            <li key={stage.id} className="min-w-0">
              {href ? (
                <Link href={href} className={classes} aria-current={active ? 'step' : undefined}>
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
