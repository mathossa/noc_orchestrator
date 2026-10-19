import Link from 'next/link'
import type { InventoryFilterOptions } from '@/lib/inventory-explorer'
import type { FirmwareCampaign } from '@/lib/dashboard-firmware-campaigns'
import { countFirmwareCampaigns } from '@/lib/dashboard-firmware-campaigns'

export type CampaignFocus = 'critical' | 'required' | 'recommended' | 'review' | ''
export type CampaignScope = {
  customer: string
  vendor: string
  contract: string
  focus: CampaignFocus
  page: number
}

const pageSize = 6

export function campaignDashboardHref(scope: CampaignScope, patch: Partial<CampaignScope> = {}) {
  const next = { ...scope, ...patch }
  const params = new URLSearchParams()
  if (next.customer) params.set('customer', next.customer)
  if (next.vendor) params.set('vendor', next.vendor)
  if (next.contract) params.set('contract', next.contract)
  if (next.focus) params.set('focus', next.focus)
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return '/dashboard' + (query ? '?' + query : '')
}

export function campaignDetailHref(id: string, scope: Pick<CampaignScope, 'customer' | 'vendor' | 'contract'>) {
  const params = new URLSearchParams()
  if (scope.customer) params.set('customer', scope.customer)
  if (scope.vendor) params.set('vendor', scope.vendor)
  if (scope.contract) params.set('contract', scope.contract)
  const query = params.toString()
  return '/dashboard/campaigns/' + encodeURIComponent(id) + (query ? '?' + query : '')
}

