'use client'

export function PrintInventoryReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)]"
    >
      Print / Save as PDF
    </button>
  )
}
