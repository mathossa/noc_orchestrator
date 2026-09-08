import { DeviceModelDetail } from '@/components/device-models/device-model-detail'
import { ModelFirmwareCompatibilityPanel } from '@/components/firmware/firmware-compatibility-panels'

type PageProps = { params: Promise<{ id: string }> }

export default async function DeviceModelDetailPage({ params }: PageProps) {
  const { id } = await params
  return (
    <>
      <DeviceModelDetail modelId={id} />
      <ModelFirmwareCompatibilityPanel modelId={id} />
    </>
  )
}
