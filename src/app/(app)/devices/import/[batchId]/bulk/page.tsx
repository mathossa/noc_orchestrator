import { DeviceImportBulkResolve } from '@/components/devices/device-import-bulk-resolve'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportBulkResolvePage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportBulkResolve batchId={batchId} />
}
