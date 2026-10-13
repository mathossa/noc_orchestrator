import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { PrintInventoryReportButton } from './print-inventory-report-button'
import { InventoryReportLiveFilters } from './inventory-report-live-filters'
import { InventoryReportCustomerTable } from './inventory-report-customer-table'
import type {
  InventoryFilterOptions,
  InventoryQuery,
} from '@/lib/inventory-explorer'
import type { InventoryReport } from '@/lib/inventory-report'
import type { InventoryExportRecord } from '@/lib/inventory-explorer-store'
import { inventoryHref } from '@/lib/inventory-explorer'
import { buildContractReportSections } from '@/lib/inventory-contract-report'
import {
  inventoryReportHref,
  inventoryReportScopeDescription,
} from '@/lib/inventory-report-context'

function MetricCard({
  label,
  value,
  detail,
  href,
  active = false,
}: {
  label: string
  value: number
  detail?: string
  href?: string
  active?: boolean
}) {
  const body = (
    <>
      <div className="text-xs font-semibold text-[var(--muted-strong)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--foreground)]">{value}</div>
      {detail ? <div className="mt-1 text-[11px] text-[var(--muted)]">{detail}</div> : null}
    </>
  )
  const className = [
    'min-w-0 rounded-lg border p-3 transition-colors',
    active
      ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)]'
      : 'border-[var(--border)] bg-[var(--surface)]',
    href ? 'hover:border-[var(--accent-muted)] hover:bg-[var(--surface-raised)]' : '',
  ].join(' ')

  return href ? (
    <Link href={href} className={className}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

function PrintDeviceTable({ devices }: { devices: InventoryExportRecord[] }) {
  return (
    <div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="w-full min-w-[900px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[var(--muted)]">
            <th scope="col" className="px-3 py-2">Device</th>
            <th scope="col" className="px-3 py-2">Site</th>
            <th scope="col" className="px-3 py-2">Model</th>
            <th scope="col" className="px-3 py-2">Running firmware</th>
            <th scope="col" className="px-3 py-2">Preferred target</th>
            <th scope="col" className="px-3 py-2">Contract</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {devices.map((device) => (
            <tr key={device.deviceId}>
              <td className="px-3 py-2">
                <span className="font-semibold">{device.name}</span>
                {device.serialNumber ? (
                  <span className="block text-[10px] text-[var(--muted)]">S/N {device.serialNumber}</span>
                ) : null}
              </td>
              <td className="px-3 py-2">{device.site}</td>
              <td className="px-3 py-2">{device.vendor} {device.model}</td>
              <td className="px-3 py-2 font-mono">{device.currentFirmware || 'Unknown'}</td>
              <td className="px-3 py-2 font-mono">{device.effectiveTarget || 'Unresolved'}</td>
              <td className="px-3 py-2">{device.contract || 'No contract'}</td>
              <td className="px-3 py-2">{device.primaryStatus}</td>
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
  const printSections = buildContractReportSections(report.devices, filters.contracts)
  const xlsxBase = inventoryHref('/api/v1/reports/inventory/xlsx', query)
  const xlsxHref = firmware
    ? xlsxBase + (xlsxBase.includes('?') ? '&' : '?') + 'firmware=' + encodeURIComponent(firmware)
    : xlsxBase

  const date = new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(new Date(generatedAt))

  const reportContracts = filters.contracts.filter((contract) => contract.showInReport)
  const statusFilters = new Map<string, string>()
  for (const device of report.devices) {
    if (device.primaryStatusCode) statusFilters.set(device.primaryStatusCode, device.primaryStatus)
  }

  return (
    <>
      <div className="inventory-report-screen-only">
        <PageHeader
          eyebrow="Reports / Live inventory"
          title="Inventory report"
          description="Live view across customers and sites. Filters apply immediately; click values in the overview to narrow the report."
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
                Export CSV
              </Link>
              <Link
                href={xlsxHref}
                className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)]"
              >
                Download Excel (.xlsx)
              </Link>
              <PrintInventoryReportButton />
            </>
          }
        />

        <InventoryReportLiveFilters
          query={query}
          filters={filters}
          firmware={firmware}
          deviceCount={report.deviceCount}
        />

        <section aria-label="Inventory report summary" className="mb-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
            <MetricCard label="Devices" value={report.deviceCount} detail="Current matching scope" />
            <MetricCard label="Customers" value={report.customerCount} />
            <MetricCard label="Sites" value={report.siteCount} />
            {reportContracts.map((contract) => {
              const count = report.devices.filter(
                (device) => device.contractId === contract.id,
              ).length
              return (
                <MetricCard
                  key={contract.id}
                  label={contract.name}
                  value={count}
                  detail="Click to filter"
                  active={query.contract === contract.id}
                  href={inventoryReportHref(query, firmware, { contract: contract.id })}
                />
              )
            })}
            <MetricCard
              label="No contract"
              value={report.missingContractCount}
              detail="Click to filter"
              active={query.contract === 'none'}
              href={inventoryReportHref(query, firmware, { contract: 'none' })}
            />
          </div>
        </section>

        {(report.firmwareDistribution.length > 0 || statusFilters.size > 0) ? (
          <section className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
            <span className="font-semibold text-[var(--muted-strong)]">Quick filters</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--muted)]">Firmware:</span>
              {report.firmwareDistribution
                .filter((entry) => entry.label !== 'Unknown')
                .slice(0, 6)
                .map((entry) => (
                  <Link
                    key={entry.label}
                    href={inventoryReportHref(query, firmware, {}, entry.label)}
                    className={
                      'rounded-full border px-2 py-0.5 font-mono hover:border-[var(--accent-muted)] hover:bg-[var(--accent-soft)] ' +
                      (firmware === entry.label
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
                        : 'border-[var(--border)] text-[var(--muted-strong)]')
                    }
                  >
                    {entry.label} ({entry.count})
                  </Link>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--muted)]">Status:</span>
              {[...statusFilters.entries()].map(([code, label]) => {
                const count = report.devices.filter(
                  (device) => device.primaryStatusCode === code,
                ).length
                return (
                  <Link
                    key={code}
                    href={inventoryReportHref(query, firmware, {
                      status: code as InventoryQuery['status'],
                    })}
                    className={
                      'rounded-full border px-2 py-0.5 hover:border-[var(--accent-muted)] hover:bg-[var(--accent-soft)] ' +
                      (query.status === code
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
                        : 'border-[var(--border)] text-[var(--muted-strong)]')
                    }
                  >
                    {label} ({count})
                  </Link>
                )
              })}
            </div>
          </section>
        ) : null}

        <section aria-label="Inventory by customer" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Customers & sites</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Customers and sites are collapsible. Expand a site only when you need the device rows.
              </p>
            </div>
            <span className="text-xs text-[var(--muted)]">{scopeDescription}</span>
          </div>

          {report.customers.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
              No devices match the current filters.
            </div>
          ) : (
            report.customers.map((customer) => (
              <InventoryReportCustomerTable
                key={customer.id}
                customer={customer}
                query={query}
                firmware={firmware}
              />
            ))
          )}
        </section>
      </div>

      <article
        id="inventory-print-report"
        className="inventory-report-print-only space-y-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-8"
      >
        <header className="border-b border-[var(--border)] pb-5">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            NOC Orchestrator · Inventory report
          </div>
          <h2 className="mt-2 text-2xl font-semibold">Firmware inventory overview</h2>
          <p className="mt-2 text-sm text-[var(--muted-strong)]">{scopeDescription}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Generated {date} · Live data at generation time
          </p>
        </header>

        {printSections.map((section) => (
          <section key={section.key} className="inventory-report-contract-section mb-8 space-y-4">
            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-strong)] pb-2">
              <h3 className="text-xl font-semibold">{section.title}</h3>
              <span className="text-xs text-[var(--muted)]">{section.report.deviceCount} devices</span>
            </div>
            {section.report.customers.map((customer) => (
              <section key={customer.id} className="inventory-report-customer space-y-3">
                <h4 className="text-base font-semibold">{customer.name}</h4>
                <PrintDeviceTable
                  devices={customer.sites.flatMap((site) => site.devices)}
                />
              </section>
            ))}
          </section>
        ))}

        <footer className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          Source: canonical NOC Orchestrator inventory. Internal contracts reflect Site override, then Customer default.
          FortiCare/FMWR update entitlements and PSIRT vulnerability applicability are not yet verified in this report.
        </footer>
      </article>
    </>
  )
}
