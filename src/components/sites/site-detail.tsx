'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, ButtonLink } from '@/components/ui/button'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type { SiteDetailRecord } from '@/lib/sites'

type ApiError = { error?: { message?: string } }
type SiteTab = 'overview' | 'network' | 'inventory' | 'notes' | 'history'

const tabs: Array<{ id: SiteTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'network', label: 'Network' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' },
]

function formatDate(value: string | null | undefined, empty = '—') {
  if (!value) return empty
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? empty : date.toLocaleString()
}

function contractSourceLabel(source: SiteDetailRecord['contractSource']) {
  if (source === 'SITE') return 'Site override'
  if (source === 'CUSTOMER') return 'Customer default'
  return 'No contract'
}

function realAuvikUrl(site: SiteDetailRecord) {
  if (site.externalProvider?.trim().toLocaleLowerCase('en-US') !== 'auvik') return null
  const value = site.externalId?.trim()
  return value && /^https?:\/\//i.test(value) ? value : null
}

export function SiteDetail({ customerId, siteId }: { customerId: string; siteId: string }) {
  const [site, setSite] = useState<SiteDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/customers/${customerId}/sites/${siteId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: SiteDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Site could not be loaded.')
        if (!cancelled) setSite(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Site could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, siteId])

  if (loading) return <LoadingState title="Loading site" description="Reading site context…" />
  if (error || !site) {
    return (
      <ErrorState
        title="Site could not be loaded"
        description={error ?? 'The site record is unavailable.'}
        action={
          <Link
            href={`/customers/${customerId}`}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Back to customer
          </Link>
        }
      />
    )
  }

  return <SiteWorkspace site={site} />
}

export function SiteWorkspace({ site }: { site: SiteDetailRecord }) {
  const [activeTab, setActiveTab] = useState<SiteTab>('overview')
  const customerPath = `/customers/${site.customerId}`
  const managePath = `${customerPath}/sites`
  const inventoryPath = `/devices/customers/${site.customerId}/sites/${site.id}`
  const auvikUrl = realAuvikUrl(site)

  const breadcrumbs = [
    { label: 'Customers', href: '/customers' },
    { label: site.customer.name, href: customerPath },
    ...(site.organizationUnit
      ? [
          {
            label: site.organizationUnit.name,
            href: `${managePath}?organizationUnit=${encodeURIComponent(site.organizationUnit.id)}`,
          },
        ]
      : []),
    { label: site.name },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Site"
        title={site.name}
        breadcrumbs={breadcrumbs}
        meta={
          <>
            {site.code ? <span className="font-mono">{site.code}</span> : null}
            {site.code ? <span aria-hidden="true">·</span> : null}
            <span>{site.customer.name}</span>
            {site.organizationUnit ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{site.organizationUnit.name}</span>
              </>
            ) : null}
            {site.city ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{site.city}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{site.deviceCount} device{site.deviceCount === 1 ? '' : 's'}</span>
            {!site.isActive ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[var(--warning)]">Archived</span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <ButtonLink href={managePath}>Manage site</ButtonLink>
            <ButtonLink href={inventoryPath} variant="primary">
              Site inventory
            </ButtonLink>
          </>
        }
      />

      <nav
        aria-label="Site detail sections"
        className="mb-5 overflow-x-auto border-b border-[var(--border)]"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                className={
                  'border-b-2 px-4 py-3 text-sm font-semibold transition ' +
                  (active
                    ? 'border-[var(--accent)] text-[var(--foreground)]'
                    : 'border-transparent text-[var(--muted-strong)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]')
                }
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      {activeTab === 'overview' ? (
        <OverviewTab
          site={site}
          inventoryPath={inventoryPath}
          auvikUrl={auvikUrl}
          onOpenNetwork={() => setActiveTab('network')}
        />
      ) : null}
      {activeTab === 'network' ? <NetworkTab /> : null}
      {activeTab === 'inventory' ? <InventoryTab site={site} inventoryPath={inventoryPath} /> : null}
      {activeTab === 'notes' ? <NotesTab notes={site.notes} /> : null}
      {activeTab === 'history' ? <HistoryTab site={site} /> : null}
    </>
  )
}

function OverviewTab({
  site,
  inventoryPath,
  auvikUrl,
  onOpenNetwork,
}: {
  site: SiteDetailRecord
  inventoryPath: string
  auvikUrl: string | null
  onOpenNetwork: () => void
}) {
  const address = [site.addressLine1, site.addressLine2].filter(Boolean).join(', ')

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <PanelCard title="Site information">
        <DetailList>
          {address ? <DetailRow label="Address" value={address} /> : null}
          {site.region ? <DetailRow label="Province" value={site.region} /> : null}
          {site.city ? <DetailRow label="City" value={site.city} /> : null}
          {site.postalCode ? <DetailRow label="Postal code" value={site.postalCode} /> : null}
          {site.country ? <DetailRow label="Country" value={site.country} /> : null}
          {auvikUrl ? (
            <DetailRow
              label="Auvik URL"
              value={
                <a
                  href={auvikUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--accent-light)] hover:underline"
                >
                  Open in Auvik ↗
                </a>
              }
            />
          ) : null}
        </DetailList>
        {!address && !site.region && !site.city && !site.postalCode && !site.country && !auvikUrl ? (
          <p className="text-sm text-[var(--muted)]">No location details recorded.</p>
        ) : null}
      </PanelCard>

      <PanelCard title="Inventory summary">
        <div className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-[var(--foreground)]">{site.deviceCount}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Total devices</p>
          </div>
        </div>
        <ButtonLink href={inventoryPath} variant="ghost" className="mt-3">
          View full inventory →
        </ButtonLink>
      </PanelCard>

      <PanelCard title="Contract & source">
        <DetailList>
          <DetailRow
            label="Customer"
            value={
              <Link href={`/customers/${site.customerId}`} className="font-medium text-[var(--accent-light)] hover:underline">
                {site.customer.name}
              </Link>
            }
          />
          {site.organizationUnit ? <DetailRow label="Business unit" value={site.organizationUnit.name} /> : null}
          <DetailRow label="Effective contract" value={site.effectiveContractType?.name ?? '—'} />
          <DetailRow label="Contract source" value={contractSourceLabel(site.contractSource)} />
          <DetailRow label="Inventory source" value={site.source} />
          {site.externalProvider ? <DetailRow label="External provider" value={site.externalProvider} /> : null}
          <DetailRow label="Last synchronized" value={formatDate(site.lastSynchronizedAt, 'Never / manual')} />
        </DetailList>
        <ButtonLink
          href={`/firmware/exceptions?scope=SITE&scopeId=${encodeURIComponent(site.id)}`}
          variant="ghost"
          className="mt-3"
        >
          Site exceptions
        </ButtonLink>
      </PanelCard>

      <PanelCard title="Network drawing">
        <p className="text-sm text-[var(--muted)]">
          No network drawing is available for this site yet.
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          Topology data can later be populated from integrations such as Auvik.
        </p>
        <Button variant="ghost" className="mt-3" onClick={onOpenNetwork}>
          Open Network section →
        </Button>
      </PanelCard>
    </div>
  )
}

