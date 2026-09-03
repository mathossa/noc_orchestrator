import { DeviceImportFirmwareReconciliationWorkspace } from '@/components/devices/device-import-firmware-reconciliation-workspace'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportFirmwareAssistPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportFirmwareReconciliationWorkspace batchId={batchId} />
}
