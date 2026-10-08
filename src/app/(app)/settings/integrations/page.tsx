import { ButtonLink } from '@/components/ui/button'
import {
  DataTable,
  type DataTableColumn,
} from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  listInventorySources,
  listInventorySyncProfiles,
} from '@/lib/inventory-integrations-store'
import { listAuvikInventoryConnections } from '@/lib/auvik-integration-store'
import { listMerakiInventoryConnections } from '@/lib/meraki-integration-store'

export const dynamic = 'force-dynamic'

type SourceRow = {
  id: string
  name: string
  provider: string
  adapterType: string
  sourceAdapterId: string
  enabled: boolean
  profiles: string[]
}

type ProfileRow = {
  id: string
  name: string
  enabled: boolean
  sources: string[]
}

const sourceColumns: Array<DataTableColumn<SourceRow>> = [
  {
    key: 'source',
    header: 'Source',
    render: (row) => (
      <div className="min-w-[180px]">
        <div className="font-semibold text-[var(--foreground)]">
          {(row.adapterType === 'auvik-api-v2' || row.adapterType === 'meraki-dashboard-api-v1') ? (
            <a
              href={row.adapterType === 'auvik-api-v2' ? `/settings/integrations/auvik/${row.id}` : `/settings/integrations/meraki/${row.id}`}
              className="text-[var(--accent-light)] hover:underline"
            >
              {row.name}
            </a>
          ) : (
            row.name
          )}
        </div>
        <div className="mt-0.5 text-xs text-[var(--muted)]">{row.sourceAdapterId}</div>
      </div>
    ),
  },
  {
    key: 'provider',
    header: 'Provider',
    render: (row) => row.provider,
  },
  {
    key: 'adapter',
    header: 'Adapter',
    render: (row) => row.adapterType,
  },
  {
    key: 'profiles',
    header: 'Sync profiles',
    render: (row) => row.profiles.length > 0 ? row.profiles.join(', ') : '—',
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <StatusBadge tone={row.enabled ? 'success' : 'neutral'}>
        {row.enabled ? 'Enabled' : 'Disabled'}
      </StatusBadge>
    ),
  },
]

const profileColumns: Array<DataTableColumn<ProfileRow>> = [
  {
    key: 'profile',
    header: 'Profile',
    render: (row) => (
      <span className="font-semibold text-[var(--foreground)]">{row.name}</span>
    ),
  },
  {
    key: 'sources',
    header: 'Sources',
    render: (row) => row.sources.join(', '),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <StatusBadge tone={row.enabled ? 'success' : 'neutral'}>
        {row.enabled ? 'Enabled' : 'Disabled'}
      </StatusBadge>
    ),
  },
]

