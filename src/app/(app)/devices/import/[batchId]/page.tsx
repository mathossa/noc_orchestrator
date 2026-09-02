import { DeviceImportManualEntityResolver } from '@/components/devices/device-import-manual-entity-resolver'
import { DeviceImportReconciliationWorkspace } from '@/components/devices/device-import-reconciliation-workspace'
import { DeviceImportSafeActionsControl } from '@/components/devices/device-import-safe-actions-control'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <>
    <DeviceImportReconciliationWorkspace batchId={batchId} />
    <DeviceImportManualEntityResolver batchId={batchId} />
    <DeviceImportSafeActionsControl batchId={batchId} />
  </>
}
