import Link from 'next/link'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/ui/filter-bar'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import { PrintInventoryReportButton } from './print-inventory-report-button'
import {
  INVENTORY_SOURCES,
  type InventoryFilterOptions,
  type InventoryQuery,
} from '@/lib/inventory-explorer'
import { INVENTORY_PRIMARY_STATUS_CODES } from '@/lib/inventory-status'
import type {
  InventoryReport,
  InventoryReportDistribution,
} from '@/lib/inventory-report'
import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'
import { inventoryHref } from '@/lib/inventory-explorer'
import { buildContractReportSections } from '@/lib/inventory-contract-report'
import { inventoryReportScopeDescription } from '@/lib/inventory-report-context'

function label(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLocaleLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function distributions(
  rows: InventoryReportDistribution[],
  empty: string,
) {
  if (!rows.length) return <p className="text-sm text-[var(--muted)]">{empty}</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
          <th scope="col" className="pb-2 text-left font-medium">Value</th>
          <th scope="col" className="pb-2 text-right font-medium">Devices</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-[var(--border)] last:border-0">
            <td className="py-2 font-medium">{row.label}</td>
            <td className="py-2 text-right tabular-nums">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DeviceTable({ devices }: { devices: InventoryExportRecord[] }) {
  return (
    <div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="w-full min-w-[850px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]">
            <th scope="col" className="px-3 py-2">Device</th>
            <th scope="col" className="px-3 py-2">Model</th>
            <th scope="col" className="px-3 py-2">Running firmware</th>
            <th scope="col" className="px-3 py-2">Preferred target</th>
            <th scope="col" className="px-3 py-2">Management contract</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {devices.map((device) => (
            <tr key={device.deviceId}>
              <td className="px-3 py-2">
                <span className="font-semibold">{device.name}</span>
                {device.serialNumber ? (
                  <span className="block text-[10px] text-[var(--muted)]">
                    S/N {device.serialNumber}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">{device.vendor} {device.model}</td>
              <td className="px-3 py-2 font-mono">
                {device.currentFirmware || 'Unknown'}
              </td>
              <td className="px-3 py-2 font-mono">
                {device.effectiveTarget || 'Unresolved'}
              </td>
              <td className="px-3 py-2">
                {device.contract || 'No contract'}
              </td>
              <td className="px-3 py-2">
                <span className="font-medium">{device.primaryStatus}</span>
                {device.statusReason ? (
                  <span className="block max-w-xs text-[10px] text-[var(--muted)]">
                    {device.statusReason}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function InventoryReportView({
  report,
  filters,
  query,
  firmware,
  generatedAt,
}: {
  report: InventoryReport
  filters: InventoryFilterOptions
  query: InventoryQuery
  firmware: string
  generatedAt: string
}) {
  const baseExport = inventoryHref('/api/v1/inventory/export', query)
  const extra = new URLSearchParams({ scope: 'all' })
  if (firmware) extra.set('firmware', firmware)
  const csvHref = baseExport + (baseExport.includes('?') ? '&' : '?') + extra.toString()

  const scopeDescription = inventoryReportScopeDescription(query, filters, firmware)
  const sections = buildContractReportSections(report.devices)
  const xlsxHref = inventoryHref('/api/v1/reports/inventory/xlsx', query) +
    (inventoryHref('/api/v1/reports/inventory/xlsx', query).includes('?') ? '&' : '?') +
    (firmware ? 'firmware=' + encodeURIComponent(firmware) : 'format=xlsx')

  const date = new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(new Date(generatedAt))

  return (
    <>
      <div className="inventory-report-screen-only">
        <PageHeader
          eyebrow="Reports / Live inventory"
          title="Inventory & firmware report"
          description="Generate a current, cross-customer inventory report with firmware distributions and effective internal management contracts. This is not a quarterly review snapshot."
          breadcrumbs={[
            { label: 'Reports', href: '/reports' },
            { label: 'Inventory report' },
          ]}
          actions={
            <>
              <Link
                href={csvHref}
                className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
              >
                Export matching CSV
              </Link>
              <Link
                href={xlsxHref}
                className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
              >
                Download Excel (.xlsx)
              </Link>
              <PrintInventoryReportButton />
            </>
          }
        />
        <form action="/reports/inventory" method="get" className="mb-6">
          {query.attention ? <input type="hidden" name="attention" value="1" /> : null}
          {query.flagged ? <input type="hidden" name="flagged" value="1" /> : null}
          <FilterBar
            label="Inventory report filters"
            summary={<span>Report scope: {scopeDescription}</span>}
            actions={
              <>
                <button
                  type="submit"
                  className="h-9 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-contrast)]"
                >
                  Generate report
                </button>
                <Link href="/reports/inventory" className="text-sm text-[var(--muted)] hover:underline">
                  Reset
                </Link>
              </>
            }
          >
            <FilterSearch id="report-q" name="q" label="Search" defaultValue={query.q} placeholder="Device, customer, site, serial..." />
            <FilterSelect id="report-vendor" name="vendor" label="Vendor" defaultValue={query.vendor} options={[
              { value: '', label: 'All vendors' },
              ...filters.vendors.map((item) => ({ value: item.id, label: item.name })),
            ]} />
            <FilterSelect id="report-device-type" name="deviceType" label="Device type" defaultValue={query.deviceType} options={[
              { value: '', label: 'All device types' },
              ...filters.deviceTypes.map((item) => ({ value: item.id, label: item.name })),
            ]} />
            <FilterSelect id="report-model" name="model" label="Model" defaultValue={query.model} options={[
              { value: '', label: 'All models' },
              ...filters.models.map((item) => ({ value: item.id, label: item.vendorName + ' · ' + item.model })),
            ]} />
            <FilterSelect id="report-contract" name="contract" label="Internal management contract" defaultValue={query.contract} options={[
              { value: '', label: 'All contracts' },
              { value: 'none', label: 'No management contract' },
              ...filters.contracts.map((item) => ({ value: item.id, label: item.name })),
            ]} />
            <FilterSearch id="report-firmware" name="firmware" label="Running firmware contains" defaultValue={firmware} placeholder="e.g. 7.4.6 or 7.2" />
            <FilterSelect id="report-status" name="status" label="Firmware status" defaultValue={query.status} options={[
              { value: '', label: 'All statuses' },
              ...INVENTORY_PRIMARY_STATUS_CODES.map((status) => ({ value: status, label: label(status) })),
            ]} />
            <FilterSelect id="report-source" name="source" label="Inventory source" defaultValue={query.source} options={[
              { value: '', label: 'All sources' },
              ...INVENTORY_SOURCES.map((source) => ({ value: source, label: label(source) })),
            ]} />
          </FilterBar>
        </form>
      </div>

      <article id="inventory-print-report" className="inventory-report-paper space-y-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-8">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            NOC Orchestrator · Inventory report
          </div>
          <h2 className="mt-2 text-2xl font-semibold">Firmware inventory overview</h2>
          <p className="mt-2 text-sm text-[var(--muted-strong)]">{scopeDescription}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Generated {date} · Live data at generation time · Not saved as a historical report
          </p>
        </header>

        <section aria-label="Report summary">
          <h3 className="mb-3 text-base font-semibold">Summary</h3>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <SummaryStat label="Devices" value={report.deviceCount} />
            <SummaryStat label="Customers" value={report.customerCount} />
            <SummaryStat label="Sites" value={report.siteCount} />
            <SummaryStat label="Firmware versions" value={report.firmwareDistribution.filter((entry) => entry.label !== 'Unknown').length} />
            <SummaryStat label="Unknown firmware" value={report.unknownFirmwareCount} />
            <SummaryStat label="No contract" value={report.missingContractCount} />
          </div>
        </section>

        <section aria-label="Report distributions" className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Firmware distribution</h3>
            {distributions(report.firmwareDistribution, 'No firmware versions match this scope.')}
          </div>
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Internal management contracts</h3>
            {distributions(report.contractDistribution, 'No contracts match this scope.')}
          </div>
          <div className="rounded-lg border border-[var(--border)] p-4">
            <h3 className="mb-3 text-sm font-semibold">Firmware status</h3>
            {distributions(report.statusDistribution, 'No firmware statuses match this scope.')}
          </div>
        </section>

        <section aria-label="Devices grouped by internal contract, customer and site">
          <h3 className="inventory-report-print-hide mb-4 text-lg font-semibold">Detailed inventory by contract, customer and site</h3>
          {sections.map((section) => (
            <section key={section.category} className="inventory-report-contract-section mb-8 space-y-4">
              <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-strong)] pb-2">
                <h3 className="text-xl font-semibold">{section.title}</h3>
                <span className="text-xs text-[var(--muted)]">{section.report.deviceCount} devices</span>
              </div>
              {section.report.customers.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No matching devices</p>
              ) : (
                <div className="space-y-7">
                  {section.report.customers.map((customer) => (
                    <section key={customer.id} className="inventory-report-customer space-y-3">
                      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-strong)] pb-2">
                        <h4 className="text-base font-semibold">{customer.name}</h4>
                        <span className="text-xs text-[var(--muted)]">
                          {customer.deviceCount} devices · {customer.sites.length} site groups
                        </span>
                      </div>
                      {customer.sites.map((site) => (
                        <section key={site.id ?? '__unassigned'} className="inventory-report-site space-y-2">
                          <div className="flex items-baseline justify-between gap-4">
                            <h5 className="text-sm font-semibold">{site.name}</h5>
                            <span className="text-xs text-[var(--muted)]">{site.devices.length} devices</span>
                          </div>
                          <DeviceTable devices={site.devices} />
                        </section>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </section>
          ))}
        </section>
        <footer className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          Source: canonical NOC Orchestrator inventory. Internal contracts reflect Site override, then Customer default.
          FortiCare/FMWR update entitlements and PSIRT vulnerability applicability are not yet verified in this report.
          Version text filtering alone does not establish that a device is affected by a CVE.
        </footer>
      </article>
    </>
  )
}
