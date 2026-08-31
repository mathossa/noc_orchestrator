'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { DeviceQueryMeta } from '@/lib/device-query'

type ParamName =
  | 'q' | 'customer' | 'site' | 'vendor' | 'model' | 'deviceType' | 'contract'
  | 'currentFirmware' | 'desiredFirmware' | 'technicalState' | 'workflow' | 'source'
  | 'archive' | 'groupBy' | 'sort' | 'direction' | 'pageSize' | 'page'

export function DeviceFilterBar({ meta }: { meta: DeviceQueryMeta }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = meta.query

  function replace(params: URLSearchParams) {
    const serialized = params.toString()
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false })
  }

  function setParam(name: ParamName, value: string, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(name, value)
    else params.delete(name)
    if (resetPage && name !== 'page') params.delete('page')
    replace(params)
  }

  function setCustomer(customerId: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (customerId) params.set('customer', customerId)
    else params.delete('customer')
    if (query.site && query.site !== 'none' && !meta.sites.some((site) => site.id === query.site && (!customerId || site.customerId === customerId))) {
      params.delete('site')
    }
    params.delete('page')
    replace(params)
  }

  function clearAll() {
    replace(new URLSearchParams())
  }

  const sites = meta.sites.filter((site) => !query.customer || site.customerId === query.customer)
  const vendorById = new Map(meta.vendors.map((vendor) => [vendor.id, vendor.name]))

  const chips: Array<{ key: ParamName; label: string; value: string }> = []
  const addChip = (key: ParamName, label: string, value: string) => { if (value) chips.push({ key, label, value }) }
  addChip('q', 'Search', query.q)
  addChip('customer', 'Customer', meta.customers.find((item) => item.id === query.customer)?.name ?? query.customer)
  addChip('site', 'Site', query.site === 'none' ? 'Unassigned' : (meta.sites.find((item) => item.id === query.site)?.name ?? query.site))
  addChip('vendor', 'Vendor', meta.vendors.find((item) => item.id === query.vendor)?.name ?? query.vendor)
  addChip('model', 'Model', meta.models.find((item) => item.id === query.model)?.model ?? query.model)
  addChip('deviceType', 'Type', meta.deviceTypes.find((item) => item.id === query.deviceType)?.name ?? query.deviceType)
  addChip('contract', 'Contract', query.contract === 'none' ? 'No effective contract' : (meta.contractTypes.find((item) => item.id === query.contract)?.name ?? query.contract))
  addChip('currentFirmware', 'Current', query.currentFirmware === 'none' ? 'Unknown' : (meta.firmwareReleases.find((item) => item.id === query.currentFirmware)?.version ?? query.currentFirmware))
  addChip('desiredFirmware', 'Desired', query.desiredFirmware === 'none' ? 'No policy' : (meta.firmwareReleases.find((item) => item.id === query.desiredFirmware)?.version ?? query.desiredFirmware))
  addChip('technicalState', 'Technical', query.technicalState.replaceAll('_', ' '))
  addChip('workflow', 'Workflow', query.workflow.replaceAll('_', ' '))
  addChip('source', 'Source', query.source)
  if (query.archive !== 'active') addChip('archive', 'Records', query.archive)
  if (query.groupBy !== 'none') addChip('groupBy', 'Group', query.groupBy)

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
        <TextInput
          type="search"
          aria-label="Search devices"
          placeholder="Search inventory…"
          value={query.q}
          onChange={(event) => setParam('q', event.target.value)}
        />
        <SelectInput aria-label="Filter devices by customer" value={query.customer} onChange={(event) => setCustomer(event.target.value)}>
          <option value="">All customers</option>
          {meta.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </SelectInput>
        <SelectInput aria-label="Filter devices by site" value={query.site} onChange={(event) => setParam('site', event.target.value)}>
          <option value="">All sites</option>
          <option value="none">Unassigned site</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </SelectInput>
        <SelectInput aria-label="Filter devices by vendor" value={query.vendor} onChange={(event) => setParam('vendor', event.target.value)}>
          <option value="">All vendors</option>
          {meta.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
        </SelectInput>
        <SelectInput aria-label="Filter devices by model" value={query.model} onChange={(event) => setParam('model', event.target.value)}>
          <option value="">All models</option>
          {meta.models.map((model) => <option key={model.id} value={model.id}>{model.vendor.name} · {model.model}</option>)}
        </SelectInput>
        <SelectInput aria-label="Group devices" value={query.groupBy} onChange={(event) => setParam('groupBy', event.target.value)}>
          <option value="none">No grouping</option>
          <option value="customer">Group by customer</option>
          <option value="site">Group by site</option>
          <option value="deviceType">Group by device type</option>
          <option value="model">Group by model</option>
        </SelectInput>
      </div>

      <details className="border-t border-[var(--border)] px-4 py-3" open={Boolean(query.deviceType || query.contract || query.currentFirmware || query.desiredFirmware || query.technicalState || query.workflow || query.source || query.archive !== 'active')}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-strong)]">More filters and sorting</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectInput aria-label="Filter devices by device type" value={query.deviceType} onChange={(event) => setParam('deviceType', event.target.value)}><option value="">All device types</option>{meta.deviceTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by effective contract" value={query.contract} onChange={(event) => setParam('contract', event.target.value)}><option value="">All effective contracts</option><option value="none">No effective contract</option>{meta.contractTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by current firmware" value={query.currentFirmware} onChange={(event) => setParam('currentFirmware', event.target.value)}><option value="">All current firmware</option><option value="none">Unknown current firmware</option>{meta.firmwareReleases.map((item) => <option key={item.id} value={item.id}>{vendorById.get(item.vendorId) ?? item.platform} · {item.version}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by desired firmware" value={query.desiredFirmware} onChange={(event) => setParam('desiredFirmware', event.target.value)}><option value="">All desired firmware</option><option value="none">No desired policy</option>{meta.firmwareReleases.map((item) => <option key={item.id} value={item.id}>{vendorById.get(item.vendorId) ?? item.platform} · {item.version}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by technical state" value={query.technicalState} onChange={(event) => setParam('technicalState', event.target.value)}><option value="">All technical states</option><option value="CURRENT">Current</option><option value="ACTION_REQUIRED">Action required</option><option value="UNKNOWN">Unknown</option><option value="NO_POLICY">No policy</option></SelectInput>
          <SelectInput aria-label="Filter devices by workflow state" value={query.workflow} onChange={(event) => setParam('workflow', event.target.value)}><option value="">All workflow states</option><option value="PLANNED">Planned</option><option value="IGNORED">Ignored</option><option value="CUSTOMER_DECLINED">Customer declined</option><option value="DONE">Done</option><option value="UNDECIDED">No decision</option></SelectInput>
          <SelectInput aria-label="Filter devices by source" value={query.source} onChange={(event) => setParam('source', event.target.value)}><option value="">All sources</option><option value="MANUAL">Manual</option><option value="API">API</option><option value="IMPORT">Import</option></SelectInput>
          <SelectInput aria-label="Filter devices by archive state" value={query.archive} onChange={(event) => setParam('archive', event.target.value === 'active' ? '' : event.target.value)}><option value="active">Active records</option><option value="archived">Archived records</option><option value="all">Active + archived</option></SelectInput>
          <SelectInput aria-label="Sort devices" value={query.sort} onChange={(event) => setParam('sort', event.target.value)}><option value="customer">Sort: customer</option><option value="site">Sort: site</option><option value="vendor">Sort: vendor</option><option value="model">Sort: model</option><option value="deviceType">Sort: device type</option><option value="name">Sort: device name</option><option value="currentFirmware">Sort: current firmware text</option><option value="desiredFirmware">Sort: desired firmware text</option><option value="technicalState">Sort: technical state</option><option value="workflow">Sort: workflow</option><option value="source">Sort: source</option></SelectInput>
          <SelectInput aria-label="Sort direction" value={query.direction} onChange={(event) => setParam('direction', event.target.value === 'asc' ? '' : event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></SelectInput>
          <SelectInput aria-label="Page size" value={String(query.pageSize)} onChange={(event) => setParam('pageSize', event.target.value === '50' ? '' : event.target.value)}><option value="25">25 per page</option><option value="50">50 per page</option><option value="100">100 per page</option></SelectInput>
        </div>
      </details>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3">
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => setParam(chip.key, '')} className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-[var(--muted-strong)] hover:border-[var(--accent-muted)]">
              <span className="font-semibold">{chip.label}:</span> {chip.value} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" onClick={clearAll} className="ml-auto text-xs font-semibold text-[var(--accent-light)] hover:underline">Clear all</button>
        </div>
      ) : null}
    </div>
  )
}
