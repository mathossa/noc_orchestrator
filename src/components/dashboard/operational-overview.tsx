import Link from 'next/link'
import type { ActionWorkPackage, WorkPackageKind } from '@/lib/dashboard-work-packages'
import { countCandidateWorkPackages } from '@/lib/dashboard-work-packages'
import type { InventoryFilterOptions } from '@/lib/inventory-explorer'

export type DashboardScope = {
  q: string
  customer: string
  vendor: string
  contract: string
  kind: WorkPackageKind | ''
  page: number
}

const kinds: ReadonlyArray<{
  kind: WorkPackageKind
  label: string
  hint: string
  accent: string
}> = [
  { kind: 'URGENT', label: 'Urgent', hint: 'Kritieke firmware', accent: 'var(--danger)' },
  { kind: 'TO_PLAN', label: 'Te plannen', hint: 'Nog niet gepland', accent: 'var(--warning)' },
  { kind: 'BLOCKED', label: 'Geblokkeerd', hint: 'Wacht op akkoord', accent: 'var(--info)' },
  { kind: 'CHECK', label: 'Te controleren', hint: 'Data of review', accent: 'var(--accent-light)' },
]

const perPage = 8

export function dashboardHref(scope: DashboardScope, patch: Partial<DashboardScope> = {}) {
  const next = { ...scope, ...patch }
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.customer) params.set('customer', next.customer)
  if (next.vendor) params.set('vendor', next.vendor)
  if (next.contract) params.set('contract', next.contract)
  if (next.kind) params.set('kind', next.kind)
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return '/dashboard' + (query ? '?' + query : '')
}

function FilterInput({
  label,
  name,
  value,
  options,
}: {
  label: string
  name: string
  value: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--muted-strong)]">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-9 min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-sm text-[var(--foreground)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function FilterBar({ scope, options }: { scope: DashboardScope; options: InventoryFilterOptions }) {
  return (
    <form action="/dashboard" method="get" role="search" aria-label="Werkoverzicht filteren">
      <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(170px,1fr)_repeat(3,minmax(135px,0.8fr))_auto] xl:items-end">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--muted-strong)]">
          <span>Zoeken</span>
          <input
            name="q"
            type="search"
            defaultValue={scope.q}
            placeholder="Klant, device of model"
            className="h-9 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--foreground)]"
          />
        </label>
        <FilterInput
          name="customer"
          label="Klant"
          value={scope.customer}
          options={[{ value: '', label: 'Alle klanten' }, ...options.customers.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <FilterInput
          name="vendor"
          label="Vendor"
          value={scope.vendor}
          options={[{ value: '', label: 'Alle vendors' }, ...options.vendors.map((v) => ({ value: v.id, label: v.name }))]}
        />
        <FilterInput
          name="contract"
          label="Contract"
          value={scope.contract}
          options={[
            { value: '', label: 'Alle contracten' },
            { value: 'none', label: 'Geen contract' },
            ...options.contracts.map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
        <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-1">
          <button type="submit" className="h-9 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-contrast)]">
            Filter
          </button>
          <Link href="/dashboard" className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] px-3 text-sm hover:bg-[var(--surface-muted)]">
            Wissen
          </Link>
        </div>
      </div>
    </form>
  )
}

function KpiCards({ scope, packages }: { scope: DashboardScope; packages: ActionWorkPackage[] }) {
  const counts = countCandidateWorkPackages(packages)
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Werkpakketstatussen">
      {kinds.map((item) => {
        const selected = scope.kind === item.kind
        return (
          <Link
            key={item.kind}
            href={dashboardHref(scope, { kind: selected ? '' : item.kind, page: 1 })}
            aria-current={selected ? 'true' : undefined}
            className={[
              'group rounded-lg border bg-[var(--surface)] p-4 outline-none transition-colors hover:bg-[var(--surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              selected ? 'border-[var(--accent)]' : 'border-[var(--border)]',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-strong)]">{item.label}</span>
              <span className="text-sm text-[var(--muted)] group-hover:text-[var(--foreground)]" aria-hidden="true">↗</span>
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums" style={{ color: item.accent }}>{counts[item.kind]}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">{item.hint} · werkpakketten</div>
          </Link>
        )
      })}
    </div>
  )
}

const statusLabel: Record<WorkPackageKind, string> = {
  URGENT: 'Urgent',
  TO_PLAN: 'Plannen',
  BLOCKED: 'Wachten',
  CHECK: 'Controleren',
}

function WorkRows({ scope, packages }: { scope: DashboardScope; packages: ActionWorkPackage[] }) {
  const scoped = scope.kind ? packages.filter((item) => item.kind === scope.kind) : packages
  const pageCount = Math.max(1, Math.ceil(scoped.length / perPage))
  const page = Math.min(scope.page, pageCount)
  const rows = scoped.slice((page - 1) * perPage, page * perPage)

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold">Aanbevolen werkzaamheden</h2>
        <span className="text-xs tabular-nums text-[var(--muted)]">{scoped.length} werkpakketten</span>
      </div>
      {rows.length ? (
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((work) => (
            <li key={work.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      work.kind === 'URGENT' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' :
                      work.kind === 'TO_PLAN' ? 'bg-[var(--warning-soft)] text-[var(--warning)]' :
                      'bg-[var(--surface-raised)] text-[var(--muted-strong)]',
                    ].join(' ')}
                  >
                    {statusLabel[work.kind]}
                  </span>
                  <span className="truncate text-sm font-semibold" title={work.title}>{work.title}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--muted-strong)]">
                  {work.customer.name}{work.site ? ' · ' + work.site.name : ''} · {work.deviceCount} {work.deviceCount === 1 ? 'device' : 'devices'}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]" title={work.reason}>
                  {work.reason}
                </p>
              </div>
              <Link
                href={work.href}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-[var(--accent-muted)] px-3 text-xs font-semibold text-[var(--accent-light)] hover:bg-[var(--accent-soft)]"
              >
                {work.kind === 'BLOCKED' ? 'Open plan' : 'Bekijk devices'} →
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="p-5 text-sm text-[var(--muted)]">Geen werkzaamheden in deze selectie.</p>
      )}
      {pageCount > 1 ? (
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs">
          {page > 1 ? <Link href={dashboardHref(scope, { page: page - 1 })} className="text-[var(--accent-light)] hover:underline">← Vorige</Link> : <span />}
          <span className="tabular-nums text-[var(--muted)]">{page} / {pageCount}</span>
          {page < pageCount ? <Link href={dashboardHref(scope, { page: page + 1 })} className="text-[var(--accent-light)] hover:underline">Volgende →</Link> : <span />}
        </div>
      ) : null}
    </section>
  )
}

