'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { InventoryReportCustomer } from '@/lib/inventory-report'
import type { InventoryQuery } from '@/lib/inventory-explorer'
import { inventoryReportHref } from '@/lib/inventory-report-context'

function clickableClass(active = false) {
  return [
    'rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)] hover:underline',
    active ? 'bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'text-[var(--foreground)]',
  ].join(' ')
}

function statusClass(code?: string) {
  if (code === 'CRITICAL_ATTENTION') return 'text-[var(--danger)]'
  if (code === 'UPDATE_REQUIRED') return 'text-[var(--required)]'
  if (code === 'REVIEW_REQUIRED') return 'text-[var(--warning)]'
  if (code === 'UPDATE_RECOMMENDED') return 'text-[var(--recommended)]'
  if (code === 'CURRENT') return 'text-[var(--success)]'
  return 'text-[var(--muted-strong)]'
}


function distribution(values: string[], fallback: string) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = value.trim() || fallback
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

const attentionCodes = new Set([
  'CRITICAL_ATTENTION',
  'UPDATE_REQUIRED',
  'REVIEW_REQUIRED',
  'UPDATE_RECOMMENDED',
  'UNKNOWN',
])

export function InventoryReportCustomerTable({
  customer,
  query,
  firmware,
  defaultOpen = true,
}: {
  customer: InventoryReportCustomer
  query: InventoryQuery
  firmware: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [openSites, setOpenSites] = useState<Set<string>>(() => new Set())

  const allDevices = useMemo(
    () => customer.sites.flatMap((site) => site.devices),
    [customer.sites],
  )
  const exceptionCount = allDevices.filter(
    (device) => device.exceptionState !== 'NONE',
  ).length

  function toggleSite(siteKey: string) {
    setOpenSites((current) => {
      const next = new Set(current)
      if (next.has(siteKey)) next.delete(siteKey)
      else next.add(siteKey)
      return next
    })
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex h-7 w-7 items-center justify-center rounded text-sm text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          aria-expanded={open}
          aria-label={(open ? 'Collapse ' : 'Expand ') + customer.name}
        >
          {open ? '⌄' : '›'}
        </button>
        <Link
          href={inventoryReportHref(query, firmware, {
            customer: customer.id,
            site: '',
          })}
          className="text-sm font-semibold hover:text-[var(--accent-light)] hover:underline"
          title="Filter this report to this customer"
        >
          {customer.name}
        </Link>
        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--muted-strong)]">
          {customer.deviceCount} devices
        </span>
        <span className="text-xs text-[var(--muted)]">
          {customer.sites.length} site{customer.sites.length === 1 ? '' : 's'}
        </span>
        {exceptionCount > 0 ? (
          <span className="ml-auto rounded-full border border-[var(--warning-border)] bg-[var(--warning-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">
            {exceptionCount} exception{exceptionCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="noc-scrollbar overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                <th scope="col" className="px-3 py-2 font-medium">Device</th>
                <th scope="col" className="px-3 py-2 font-medium">Site</th>
                <th scope="col" className="px-3 py-2 font-medium">Model</th>
                <th scope="col" className="px-3 py-2 font-medium">Running firmware</th>
                <th scope="col" className="px-3 py-2 font-medium">Preferred target</th>
                <th scope="col" className="px-3 py-2 font-medium">Contract</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Exception</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            {customer.sites.map((site) => {
              const siteKey = site.id ?? '__unassigned'
              const siteOpen = openSites.has(siteKey)
              const firmwareSummary = distribution(
                site.devices.map((device) => device.currentFirmware),
                'Unknown',
              )
              const targetSummary = distribution(
                site.devices.map((device) => device.effectiveTarget),
                'Unresolved',
              )
              const modelCount = new Set(site.devices.map((device) => device.modelId ?? device.model)).size
              const contracts = new Map(
                site.devices.map((device) => [
                  device.contractId ?? 'none',
                  device.contract || 'No contract',
                ]),
              )
              const attentionCount = site.devices.filter(
                (device) => device.primaryStatusCode && attentionCodes.has(device.primaryStatusCode),
              ).length
              const siteExceptionCount = site.devices.filter(
                (device) => device.exceptionState !== 'NONE',
              ).length
              return (
                <tbody key={siteKey} className="border-b border-[var(--border)] last:border-0">
                  <tr className="bg-[var(--background)]">
                    <td className="px-3 py-2 font-semibold text-[var(--muted-strong)]">
                      <button
                        type="button"
                        onClick={() => toggleSite(siteKey)}
                        className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--surface-muted)]"
                        aria-expanded={siteOpen}
                        aria-label={(siteOpen ? 'Collapse ' : 'Expand ') + site.name}
                      >
                        {siteOpen ? '⌄' : '›'}
                      </button>
                      {site.devices.length} devices
                    </td>
                    <td className="px-3 py-2">
                      {site.id ? (
                        <Link
                          href={inventoryReportHref(query, firmware, {
                            customer: customer.id,
                            site: site.id,
                          })}
                          className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)] hover:underline"
                          title="Filter this report to this site"
                        >
                          {site.name}
                        </Link>
                      ) : (
                        <span className="font-semibold">{site.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted-strong)]">
                      {modelCount} model{modelCount === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <div className="flex flex-wrap gap-1">
                        {firmwareSummary.slice(0, 2).map((entry) =>
                          entry.label === 'Unknown' ? (
                            <span key={entry.label} className="text-[var(--muted)]">
                              Unknown ({entry.count})
                            </span>
                          ) : (
                            <Link
                              key={entry.label}
                              href={inventoryReportHref(query, firmware, {}, entry.label)}
                              className="hover:text-[var(--accent-light)] hover:underline"
                            >
                              {entry.label} ({entry.count})
                            </Link>
                          ),
                        )}
                        {firmwareSummary.length > 2 ? (
                          <span className="text-[var(--muted)]">+{firmwareSummary.length - 2}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--muted-strong)]">
                      {targetSummary.slice(0, 2).map((entry) => entry.label + ' (' + entry.count + ')').join(' · ')}
                      {targetSummary.length > 2 ? ' · +' + (targetSummary.length - 2) : ''}
                    </td>
                    <td className="px-3 py-2">
                      {contracts.size === 1 ? (
                        <Link
                          href={inventoryReportHref(query, firmware, {
                            contract: [...contracts.keys()][0],
                          })}
                          className="font-semibold hover:text-[var(--accent-light)] hover:underline"
                        >
                          {[...contracts.values()][0]}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted-strong)]">Mixed ({contracts.size})</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {attentionCount > 0 ? (
                        site.id ? (
                          <Link
                            href={inventoryReportHref(query, firmware, {
                              customer: customer.id,
                              site: site.id,
                              attention: true,
                            })}
                            className="font-semibold text-[var(--warning)] hover:underline"
                          >
                            {attentionCount} attention
                          </Link>
                        ) : (
                          <span className="font-semibold text-[var(--warning)]">
                            {attentionCount} attention
                          </span>
                        )
                      ) : (
                        <span className="font-semibold text-[var(--success)]">Current</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {siteExceptionCount > 0 ? (
                        <span className="font-semibold text-[var(--warning)]">{siteExceptionCount}</span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {site.id ? (
                        <Link
                          href={'/devices/customers/' + customer.id + '/sites/' + site.id}
                          className="font-semibold text-[var(--accent)] hover:underline"
                        >
                          Inventory
                        </Link>
                      ) : null}
                    </td>
                  </tr>

                  {siteOpen
                    ? site.devices.map((device) => (
                        <tr key={device.deviceId} className="border-t border-[var(--border)] hover:bg-[var(--surface-muted)]">
                          <td className="px-3 py-2">
                            <Link
                              href={'/devices/' + device.deviceId}
                              className="font-semibold hover:text-[var(--accent-light)] hover:underline"
                            >
                              {device.name}
                            </Link>
                            {device.serialNumber ? (
                              <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                                S/N {device.serialNumber}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {site.id ? (
                              <Link
                                href={inventoryReportHref(query, firmware, {
                                  customer: customer.id,
                                  site: site.id,
                                })}
                                className={clickableClass(query.site === site.id)}
                              >
                                {site.name}
                              </Link>
                            ) : site.name}
                          </td>
                          <td className="px-3 py-2">
                            {device.modelId ? (
                              <Link
                                href={inventoryReportHref(query, firmware, {
                                  model: device.modelId,
                                })}
                                className={clickableClass(query.model === device.modelId)}
                                title="Filter to this model"
                              >
                                {device.vendor} {device.model}
                              </Link>
                            ) : (
                              <span>{device.vendor} {device.model}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {device.currentFirmware ? (
                              <Link
                                href={inventoryReportHref(
                                  query,
                                  firmware,
                                  {},
                                  device.currentFirmware,
                                )}
                                className={clickableClass(firmware === device.currentFirmware)}
                                title="Filter to this running firmware"
                              >
                                {device.currentFirmware}
                              </Link>
                            ) : (
                              <span className="text-[var(--muted)]">Unknown</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {device.effectiveTarget || 'Unresolved'}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={inventoryReportHref(query, firmware, {
                                contract: device.contractId ?? 'none',
                              })}
                              className={clickableClass(
                                query.contract === (device.contractId ?? 'none'),
                              )}
                              title="Filter to this contract"
                            >
                              {device.contract || 'No contract'}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            {device.primaryStatusCode ? (
                              <Link
                                href={inventoryReportHref(query, firmware, {
                                  status: device.primaryStatusCode,
                                })}
                                className={
                                  clickableClass(query.status === device.primaryStatusCode) +
                                  ' font-semibold ' +
                                  statusClass(device.primaryStatusCode)
                                }
                                title="Filter to this firmware status"
                              >
                                {device.primaryStatus}
                              </Link>
                            ) : (
                              <span className="font-semibold">{device.primaryStatus}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {device.exceptionState === 'NONE' ? (
                              <span className="text-[var(--muted)]">—</span>
                            ) : (
                              <span
                                className="font-semibold text-[var(--warning)]"
                                title={device.exceptionReason || device.exceptionState}
                              >
                                {device.exceptionState === 'ACTIVE' ? 'Active' : device.exceptionState}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              href={'/devices/' + device.deviceId}
                              className="font-semibold text-[var(--accent)] hover:underline"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              )
            })}
          </table>
        </div>
      ) : null}
    </section>
  )
}
