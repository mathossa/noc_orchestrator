import Link from 'next/link'
import { DeviceImportIgnoredRowsPanel } from '@/components/devices/device-import-ignored-rows-panel'
import { DeviceImportInlineReconciliationWorksheet } from '@/components/devices/device-import-inline-reconciliation-worksheet'
import { DeviceImportProfileMemoryPanel } from '@/components/devices/device-import-profile-memory-panel'
import { DeviceImportReconciliationWorkspace } from '@/components/devices/device-import-reconciliation-workspace'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportReconciliationWorkspace
    batchId={batchId}
    reconciliationWorksheet={<>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-4 py-3">
        <div><div className="text-sm font-semibold text-[var(--accent-light)]">Firmware resolution workspace</div><div className="mt-1 text-xs text-[var(--muted-strong)]">Inspect the affected devices, distinguish profile/system rules from predictions, and see why a firmware platform/version was proposed.</div></div>
        <Link href={`/devices/import/${batchId}/firmware`} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:brightness-110">Open Firmware reconciliation →</Link>
      </div>
      <DeviceImportIgnoredRowsPanel batchId={batchId} />
      <DeviceImportProfileMemoryPanel batchId={batchId} />
      <DeviceImportInlineReconciliationWorksheet batchId={batchId} />
    </>}
  />
}