function DataQuality({ packages }: { packages: ActionWorkPackage[] }) {
  const blocked = packages.filter((item) => item.kind === 'BLOCKED')
  const missingContracts = packages.filter((item) => item.findingKey === 'MISSING_CONTRACT')
  const review = packages.filter((item) => item.kind === 'CHECK' && item.findingKey !== 'MISSING_CONTRACT')
  return (
    <aside className="space-y-3" aria-label="Blokkades en databetrouwbaarheid">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Blokkades</h2>
        <div className="space-y-2 px-4 py-3">
          {blocked.length ? (
            <>
              <p className="text-sm"><span className="font-bold tabular-nums">{blocked.length}</span> wachten op klantgoedkeuring</p>
              <Link href={dashboardHref({ q: '', customer: '', vendor: '', contract: '', kind: 'BLOCKED', page: 1 })} className="text-xs text-[var(--accent-light)] hover:underline">Bekijk blokkades →</Link>
            </>
          ) : <p className="text-sm text-[var(--muted)]">Geen wachtende goedkeuringen in deze selectie.</p>}
        </div>
      </section>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Databetrouwbaarheid</h2>
        <div className="space-y-2 px-4 py-3 text-sm">
          <p><span className="font-semibold tabular-nums">{missingContracts.length}</span> werkpakketten zonder beheercontract</p>
          <p><span className="font-semibold tabular-nums">{review.length}</span> firmware- of reviewcontroles</p>
          <p className="text-xs text-[var(--muted)]">HA-volledigheid en syncconflicten worden toegevoegd zodra de bronevidentie is aangesloten.</p>
        </div>
      </section>
    </aside>
  )
}

export function OperationalOverview({
  scope,
  filters,
  packages,
}: {
  scope: DashboardScope
  filters: InventoryFilterOptions
  packages: ActionWorkPackage[]
}) {
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Werkoverzicht</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {scope.customer ? 'Geselecteerde klant' : 'Alle klanten'} · {packages.length} werkpakketten in scope
          </p>
        </div>
        <Link href="/devices" className="text-xs font-semibold text-[var(--accent-light)] hover:underline">Inventory →</Link>
      </header>
      <FilterBar scope={scope} options={filters} />
      <KpiCards scope={scope} packages={packages} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <WorkRows scope={scope} packages={packages} />
        <DataQuality packages={packages} />
      </div>
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs">
        <span className="font-semibold">Weekvoortgang</span>
        <span className="text-[var(--muted)]">Beschikbaar zodra taak- en planningshistorie is gekoppeld.</span>
        <Link href="/planning" className="font-semibold text-[var(--accent-light)] hover:underline">Planning →</Link>
      </section>
    </div>
  )
}
