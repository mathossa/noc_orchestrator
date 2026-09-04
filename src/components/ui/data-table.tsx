import type { ReactNode } from 'react'

export type DataTableColumn<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  headerClassName?: string
  align?: 'left' | 'center' | 'right'
  numeric?: boolean
}

const alignmentClasses = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyState,
  density = 'compact',
  rowClassName,
}: {
  columns: Array<DataTableColumn<T>>
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  emptyState?: ReactNode
  density?: 'compact' | 'comfortable'
  rowClassName?: (row: T) => string | undefined
}) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>

  const cellPadding = density === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3.5'

  return (
    <div
      className="noc-scrollbar relative overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
            {columns.map((column) => {
              const align = alignmentClasses[column.align ?? (column.numeric ? 'right' : 'left')]
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={`sticky top-0 z-10 whitespace-nowrap bg-[var(--surface-raised)] ${cellPadding} ${align} text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] ${column.headerClassName ?? ''}`}
                >
                  {column.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`transition-colors hover:bg-[var(--surface-muted)] focus-within:bg-[var(--surface-muted)] ${rowClassName?.(row) ?? ''}`}
            >
              {columns.map((column) => {
                const align = alignmentClasses[column.align ?? (column.numeric ? 'right' : 'left')]
                return (
                  <td
                    key={column.key}
                    className={`${cellPadding} ${align} align-middle text-[var(--muted-strong)] ${column.numeric ? 'tabular-nums' : ''} ${column.className ?? ''}`}
                  >
                    {column.render(row)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
