import { DeviceImportModelAssist } from '@/components/devices/device-import-model-assist'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportModelAssistPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportModelAssist batchId={batchId} />
}
