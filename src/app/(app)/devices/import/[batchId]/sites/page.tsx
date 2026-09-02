import { DeviceImportSiteAssist } from '@/components/devices/device-import-site-assist'

type PageProps = { params: Promise<{ batchId: string }> }

export default async function DeviceImportSiteAssistPage({ params }: PageProps) {
  const { batchId } = await params
  return <DeviceImportSiteAssist batchId={batchId} />
}
