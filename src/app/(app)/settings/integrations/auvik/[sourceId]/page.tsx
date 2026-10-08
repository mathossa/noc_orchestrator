import { notFound } from 'next/navigation'
import { AuvikConnectionManager } from '@/components/settings/auvik-connection-manager'
import { IntegrationSetupHelpLink } from '@/components/settings/integration-setup-help-link'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { getAuvikInventoryConnection } from '@/lib/auvik-integration-store'
import { listInventorySyncRuns } from '@/lib/inventory-sync-run-store'

export const dynamic = 'force-dynamic'

export default async function AuvikConnectionPage({
  params,
}: {
  params: Promise<{ sourceId: string }>
}) {
  const { sourceId } = await params
  const connection = await getAuvikInventoryConnection(sourceId)
  if (!connection) notFound()
  const syncRuns = await listInventorySyncRuns(sourceId)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings · Integrations · Auvik"
        title={connection.name}
        description="Auvik Network Management Device API v2 inventory source. Syncs stage observed state through the shared Importer v2 reconciliation and publication path."
        alignActionsTop
        actions={<IntegrationSetupHelpLink provider="auvik" />}
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations', href: '/settings/integrations' },
          { label: connection.name },
        ]}
        meta={
          <>
            <StatusBadge tone={connection.enabled ? 'success' : 'neutral'}>
              {connection.enabled ? 'Enabled' : 'Disabled'}
            </StatusBadge>
            <span>{connection.configuration.region}</span>
            <span>{connection.configuration.tenants.length} tenant scope(s)</span>
          </>
        }
      />
      <AuvikConnectionManager initialConnection={connection} initialSyncRuns={syncRuns.map((run) => ({ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }))} />
    </div>
  )
}
