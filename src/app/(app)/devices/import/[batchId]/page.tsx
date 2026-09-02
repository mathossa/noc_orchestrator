import { DeviceImportReconciliationWorkspace } from '@/components/devices/device-import-reconciliation-workspace'
import { DeviceImportSafeActionsControl } from '@/components/devices/device-import-safe-actions-control'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <>
    <DeviceImportReconciliationWorkspace batchId={batchId} />
    <DeviceImportSafeActionsControl batchId={batchId} />
  </>
}
