import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { buildFirmwareCampaigns, type FirmwareCampaign } from '@/lib/dashboard-firmware-campaigns'
import { getDashboardWorkPackageFindings, getInventoryFilterOptions } from '@/lib/inventory-explorer-store'
import { parseInventoryQuery } from '@/lib/inventory-explorer'
import type { WorkPackageFinding } from '@/lib/dashboard-work-packages'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const maxPerPage = 50

export function campaignSubset(
  campaign: FirmwareCampaign,
  release: string,
  customer: string,
): WorkPackageFinding[] {
  return campaign.findings.filter((item) =>
    (!release || (item.currentFirmwareVersion ?? 'Onbekend') === release) &&
    (!customer || item.customer.id === customer),
  )
}

function detailHref(id: string, scope: { release: string; customer: string; page: number }, patch: Partial<typeof scope>) {
  const next = { ...scope, ...patch }
  const params = new URLSearchParams()
  if (next.release) params.set('release', next.release)
  if (next.customer) params.set('customer', next.customer)
  if (next.page > 1) params.set('page', String(next.page))
  const query = params.toString()
  return '/dashboard/campaigns/' + encodeURIComponent(id) + (query ? '?' + query : '')
}

export default async function CampaignDetailPage({ params, searchParams }: PageProps) {
  // Cohort details include private multi-customer device identities.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) notFound()

  const [{ id }, supplied] = await Promise.all([params, searchParams])
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(supplied)) {
    if (typeof value === 'string') search.set(key, value)
  }
  const query = parseInventoryQuery(search)
  const [findings, options] = await Promise.all([
    getDashboardWorkPackageFindings(query),
    getInventoryFilterOptions(),
  ])
  const campaign = buildFirmwareCampaigns(findings).find((value) => value.id === id)
  if (!campaign) notFound()

  const release = (search.get('release') ?? '').slice(0, 100)
  const customer = (search.get('customer') ?? '').slice(0, 100)
  const page = Math.max(1, Number.parseInt(search.get('page') ?? '1', 10) || 1)
  const scope = { release, customer, page }
  const all = campaignSubset(campaign, release, customer)
  const totalPages = Math.max(1, Math.ceil(all.length / maxPerPage))
  const selectedPage = Math.min(page, totalPages)
  const devices = all.slice((selectedPage - 1) * maxPerPage, selectedPage * maxPerPage)
  const customers = Array.from(new Map(campaign.findings.map((item) =>
    [item.customer.id, item.customer])).values()).sort((a, b) => a.name.localeCompare(b.name))
  const reportParams = new URLSearchParams()
  if (release) reportParams.set('release', release)
  if (customer) reportParams.set('customer', customer)
  // Export is evaluated against EXACT campaign membership, not an approximate inventory filter.
  const exportHref = '/dashboard/campaigns/' + encodeURIComponent(id) + '/export' +
    (reportParams.size ? '?' + reportParams : '')
  const contractName = new Map(options.contracts.map((item) => [item.id, item.name]))

  return (
    <div className="space-y-4">
      <nav className="text-xs">
        <Link href="/dashboard" className="text-[var(--accent-light)] hover:underline">← Werkoverzicht</Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {campaign.vendor.name} {campaign.platform} · {campaign.sourceTrain}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">
            {campaign.targetVersion ? 'Doel volgens firmwarebeleid: ' + campaign.targetVersion : 'Doelrelease nog niet vastgesteld'}
          </p>
        </div>
        <Link href={exportHref}
          className="inline-flex h-9 items-center rounded-md border border-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-light)] hover:bg-[var(--accent-soft)]">
          Exporteer selectie (CSV) ↗
        </Link>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-xs text-[var(--muted)]">Nog aandacht nodig</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{campaign.deviceCount} <span className="text-sm font-normal">devices</span></p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-xs text-[var(--muted)]">Klanten getroffen</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{campaign.customerCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-xs text-[var(--muted)]">Wacht op klantakkoord</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{campaign.awaitingCustomerCount} <span className="text-sm font-normal">devices</span></p>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">Huidige releases · oudste eerst waar vergelijkbaar</h2>
        <div className="flex flex-wrap gap-2 p-3">
          {campaign.releases.map((item) => (
            <Link
              key={item.version}
              href={detailHref(id, scope, { release: scope.release === item.version ? '' : item.version, page: 1 })}
              className={[
                'rounded-md border px-3 py-2 text-sm transition-colors',
                release === item.version
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:bg-[var(--surface-raised)]',
              ].join(' ')}
            >
              <span className="font-semibold">{item.version}</span>
              <span className="ml-2 tabular-nums text-[var(--muted-strong)]">{item.deviceCount} devices</span>
              <span className="ml-2 text-xs text-[var(--muted)]">{item.customerCount} klanten</span>
              {item.criticalCount ? <span className="ml-2 text-xs text-[var(--danger)]">Kritiek {item.criticalCount}</span> : null}
            </Link>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Getroffen apparaten · {all.length}</h2>
          <form method="get" className="flex items-center gap-2">
            {release ? <input type="hidden" name="release" value={release} /> : null}
            <label htmlFor="campaign-customer" className="sr-only">Klant filteren</label>
            <select
              id="campaign-customer"
              name="customer"
              defaultValue={customer}
              className="h-9 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-xs"
            >
              <option value="">Alle klanten</option>
              {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="submit" className="h-9 rounded-md border border-[var(--accent)] px-3 text-xs text-[var(--accent-light)]">Filter</button>
          </form>
        </div>
        {devices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--surface-raised)] text-[var(--muted-strong)]">
                <tr>
                  {['Klant / site', 'Apparaat', 'Huidig', 'Doel', 'Beheercontract', 'Workflow', ''].map((label) => (
                    <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {devices.map((device) => (
                  <tr key={device.deviceId}>
                    <td className="px-3 py-2">{device.customer.name}<span className="block text-[var(--muted)]">{device.site?.name ?? 'Geen site'}</span></td>
                    <td className="px-3 py-2 font-semibold">{device.deviceName ?? device.deviceId}<span className="block text-[var(--muted)]">{device.model.name}</span></td>
                    <td className="px-3 py-2">{device.currentFirmwareVersion ?? 'Onbekend'}</td>
                    <td className="px-3 py-2">{device.targetVersion ?? 'Onbekend'}</td>
                    <td className="px-3 py-2">{device.managementContractId ? contractName.get(device.managementContractId) ?? 'Onbekend' : 'Geen contract'}</td>
                    <td className="px-3 py-2">{device.plan?.state ?? device.workflowState ?? 'Nog niet gepland'}</td>
                    <td className="px-3 py-2"><Link href={'/devices/' + encodeURIComponent(device.deviceId)} className="whitespace-nowrap text-[var(--accent-light)] hover:underline">Details →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="p-4 text-sm text-[var(--muted)]">Geen apparaten in deze selectie.</p>}
        {totalPages > 1 ? (
          <nav className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3 text-xs" aria-label="Apparaten pagineren">
            {selectedPage > 1 ? <Link href={detailHref(id, scope, { page: selectedPage - 1 })} className="text-[var(--accent-light)]">← Vorige</Link> : <span />}
            <span>{selectedPage} / {totalPages}</span>
            {selectedPage < totalPages ? <Link href={detailHref(id, scope, { page: selectedPage + 1 })} className="text-[var(--accent-light)]">Volgende →</Link> : <span />}
          </nav>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Plan updates per klant</h2>
          <p className="text-xs text-[var(--muted)]">Planning en klantgoedkeuring blijven klant- en sitegebonden.</p>
        </div>
        <Link href="/planning" className="text-sm font-semibold text-[var(--accent-light)] hover:underline">
          Open onderhoudsplanning →
        </Link>
      </section>
    </div>
  )
}
