'use client'

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-5">
      <h1 className="text-lg font-semibold">Werkoverzicht niet beschikbaar</h1>
      <p className="mt-2 text-sm text-[var(--muted-strong)]">
        De actuele werkzaamheden konden niet worden geladen. De onderliggende inventaris is niet gewijzigd.
      </p>
      <button
        type="button"
        className="mt-4 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)]"
        onClick={reset}
      >
        Opnieuw proberen
      </button>
    </div>
  )
}