function Filter({ title, name, value, values }: {
  title: string
  name: string
  value: string
  values: Array<{ id: string; name: string }>
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-[var(--muted-strong)]">
      <span>{title}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-9 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-sm text-[var(--foreground)]"
      >
        <option value="">Alle {name === 'customer' ? 'klanten' : name === 'vendor' ? 'vendors' : 'contracten'}</option>
        {name === 'contract' ? <option value="none">Geen contract</option> : null}
        {values.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  )
}

const focusValues: Array<{ key: Exclude<CampaignFocus, ''>; label: string; tone: string; field: 'criticalDevices' | 'updateRequiredDevices' | 'recommendedDevices' | 'reviewDevices'; itemField: 'criticalCount' | 'requiredCount' | 'recommendedCount' | 'reviewCount' }> = [
  { key: 'critical', label: 'Kritieke status', tone: 'var(--danger)', field: 'criticalDevices', itemField: 'criticalCount' },
  { key: 'required', label: 'Update vereist', tone: 'var(--warning)', field: 'updateRequiredDevices', itemField: 'requiredCount' },
  { key: 'recommended', label: 'Aanbevolen', tone: 'var(--accent-light)', field: 'recommendedDevices', itemField: 'recommendedCount' },
  { key: 'review', label: 'Te controleren', tone: 'var(--info)', field: 'reviewDevices', itemField: 'reviewCount' },
]

const priorityText = {
  CRITICAL: 'Kritieke firmwarestatus',
  REQUIRED: 'Onder minimumbeleid',
  RECOMMENDED: 'Update aanbevolen',
  REVIEW: 'Onderzoek nodig',
}

export function FirmwareCampaignOverview({
  campaigns,
  filters,
  scope,
}: {
  campaigns: FirmwareCampaign[]
  filters: InventoryFilterOptions
  scope: CampaignScope
}) {
  const counts = countFirmwareCampaigns(campaigns)
  const selected = focusValues.find((entry) => entry.key === scope.focus)
  const visible = selected
    ? campaigns.filter((campaign) => campaign[selected.itemField] > 0)
    : campaigns
  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const current = Math.min(scope.page, pages)
  const rows = visible.slice((current - 1) * pageSize, current * pageSize)
  const pendingApprovals = campaigns.reduce((total, campaign) => total + campaign.awaitingCustomerCount, 0)
  const plannedDevices = campaigns.reduce((total, campaign) => total + campaign.plannedCount, 0)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Werkoverzicht</h1>
        <span className="text-xs text-[var(--muted)]">
          {scope.customer ? filters.customers.find((x) => x.id === scope.customer)?.name ?? 'Geselecteerde klant' : 'Alle klanten'}
        </span>
      </header>

      <form action="/dashboard" method="get" aria-label="Firmwarecampagnes filteren">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="min-w-40 flex-1"><Filter title="Klant" name="customer" value={scope.customer} values={filters.customers} /></div>
          <div className="min-w-40 flex-1"><Filter title="Vendor" name="vendor" value={scope.vendor} values={filters.vendors} /></div>
          <div className="min-w-40 flex-1"><Filter title="Beheercontract" name="contract" value={scope.contract} values={filters.contracts} /></div>
          <button type="submit" className="h-9 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-contrast)]">Filter</button>
          <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] px-3 text-sm hover:bg-[var(--surface-raised)]">Wissen</Link>
        </div>
      </form>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Apparaten die firmwareaandacht nodig hebben">
        {focusValues.map((item) => {
          const count = counts[item.field]
          const active = scope.focus === item.key
          return (
            <Link key={item.key}
              href={campaignDashboardHref(scope, { focus: active ? '' : item.key, page: 1 })}
              aria-current={active ? 'true' : undefined}
              className={[
                'rounded-lg border bg-[var(--surface)] p-3 transition-colors hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
                active ? 'border-[var(--accent)]' : 'border-[var(--border)]',
              ].join(' ')}
            >
              <p className="text-xs font-semibold text-[var(--muted-strong)]">{item.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: item.tone }}>{count}</p>
              <p className="text-xs text-[var(--muted)]">devices · {campaigns.filter((campaign) => campaign[item.itemField] > 0).length} campagnes</p>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2.6fr)_minmax(255px,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Firmwarecampagnes</h2>
            <span className="text-xs tabular-nums text-[var(--muted)]">{visible.length} campagnes</span>
          </div>
          {rows.length ? (
            <ol className="divide-y divide-[var(--border)]">
              {rows.map((campaign) => (
                <li key={campaign.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={[
                        'rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
                        campaign.severity === 'CRITICAL' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' :
                          campaign.severity === 'REQUIRED' ? 'bg-[var(--warning-soft)] text-[var(--warning)]' :
                          'bg-[var(--surface-raised)] text-[var(--muted-strong)]',
                      ].join(' ')}>{priorityText[campaign.severity]}</span>
                      <span className="text-sm font-semibold">
                        {campaign.vendor.name} {campaign.platform} · {campaign.sourceTrain}
                        {campaign.targetVersion ? ' → ' + campaign.targetVersion : ' · doel onbekend'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted-strong)]">
                      {campaign.deviceCount} devices · {campaign.customerCount} klanten · {campaign.releases.length} huidige releases
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {campaign.releases.slice(0, 4).map((release) => (
                        <span key={release.version} className="rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                          {release.version} ({release.deviceCount})
                        </span>
                      ))}
                      {campaign.releases.length > 4 ? (
                        <span className="text-xs text-[var(--muted)]">+{campaign.releases.length - 4}</span>
                      ) : null}
                    </div>
                  </div>
                  <Link href={campaignDetailHref(campaign.id, scope)}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-[var(--accent-muted)] px-3 text-xs font-semibold text-[var(--accent-light)] hover:bg-[var(--accent-soft)]"
                  >Bekijk impact →</Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-5 text-sm text-[var(--muted)]">Geen firmwarecampagnes in deze selectie.</p>
          )}
          {pages > 1 ? (
            <nav aria-label="Campagnepagina's" className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs">
              {current > 1 ? <Link href={campaignDashboardHref(scope, { page: current - 1 })} className="text-[var(--accent-light)] hover:underline">← Vorige</Link> : <span />}
              <span className="tabular-nums text-[var(--muted)]">{current} / {pages}</span>
              {current < pages ? <Link href={campaignDashboardHref(scope, { page: current + 1 })} className="text-[var(--accent-light)] hover:underline">Volgende →</Link> : <span />}
            </nav>
          ) : null}
        </section>
        <aside className="space-y-3" aria-label="Uitvoering en opvolging">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Uitvoering</h2>
            <div className="space-y-3 p-4 text-sm">
              <p><span className="font-bold tabular-nums">{pendingApprovals}</span> devices wachten op klantakkoord</p>
              <p><span className="font-bold tabular-nums">{plannedDevices}</span> devices in actieve planning</p>
              <Link href="/planning" className="inline-block text-xs font-semibold text-[var(--accent-light)] hover:underline">Onderhoudsplannen →</Link>
            </div>
          </section>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Werkwijze</h2>
            <div className="p-4 text-xs text-[var(--muted-strong)]">
              Open een firmwarecampagne voor de exacte releases en getroffen klanten.
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
