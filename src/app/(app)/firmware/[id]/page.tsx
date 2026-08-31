import { FirmwareReleaseDetail } from '@/components/firmware/firmware-release-detail'

type PageProps = { params: Promise<{ id: string }> }

export default async function FirmwareReleaseDetailPage({ params }: PageProps) {
  const { id } = await params
  return <FirmwareReleaseDetail releaseId={id} />
}
