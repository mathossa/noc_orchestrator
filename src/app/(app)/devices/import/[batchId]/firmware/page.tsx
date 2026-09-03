import { DeviceImportFirmwareReconciliationWorkspaceV2 } from '@/components/devices/device-import-firmware-reconciliation-workspace-v2'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportFirmwareAssistPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportFirmwareReconciliationWorkspaceV2 batchId={batchId} />
}
