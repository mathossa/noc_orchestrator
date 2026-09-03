import { DeviceImportIgnoredRowsPanel } from '@/components/devices/device-import-ignored-rows-panel'
import { DeviceImportInlineReconciliationWorksheet } from '@/components/devices/device-import-inline-reconciliation-worksheet'
import { DeviceImportReconciliationWorkspace } from '@/components/devices/device-import-reconciliation-workspace'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportReconciliationWorkspace
    batchId={batchId}
    reconciliationWorksheet={<>
      <DeviceImportIgnoredRowsPanel batchId={batchId} />
      <DeviceImportInlineReconciliationWorksheet batchId={batchId} />
    </>}
  />
}
