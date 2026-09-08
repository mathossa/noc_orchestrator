import Link from 'next/link'
import { ImporterV2Upload } from '@/components/devices/importer-v2-upload'
import { listImporterV2WorkspaceBatches } from '@/lib/importer-v2-workspace-store'
import { PageHeader } from '@/components/ui/page-header'

export const dynamic = 'force-dynamic'

export default async function DeviceImportPage() {
  const batches = await listImporterV2WorkspaceBatches()
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Inventory"
        title="Device import"
        description="Upload source inventory, evaluate it in quarantine, resolve matching and data issues, and publish only after final QA."
      />

      <ImporterV2Upload />

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Staged imports</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Unfinished and published Importer v2 batches remain available for review and audit.</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_150px] gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>Batch</span><span>Provider</span><span>Rows</span><span>Status</span>
        </div>
        {batches.length === 0 ? (
          <div className="p-6 text-sm text-[var(--muted)]">
            No staged imports yet. Upload an XLSX workbook above to start one.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {batches.map((batch) => (
              <li key={batch.id}>
                <Link
                  href={`/devices/import/${batch.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_120px_120px_150px] gap-3 px-4 py-3 text-sm transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--accent)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[var(--foreground)]">{batch.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">Profile v{batch.profileVersion}</span>
                  </span>
                  <span className="text-[var(--muted-strong)]">{batch.provider}</span>
                  <span className="tabular-nums text-[var(--muted-strong)]">{batch.rowCount.toLocaleString()}</span>
                  <span className="text-[var(--accent-light)]">{batch.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
