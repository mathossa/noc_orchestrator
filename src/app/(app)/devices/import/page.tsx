import { ImporterV2BatchList } from '@/components/devices/importer-v2-batch-list'
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
        description="Upload source inventory, evaluate it in quarantine, resolve only the exceptions, and publish after final QA."
      />

      <ImporterV2Upload />

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Staged imports</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Unpublished staging can be deleted. Published batches remain available as audit history.
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_120px_100px_150px_110px] gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>Batch</span><span>Provider</span><span>Rows</span><span>Status</span><span>Actions</span>
        </div>
        <ImporterV2BatchList batches={batches} />
      </section>
    </div>
  )
}
