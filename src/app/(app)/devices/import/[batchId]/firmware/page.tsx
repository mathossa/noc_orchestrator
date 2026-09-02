import { DeviceImportFirmwareAssist } from '@/components/devices/device-import-firmware-assist'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportFirmwareAssistPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportFirmwareAssist batchId={batchId} />
}
