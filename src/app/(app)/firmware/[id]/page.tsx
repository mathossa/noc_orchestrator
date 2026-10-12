import { FirmwareReleaseDetail } from '@/components/firmware/firmware-release-detail'
import { ReleaseDocumentationLinks } from '@/components/firmware/release-documentation-links'
import { ReleaseModelCompatibilityPanel } from '@/components/firmware/firmware-compatibility-panels'

type PageProps = { params: Promise<{ id: string }> }

export default async function FirmwareReleaseDetailPage({ params }: PageProps) {
  const { id } = await params
  return (
    <>
      <FirmwareReleaseDetail releaseId={id} />
      <ReleaseDocumentationLinks releaseId={id} editable />
      <ReleaseModelCompatibilityPanel releaseId={id} />
    </>
  )
}
