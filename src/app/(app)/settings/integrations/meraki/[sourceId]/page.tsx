import { notFound } from 'next/navigation'
import { MerakiConnectionManager } from '@/components/settings/meraki-connection-manager'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { getMerakiInventoryConnection } from '@/lib/meraki-integration-store'
import { listInventorySyncRuns } from '@/lib/inventory-sync-run-store'
export const dynamic = 'force-dynamic'
export default async function MerakiConnectionPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params
  const connection = await getMerakiInventoryConnection(sourceId)
  if (!connection) notFound()
  const syncRuns = await listInventorySyncRuns(sourceId)
  return <div className="space-y-6">
    <PageHeader eyebrow="Settings · Integrations · Cisco Meraki" title={connection.name}
      description="Cisco Meraki Dashboard observed inventory source. Syncs stage through shared hierarchy, identity reconciliation and Importer v2 publication."
      breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Integrations', href: '/settings/integrations' }, { label: connection.name }]}
      meta={<><StatusBadge tone={connection.enabled ? 'success' : 'neutral'}>{connection.enabled ? 'Enabled' : 'Disabled'}</StatusBadge><span>{connection.configuration.environment}</span><span>{connection.configuration.organizations.length} organization scope(s)</span></>} />
    <MerakiConnectionManager initialConnection={connection} initialSyncRuns={syncRuns.map((run) => ({ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }))} />
  </div>
}
