import { ImporterV2Workspace } from '@/components/devices/importer-v2-workspace'

type ImportWorkspacePageProps = { params: Promise<{ batchId: string }> }

export default async function ImportWorkspacePage({ params }: ImportWorkspacePageProps) {
  const { batchId } = await params
  return <ImporterV2Workspace batchId={batchId} />
}
