import { DeviceImportBatchWorkspace } from '@/components/devices/device-import-batch'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBatchPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportBatchWorkspace batchId={batchId} />
}
