import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { ArubaClassicConnectionManager } from '@/components/settings/aruba-classic-connection-manager'
import { getClassicCentralConnection } from '@/lib/aruba-classic-integration-store'
import { listInventorySyncRuns } from '@/lib/inventory-sync-run-store'
export const dynamic='force-dynamic'
export default async function ArubaConnectionPage({params}:{params:Promise<{sourceId:string}>}){
  const {sourceId}=await params
  const connection=await getClassicCentralConnection(sourceId)
  if(!connection)notFound()
  const runs=await listInventorySyncRuns(sourceId)
  return <div className="space-y-6">
    <PageHeader eyebrow="Settings · Integrations · Aruba" title={connection.name}
      description="Classic Central inventory with encrypted credentials, selected sites and shared Importer v2 reconciliation."
      breadcrumbs={[{label:'Settings',href:'/settings'},{label:'Integrations',href:'/settings/integrations'},{label:connection.name}]}
      meta={<><StatusBadge tone={connection.enabled?'success':'neutral'}>{connection.enabled?'Enabled':'Disabled'}</StatusBadge>
        <span>Classic Central</span><span>{connection.configuration.sites.length} sites configured</span></>}/>
    <ArubaClassicConnectionManager initialConnection={connection}
      initialSyncRuns={runs.map(run=>({...run,startedAt:run.startedAt.toISOString(),finishedAt:run.finishedAt?.toISOString()??null}))}/>
  </div>
}