function NetworkTab() {
  return (
    <PanelCard title="Network drawing">
      <p className="text-sm text-[var(--muted)]">
        No network drawing is available for this site yet.
      </p>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        Connected-device topology and update-order tiers are intentionally deferred until real integration data is available.
      </p>
    </PanelCard>
  )
}

function InventoryTab({ site, inventoryPath }: { site: SiteDetailRecord; inventoryPath: string }) {
  return (
    <PanelCard title="Site inventory">
      <DetailList>
        <DetailRow label="Total devices" value={String(site.deviceCount)} />
      </DetailList>
      <ButtonLink href={inventoryPath} variant="primary" className="mt-4">
        View full inventory
      </ButtonLink>
    </PanelCard>
  )
}

function NotesTab({ notes }: { notes: string | null }) {
  return (
    <PanelCard title="Site notes">
      {notes ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted-strong)]">
          {notes}
        </p>
      ) : (
        <p className="text-sm text-[var(--muted)]">No site notes recorded.</p>
      )}
    </PanelCard>
  )
}

function HistoryTab({ site }: { site: SiteDetailRecord }) {
  return (
    <PanelCard title="Record history">
      <DetailList>
        <DetailRow label="Created" value={formatDate(site.createdAt)} />
        <DetailRow label="Updated" value={formatDate(site.updatedAt)} />
        <DetailRow label="Last synchronized" value={formatDate(site.lastSynchronizedAt, 'Never / manual')} />
        <DetailRow label="Source" value={site.externalProvider ?? site.source} />
      </DetailList>
      <p className="mt-4 text-xs text-[var(--muted)]">
        No separate Site audit history is exposed by the current Site API.
      </p>
    </PanelCard>
  )
}

function PanelCard({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

function DetailList({ children }: { children: ReactNode }) {
  return <dl className="space-y-3">{children}</dl>
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(0,1.2fr)] gap-4 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-[var(--foreground)]">{value}</dd>
    </div>
  )
}
