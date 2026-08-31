import { FirmwareTrainDetail } from '@/components/firmware/firmware-train-detail'

type PageProps = { params: Promise<{ id: string }> }

export default async function FirmwareTrainDetailPage({ params }: PageProps) {
  const { id } = await params
  return <FirmwareTrainDetail trainId={id} />
}
