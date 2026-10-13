import { notFound } from 'next/navigation'
import { AuvikConnectionManager } from '@/components/settings/auvik-connection-manager'
import { IntegrationSetupHelpLink } from '@/components/settings/integration-setup-help-link'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { getAuvikInventoryConnection } from '@/lib/auvik-integration-store'
import { listInventorySyncRuns } from '@/lib/inventory-sync-run-store'
import { prisma } from '@/lib/prisma'
import { normalizeAuvikHierarchyNames, cleanAuvikHierarchyLabel } from '@/lib/auvik-tenant-matching'

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
  const savedSites = connection.configuration.tenants.filter((tenant) => tenant.customer && tenant.site)
  const existingTenantIds: string[] = []
  if (savedSites.length > 0) {
    const canonical = await prisma.site.findMany({
      where: { isActive: true },
      select: {
        name: true,
        customer: { select: { name: true, isActive: true } },
        organizationUnit: { select: { name: true } },
      },
    })
    const key = (label: string) => cleanAuvikHierarchyLabel(label).toLocaleLowerCase('en-US')
    for (const tenant of savedSites) {
      const matches = canonical.filter((site) => {
        if (!site.customer.isActive || key(site.customer.name) !== key(tenant.customer ?? '')) return false
        const normalized = normalizeAuvikHierarchyNames([site.customer.name, site.name])?.site
        const matchesName = key(site.name) === key(tenant.site ?? '') ||
          key(normalized ?? '') === key(tenant.site ?? '')
        return matchesName &&
          key(site.organizationUnit?.name ?? '') === key(tenant.businessUnit ?? '')
      })
      if (matches.length === 1) existingTenantIds.push(tenant.tenantId)
    }
  }

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
      <AuvikConnectionManager initialConnection={connection} initialExistingTenantIds={existingTenantIds} initialSyncRuns={syncRuns.map((run) => ({ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null }))} />
    </div>
  )
}
