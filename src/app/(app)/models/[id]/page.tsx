import { DeviceModelDetail } from '@/components/device-models/device-model-detail'

type PageProps = { params: Promise<{ id: string }> }

export default async function DeviceModelDetailPage({ params }: PageProps) {
  const { id } = await params
  return <DeviceModelDetail modelId={id} />
}
