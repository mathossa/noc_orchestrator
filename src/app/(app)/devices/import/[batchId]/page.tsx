import { DeviceImportBulkReconciliationSheet } from '@/components/devices/device-import-bulk-reconciliation-sheet'
import { DeviceImportReconciliationWorkspace } from '@/components/devices/device-import-reconciliation-workspace'
import { DeviceImportSafeActionsControl } from '@/components/devices/device-import-safe-actions-control'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <>
    <DeviceImportReconciliationWorkspace batchId={batchId} />
    <DeviceImportBulkReconciliationSheet batchId={batchId} />
    <DeviceImportSafeActionsControl batchId={batchId} />
  </>
}
