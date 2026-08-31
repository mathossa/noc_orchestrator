import type { ReactNode } from 'react'

export type DataTableColumn<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
  headerClassName?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyState,
}: {
  columns: Array<DataTableColumn<T>>
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  emptyState?: ReactNode
}) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>

  return (
    <div className="noc-scrollbar overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)] ${column.headerClassName ?? ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition-colors hover:bg-[var(--surface-muted)]">
              {columns.map((column) => (
                <td key={column.key} className={`px-3 py-2.5 align-middle text-[var(--muted-strong)] ${column.className ?? ''}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