export default async function IntegrationsPage() {
  const [sources, profiles, auvikConnections, merakiConnections] = await Promise.all([
    listInventorySources(),
    listInventorySyncProfiles(),
    listAuvikInventoryConnections(),
    listMerakiInventoryConnections(),
  ])
  const profileNamesBySource = new Map<string, string[]>()
  for (const profile of profiles) {
    for (const link of profile.sources) {
      profileNamesBySource.set(link.sourceId, [
        ...(profileNamesBySource.get(link.sourceId) ?? []),
        profile.name,
      ])
    }
  }

  const sourceRows: SourceRow[] = sources.map((source) => ({
    id: source.id ?? source.sourceAdapterId,
    name: source.name,
    provider: source.provider,
    adapterType: source.adapterType,
    sourceAdapterId: source.sourceAdapterId,
    enabled: source.enabled,
    profiles: profileNamesBySource.get(source.id ?? '') ?? [],
  }))
  const profileRows: ProfileRow[] = profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    sources: profile.sources.map((link) => link.source.name),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        description="Inventory sources supply observed device and current-firmware evidence through the shared Importer v2 pipeline. Policy, exceptions, planning and customer decisions remain NOC-owned."
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/settings/integrations/auvik/new">
              Add Auvik connection
            </ButtonLink>
            <ButtonLink href="/settings/integrations/meraki/new">
              Add Meraki connection
            </ButtonLink>
            <ButtonLink href="/settings/integrations/import-automation">
              Manage import automation
            </ButtonLink>
            <ButtonLink href="/devices/import" variant="primary">
              Import XLSX
            </ButtonLink>
          </div>
        }
      />

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              Inventory adapters
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              XLSX, Auvik Device API v2 and Cisco Meraki Dashboard all feed the shared Importer v2 pipeline.
            </p>
          </div>
          <StatusBadge tone="success">Supported</StatusBadge>
        </div>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div>
            <div className="font-semibold text-[var(--foreground)]">XLSX file upload</div>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Existing source detection, column mapping, hierarchy resolution, identity matching,
              firmware interpretation, repeat diff, QA and atomic publication are preserved.
              Additional API adapters can feed the same normalized staging boundary later.
            </p>
          </div>
          <ButtonLink href="/devices/import">Open import</ButtonLink>
        </div>
        <div className="grid gap-4 border-t border-[var(--border)] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold text-[var(--foreground)]">
                Auvik Network Management
              </div>
              <StatusBadge tone="success">Device API v2</StatusBadge>
            </div>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--muted)]">
              Saved encrypted connection, connection test, explicit tenant scope and
              manual Sync now. Auvik remains observed-state only; reconciliation and
              final publication use Importer v2.
            </p>
            {auvikConnections.length > 0 ? (
              <div className="mt-2 text-xs text-[var(--muted-strong)]">
                {auvikConnections.length} configured connection
                {auvikConnections.length === 1 ? '' : 's'}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {auvikConnections[0] ? (
              <ButtonLink
                href={`/settings/integrations/auvik/${auvikConnections[0].id}`}
              >
                Open Auvik
              </ButtonLink>
            ) : null}
            <ButtonLink href="/settings/integrations/auvik/new" variant="primary">
              Add connection
            </ButtonLink>
          </div>
        </div>
        <div className="grid gap-4 border-t border-[var(--border)] px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-[var(--foreground)]">Cisco Meraki Dashboard</div><StatusBadge tone="success">API v1</StatusBadge></div>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--muted)]">Encrypted Dashboard API connection, organization/network scope and shared cross-provider reconciliation through Importer v2.</p>
            {merakiConnections.length > 0 ? <div className="mt-2 text-xs text-[var(--muted-strong)]">{merakiConnections.length} configured connection{merakiConnections.length === 1 ? '' : 's'}</div> : null}
          </div>
          <div className="flex flex-wrap gap-2">{merakiConnections[0] ? <ButtonLink href={`/settings/integrations/meraki/${merakiConnections[0].id}`}>Open Meraki</ButtonLink> : null}<ButtonLink href="/settings/integrations/meraki/new" variant="primary">Add connection</ButtonLink></div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            Inventory sources
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Saved non-secret source definitions. Provider identity is separate from adapter/transport identity.
          </p>
        </div>
        <DataTable
          caption="Configured inventory sources"
          columns={sourceColumns}
          rows={sourceRows}
          rowKey={(row) => row.id}
          emptyState={
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-4 py-8 text-center">
              <p className="font-semibold text-[var(--foreground)]">No saved inventory sources yet</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                XLSX imports continue to work without a saved connection. API connections are follow-up work.
              </p>
            </div>
          }
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            Inventory Sync Profiles
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            A profile groups one or more inventory sources into one logical inventory view. Source precedence and conflict resolution are intentionally not implemented here.
          </p>
        </div>
        <DataTable
          caption="Inventory sync profiles"
          columns={profileColumns}
          rows={profileRows}
          rowKey={(row) => row.id}
          emptyState={
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-4 py-8 text-center">
              <p className="font-semibold text-[var(--foreground)]">No sync profiles configured</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                The persistence model already supports multiple sources per profile for future API integrations.
              </p>
            </div>
          }
        />
      </section>
    </div>
  )
}
