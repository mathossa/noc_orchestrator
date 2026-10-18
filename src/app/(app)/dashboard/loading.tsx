export default function DashboardLoading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="h-8 w-44 animate-pulse rounded-md bg-[var(--surface-raised)]" />
      <div className="h-12 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="h-80 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
        <div className="h-60 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
      </div>
      <span className="sr-only">Werkoverzicht laden…</span>
    </div>
  )
}
