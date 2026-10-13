'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  INVENTORY_SOURCES,
  type InventoryFilterOptions,
  type InventoryQuery,
} from '@/lib/inventory-explorer'
import { INVENTORY_PRIMARY_STATUS_CODES } from '@/lib/inventory-status'

const controlClass =
  'h-9 w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] transition-colors hover:border-[var(--muted)] focus:border-[var(--accent)]'

function fieldLabel(text: string) {
  return <span className="mb-1.5 block text-xs font-semibold text-[var(--muted-strong)]">{text}</span>
}

function readableStatus(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function InventoryReportLiveFilters({
  query,
  filters,
  firmware,
  deviceCount,
}: {
  query: InventoryQuery
  filters: InventoryFilterOptions
  firmware: string
  deviceCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState(query.q)
  const [runningFirmware, setRunningFirmware] = useState(firmware)

  function replace(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    const serialized = params.toString()
    const href = serialized ? pathname + '?' + serialized : pathname
    startTransition(() => router.replace(href, { scroll: false }))
  }

  useEffect(() => {
    if (search === query.q) return
    const timer = window.setTimeout(() => replace({ q: search || null }), 300)
    return () => window.clearTimeout(timer)
    // replace is intentionally URL-state based; only debounce the controlled field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query.q])

  useEffect(() => {
    if (runningFirmware === firmware) return
    const timer = window.setTimeout(
      () => replace({ firmware: runningFirmware || null }),
      300,
    )
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningFirmware, firmware])

  const visibleSites = useMemo(
    () =>
      query.customer
        ? filters.sites.filter((site) => site.customerId === query.customer)
        : filters.sites,
    [filters.sites, query.customer],
  )

  return (
    <section
      className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
      aria-label="Live inventory report filters"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label htmlFor="report-q" className="min-w-0 flex-1">
            {fieldLabel('Search')}
            <input
              id="report-q"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Device, customer, site, serial, model..."
              className={controlClass}
            />
          </label>
          <div className="flex min-h-9 shrink-0 items-center gap-3 text-xs text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">{deviceCount} devices</span>
            <span>{isPending ? 'Updating…' : 'Live filters'}</span>
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setRunningFirmware('')
                startTransition(() => router.replace(pathname, { scroll: false }))
              }}
              className="font-semibold text-[var(--accent)] hover:underline"
            >
              Clear all
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-9">
          <label>
            {fieldLabel('Customer')}
            <select
              className={controlClass}
              value={query.customer}
              onChange={(event) =>
                replace({
                  customer: event.target.value || null,
                  site: null,
                })
              }
            >
              <option value="">All customers</option>
              {filters.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Site')}
            <select
              className={controlClass}
              value={query.site}
              onChange={(event) => replace({ site: event.target.value || null })}
            >
              <option value="">All sites</option>
              {visibleSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {query.customer ? site.name : site.customerName + ' · ' + site.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Vendor')}
            <select
              className={controlClass}
              value={query.vendor}
              onChange={(event) => replace({ vendor: event.target.value || null })}
            >
              <option value="">All vendors</option>
              {filters.vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Device type')}
            <select
              className={controlClass}
              value={query.deviceType}
              onChange={(event) => replace({ deviceType: event.target.value || null })}
            >
              <option value="">All device types</option>
              {filters.deviceTypes.map((deviceType) => (
                <option key={deviceType.id} value={deviceType.id}>{deviceType.name}</option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Model')}
            <select
              className={controlClass}
              value={query.model}
              onChange={(event) => replace({ model: event.target.value || null })}
            >
              <option value="">All models</option>
              {filters.models.map((model) => (
                <option key={model.id} value={model.id}>{model.vendorName} · {model.model}</option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Running firmware')}
            <input
              type="search"
              value={runningFirmware}
              onChange={(event) => setRunningFirmware(event.target.value)}
              placeholder="e.g. 7.4"
              className={controlClass}
            />
          </label>

          <label>
            {fieldLabel('Contract type')}
            <select
              className={controlClass}
              value={query.contract}
              onChange={(event) => replace({ contract: event.target.value || null })}
            >
              <option value="">All contracts</option>
              <option value="none">No management contract</option>
              {filters.contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>{contract.name}</option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Firmware status')}
            <select
              className={controlClass}
              value={query.status}
              onChange={(event) => replace({ status: event.target.value || null })}
            >
              <option value="">All statuses</option>
              {INVENTORY_PRIMARY_STATUS_CODES.map((status) => (
                <option key={status} value={status}>{readableStatus(status)}</option>
              ))}
            </select>
          </label>

          <label>
            {fieldLabel('Inventory source')}
            <select
              className={controlClass}
              value={query.source}
              onChange={(event) => replace({ source: event.target.value || null })}
            >
              <option value="">All sources</option>
              {INVENTORY_SOURCES.map((source) => (
                <option key={source} value={source}>{readableStatus(source)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </section>
  )
}
