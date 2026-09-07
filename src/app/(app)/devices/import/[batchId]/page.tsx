import { ImporterV2WorkspaceFrame } from '@/components/devices/importer-v2-workspace-frame'

type ImportWorkspacePageProps = { params: Promise<{ batchId: string }> }

export default async function ImportWorkspacePage({ params }: ImportWorkspacePageProps) {
  const { batchId } = await params
  return <ImporterV2WorkspaceFrame batchId={batchId} />
}
