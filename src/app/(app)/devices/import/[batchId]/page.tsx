import { DeviceImportAssistedActions } from '@/components/devices/device-import-assisted-actions'
import { DeviceImportBatchWorkspace } from '@/components/devices/device-import-batch'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <>
    <DeviceImportAssistedActions batchId={batchId} />
    <DeviceImportBatchWorkspace batchId={batchId} />
  </>
}
