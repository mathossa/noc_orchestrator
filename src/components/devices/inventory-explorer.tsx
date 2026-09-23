import Link from 'next/link'
import { InventorySearchForm } from './inventory-search-form'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { SummaryStat } from '@/components/ui/summary-stat'
import type {
  CustomerInventoryModel,
  DeviceTypeInventoryModel,
  InventoryCustomerRow,
  InventoryDeviceRow,
  InventoryDeviceTypeRow,
  InventoryFilterOptions,
  InventoryQuery,
  InventorySiteRow,
  SiteInventoryModel,
  InventoryOverviewModel,
} from '@/lib/inventory-explorer'
import { inventoryHref } from '@/lib/inventory-explorer'
import type {
  InventoryPrimaryStatus,
  InventoryPrimaryStatusCode,
} from '@/lib/inventory-status'

const controlClass =
  'h-10 rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--accent)]'

const statusLabels: Record<InventoryPrimaryStatusCode, string> = {
  CRITICAL_ATTENTION: 'Critical attention',
  UPDATE_REQUIRED: 'Update required',
  REVIEW_REQUIRED: 'Review required',
  UPDATE_RECOMMENDED: 'Update recommended',
  EXCEPTION: 'Exception',
  UNKNOWN: 'Unknown',
  CURRENT: 'Current',
}

export function InventoryStatusBadge({
  status,
}: {
  status: InventoryPrimaryStatus
}) {
  return (
    <StatusBadge tone={status.tone} ariaLabel={'Inventory status: ' + status.label}>
      {status.label}
    </StatusBadge>
  )
}

function GroupAttention({
  count,
  criticalCount,
  href,
}: {
  count: number
  criticalCount: number
  href: string
}) {
  if (count === 0) {
    return (
      <StatusBadge tone="success" ariaLabel="No devices need attention">
        Healthy
      </StatusBadge>
    )
  }
  return (
    <Link href={href} className="inline-flex hover:brightness-110">
      <StatusBadge tone={criticalCount > 0 ? 'danger' : 'warning'} ariaLabel={count + ' devices need attention; ' + criticalCount + ' critical'}>
        {criticalCount > 0 ? criticalCount + ' critical' + (count > criticalCount ? ' · ' + (count - criticalCount) + ' attention' : '') : count + ' attention'}
      </StatusBadge>
    </Link>
  )
}

function hasAdvancedFilters(query: InventoryQuery) {
  return Boolean(
    query.vendor ||
      query.model ||
      query.deviceType ||
      query.contract ||
      query.source ||
      query.status,
  )
}

function InventoryToolbar({
  path,
  query,
  filters,
  searchPlaceholder,
  showDeviceType = true,
}: {
  path: string
  query: InventoryQuery
  filters: InventoryFilterOptions
  searchPlaceholder: string
  showDeviceType?: boolean
}) {
  const filtersActive = hasAdvancedFilters(query)

  return (
    <InventorySearchForm key={path} path={path}>
      {query.flagged ? <input type="hidden" name="flagged" value="1" /> : null}
      {query.attention ? <input type="hidden" name="attention" value="1" /> : null}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-2">
          <label className="sr-only" htmlFor="inventory-search">
            Search inventory
          </label>
          <input
            id="inventory-search"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder={searchPlaceholder}
            className={controlClass + ' min-w-0 flex-1'}
          />
          <button
            type="submit"
            className="h-10 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
          >
            Search
          </button>
        </div>

        <details className="group rounded-md border border-[var(--border-strong)] bg-[var(--surface)]">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]">
            Filters
            {filtersActive ? (
              <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] text-[var(--accent-contrast)]">
                Active
              </span>
            ) : null}
          </summary>
          <div className="grid gap-3 border-t border-[var(--border)] p-3 sm:grid-cols-2 xl:grid-cols-3">
            <FilterSelect
              name="vendor"
              label="Vendor"
              value={query.vendor}
              options={[
                { value: '', label: 'All vendors' },
                ...filters.vendors.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
            <FilterSelect
              name="model"
              label="Model"
              value={query.model}
              options={[
                { value: '', label: 'All models' },
                ...filters.models.map((item) => ({
                  value: item.id,
                  label: item.vendorName + ' · ' + item.model,
                })),
              ]}
            />
            {showDeviceType ? (
              <FilterSelect
                name="deviceType"
                label="Device type"
                value={query.deviceType}
                options={[
                  { value: '', label: 'All device types' },
                  ...filters.deviceTypes.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            ) : null}
            <FilterSelect
              name="contract"
              label="Contract"
              value={query.contract}
              options={[
                { value: '', label: 'All contracts' },
                { value: 'none', label: 'No contract' },
                ...filters.contracts.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
            <FilterSelect
              name="source"
              label="Source"
              value={query.source}
              options={[
                { value: '', label: 'All sources' },
                { value: 'MANUAL', label: 'Manual' },
                { value: 'API', label: 'API' },
                { value: 'IMPORT', label: 'Import' },
              ]}
            />
            <FilterSelect
              name="status"
              label="Inventory status"
              value={query.status}
              options={[
                { value: '', label: 'All statuses' },
                ...Object.entries(statusLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-3">
              <button
                type="submit"
                className="h-9 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-contrast)]"
              >
                Apply filters
              </button>
              <Link
                href={query.attention ? path + '?attention=1' : path}
                className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] px-3 text-sm font-semibold text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
              >
                Clear filters
              </Link>
            </div>
          </div>
        </details>
      </div>
    </InventorySearchForm>
  )
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block text-xs font-semibold text-[var(--muted-strong)]">
      {label}
      <select
        name={name}
        defaultValue={value}
        className={controlClass + ' mt-1.5 w-full'}
      >
        {options.map((option) => (
          <option key={option.value || 'all'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function AttentionToggle({
  path,
  query,
}: {
  path: string
  query: InventoryQuery
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-[var(--muted)]">Showing:</span>
      <Link
        href={inventoryHref(path, query, { attention: false, flagged: false, page: 1 })}
        className={
          'rounded-md border px-3 py-1.5 font-semibold ' +
          (!query.attention && !query.flagged
            ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
            : 'border-[var(--border-strong)] text-[var(--muted-strong)]')
        }
      >
        All
      </Link>
      <Link
        href={inventoryHref(path, query, { attention: true, flagged: false, page: 1 })}
        className={
          'rounded-md border px-3 py-1.5 font-semibold ' +
          (query.attention
            ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
            : 'border-[var(--border-strong)] text-[var(--muted-strong)]')
        }
      >
        Needs attention
      </Link>
      <Link href={inventoryHref(path, query, { flagged: true, attention: false, page: 1 })} className="rounded-md border border-[var(--info-border)] px-3 py-1.5 font-semibold text-[var(--info)]" aria-current={query.flagged ? 'page' : undefined}>Flagged issues</Link>
    </div>
  )
}

function InventorySummary({
  total,
  attention,
  unknown,
  critical,
  issues,
}: {
  total: number
  attention: number
  unknown: number
  critical: number
  issues: number
}) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryStat
        label="Total devices"
        value={total}
        detail="Active inventory in the current scope."
      />
      <SummaryStat
        label="Needs attention"
        value={<span className="text-[var(--warning)]">{attention}</span>}
        detail="Actionable inventory status after exception handling."
      />
      <SummaryStat
        label="Unknown"
        value={<span className="text-[var(--info)]">{unknown}</span>}
        detail="Missing or unresolved firmware/policy context."
      />
      {issues > 0 ? <SummaryStat label="Flagged device issues" value={issues} detail="Needs investigation; separate from firmware status." /> : null}
      <SummaryStat
        label="Critical attention"
        value={<span className="text-[var(--danger)]">{critical}</span>}
        detail="Blocked or incompatible technical state."
      />
    </div>
  )
}

function DeviceRows({
  rows,
  caption,
  showContext = false,
}: {
  rows: InventoryDeviceRow[]
  caption: string
  showContext?: boolean
}) {
  const columns: Array<DataTableColumn<InventoryDeviceRow>> = [
    {
      key: 'device',
      header: 'Device',
      render: (row) => (
        <div className="min-w-[150px]">
          <Link
            href={'/devices/' + row.id}
            className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)] hover:underline"
          >
            {row.hostname ?? row.name}
          </Link>
          {row.issueReason ? <div className="mt-1 text-xs font-semibold text-[var(--info)]" title={row.issueReason}>Flagged issue</div> : null}
          {row.hostname && row.hostname !== row.name ? (
            <div className="mt-0.5 text-xs text-[var(--muted)]">{row.name}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (row) => row.model,
    },
    {
      key: 'firmware',
      header: 'Current firmware',
      render: (row) => (
        <span className="font-mono text-xs">
          {row.currentFirmware ?? 'Unknown'}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Effective target',
      render: (row) => <div><span className="font-mono text-xs">{row.effectiveTarget ?? 'Unresolved'}</span><div className="text-xs text-[var(--muted)]">{[row.targetPlatform, row.targetTrain].filter(Boolean).join(' · ')}</div></div>,
    },
    {
      key: 'policy',
      header: 'Policy / decision',
      render: (row) => <div>{row.policyContext}{row.decision ? <div className="text-xs text-[var(--muted)]">{row.decision}</div> : null}</div>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span title={row.status.reason}>
          <InventoryStatusBadge status={row.status} />
        </span>
      ),
    },
  ]

  if (showContext) {
    columns.splice(1, 0, {
      key: 'context',
      header: 'Location',
      render: (row) => (
        <span>
          {row.customer.name}
          {row.site ? ' / ' + row.site.name : ' / Unassigned'}
        </span>
      ),
    })
  }

  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      emptyState={
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          No matching devices.
        </div>
      }
    />
  )
}

function SearchMatches({
  rows,
  hierarchy,
  showContext,
}: {
  rows: InventoryDeviceRow[]
  hierarchy: import('@/lib/inventory-explorer').InventoryHierarchyMatch[]
  showContext: boolean
}) {
  if (rows.length === 0 && hierarchy.length === 0) return null
  return (
    <section className="mb-6">
      {hierarchy.length > 0 ? <div className="mb-4">
        <h2 className="text-sm font-semibold">Matching locations and device groups</h2>
        <ul className="mt-2 flex flex-wrap gap-3">{hierarchy.map((match) => <li key={match.href}><Link href={match.href} className="text-sm text-[var(--accent-light)] hover:underline">{match.kind}: {match.label}</Link></li>)}</ul>
      </div> : null}
      <div className="mb-2">
        <h2 className="text-sm font-semibold">Direct device matches</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Quick lookup results; hierarchy rows below still show where the matches live.
        </p>
      </div>
      <DeviceRows
        rows={rows}
        caption="Direct inventory search matches"
        showContext={showContext}
      />
    </section>
  )
}

function exportHref(
  scope: Record<string, string>,
  query: InventoryQuery,
) {
  const params = new URLSearchParams(scope)
  if (query.q) params.set('q', query.q)
  if (query.vendor) params.set('vendor', query.vendor)
  if (query.model) params.set('model', query.model)
  if (query.deviceType) params.set('deviceType', query.deviceType)
  if (query.contract) params.set('contract', query.contract)
  if (query.source) params.set('source', query.source)
  if (query.status) params.set('status', query.status)
  if (query.attention) params.set('attention', '1')
  if (query.flagged) params.set('flagged', '1')
  return '/api/v1/inventory/export?' + params.toString()
}

export function InventoryOverview({
  model,
  query,
}: {
  model: InventoryOverviewModel
  query: InventoryQuery
}) {
  const path = '/devices'
  const columns: Array<DataTableColumn<InventoryCustomerRow>> = [
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <Link
          href={'/devices/customers/' + row.id}
          className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)] hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    { key: 'sites', header: 'Sites', numeric: true, render: (row) => row.siteCount },
    {
      key: 'devices',
      header: 'Devices',
      numeric: true,
      render: (row) => row.deviceCount,
    },
    {
      key: 'attention',
      header: 'Firmware attention',
      render: (row) => (
        <GroupAttention
          count={row.attentionCount}
          criticalCount={row.criticalCount}
          href={'/devices/customers/' + row.id + '?attention=1'}
        />
      ),
    },
    { key: 'issues', header: 'Device issues', render: (row) => row.issueCount > 0 ? <Link className="text-[var(--info)] hover:underline" href={'/devices/customers/' + row.id + '?flagged=1'}>{row.issueCount} flagged</Link> : <span className="text-[var(--muted)]">—</span> },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Devices"
        description="Find what equipment needs attention and where it is. Start at the customer, then drill into sites and device groups."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/devices/manage"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
            >
              Manage inventory records
            </Link>
            <Link
              href="/devices/import"
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)]"
            >
              Import
            </Link>
          </div>
        }
      />
      <InventoryToolbar
        path={path}
        query={query}
        filters={model.filters}
        searchPlaceholder="Search customer, site, hostname, serial, IP or model…"
      />
      <InventorySummary {...model.counts} />
      <AttentionToggle path={path} query={query} />
      <SearchMatches hierarchy={model.hierarchyMatches} rows={model.searchHits} showContext />

      <section>
        <div className="mb-2">
          <h2 className="text-sm font-semibold">Customers</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Customers with the highest-severity attention are shown first.
          </p>
        </div>
        <DataTable
          caption="Customer inventory attention"
          rows={model.customers}
          rowKey={(row) => row.id}
          columns={columns}
          emptyState={
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
              No customer inventory matches this scope.
            </div>
          }
        />
      </section>
    </>
  )
}

export function CustomerInventory({
  model,
  query,
}: {
  model: CustomerInventoryModel
  query: InventoryQuery
}) {
  const path = '/devices/customers/' + model.customer.id
  const columns: Array<DataTableColumn<InventorySiteRow>> = [
    {
      key: 'site',
      header: 'Site',
      render: (row) => (
        <Link
          href={path + '/sites/' + row.id}
          className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)] hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'devices',
      header: 'Devices',
      numeric: true,
      render: (row) => row.deviceCount,
    },
    {
      key: 'attention',
      header: 'Firmware attention',
      render: (row) => (
        <GroupAttention
          count={row.attentionCount}
          criticalCount={row.criticalCount}
          href={path + '/sites/' + row.id + '?attention=1'}
        />
      ),
    },
    { key: 'issues', header: 'Device issues', render: (row) => row.issueCount > 0 ? <Link className="text-[var(--info)] hover:underline" href={path + '/sites/' + row.id + '?flagged=1'}>{row.issueCount} flagged</Link> : <span className="text-[var(--muted)]">—</span> },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Devices', href: '/devices' },
          { label: model.customer.name },
        ]}
        eyebrow="Customer inventory"
        title={model.customer.name}
        description="Sites for this customer, ordered by inventory attention."
        meta={
          <span>
            {model.counts.total + ' devices · ' + model.sites.length + ' inventory site groups · ' + model.counts.attention + ' need attention'}
          </span>
        }
        actions={
          <Link
            href={exportHref(
              { scope: 'customer', customerId: model.customer.id },
              query,
            )}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Export inventory
          </Link>
        }
      />
      <InventoryToolbar
        path={path}
        query={query}
        filters={model.filters}
        searchPlaceholder="Search within this customer…"
      />
      <InventorySummary {...model.counts} />
      <AttentionToggle path={path} query={query} />
      <SearchMatches hierarchy={model.hierarchyMatches} rows={model.searchHits} showContext={false} />
      <DataTable
        caption={'Sites for ' + model.customer.name}
        rows={model.sites}
        rowKey={(row) => row.id}
        columns={columns}
        emptyState={
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            No sites contain matching inventory.
          </div>
        }
      />
    </>
  )
}

export function SiteInventory({
  model,
  query,
}: {
  model: SiteInventoryModel
  query: InventoryQuery
}) {
  const path =
    '/devices/customers/' +
    model.customer.id +
    '/sites/' +
    model.site.id
  const columns: Array<DataTableColumn<InventoryDeviceTypeRow>> = [
    {
      key: 'type',
      header: 'Device type',
      render: (row) => (
        <Link
          href={path + '/types/' + row.id}
          className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)] hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'devices',
      header: 'Devices',
      numeric: true,
      render: (row) => row.deviceCount,
    },
    {
      key: 'attention',
      header: 'Firmware attention',
      render: (row) => (
        <GroupAttention
          count={row.attentionCount}
          criticalCount={row.criticalCount}
          href={path + '/types/' + row.id + '?attention=1'}
        />
      ),
    },
    { key: 'issues', header: 'Device issues', render: (row) => row.issueCount > 0 ? <Link className="text-[var(--info)] hover:underline" href={path + '/types/' + row.id + '?flagged=1'}>{row.issueCount} flagged</Link> : <span className="text-[var(--muted)]">—</span> },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Devices', href: '/devices' },
          {
            label: model.customer.name,
            href: '/devices/customers/' + model.customer.id,
          },
          { label: model.site.name },
        ]}
        eyebrow="Site inventory"
        title={model.site.name}
        description="Inventory is grouped by the canonical device type already assigned to each model."
        meta={
          <span>
            {model.counts.total + ' devices · ' + model.counts.attention + ' need attention'}
          </span>
        }
        actions={
          <Link
            href={exportHref(
              {
                scope: 'site',
                customerId: model.customer.id,
                siteId: model.site.id,
              },
              query,
            )}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Export inventory
          </Link>
        }
      />
      <InventoryToolbar
        path={path}
        query={query}
        filters={model.filters}
        searchPlaceholder="Search within this site…"
      />
      <InventorySummary {...model.counts} />
      <AttentionToggle path={path} query={query} />
      <SearchMatches hierarchy={model.hierarchyMatches} rows={model.searchHits} showContext={false} />
      <DataTable
        caption={'Device types at ' + model.site.name}
        rows={model.deviceTypes}
        rowKey={(row) => row.id}
        columns={columns}
        emptyState={
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            No device groups match this scope.
          </div>
        }
      />
    </>
  )
}

function Pagination({
  path,
  query,
  page,
  totalPages,
  total,
}: {
  path: string
  query: InventoryQuery
  page: number
  totalPages: number
  total: number
}) {
  if (totalPages <= 1) {
    return (
      <div className="mt-3 text-xs text-[var(--muted)]">
        {total + ' device' + (total === 1 ? '' : 's')}
      </div>
    )
  }

  return (
    <nav
      aria-label="Device pagination"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span className="text-[var(--muted)]">
        {'Page ' + page + ' of ' + totalPages + ' · ' + total + ' devices'}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={inventoryHref(path, query, { page: page - 1 })}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-muted)]"
          >
            Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link
            href={inventoryHref(path, query, { page: page + 1 })}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 font-semibold hover:bg-[var(--surface-muted)]"
          >
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  )
}

export function DeviceTypeInventory({
  model,
  query,
}: {
  model: DeviceTypeInventoryModel
  query: InventoryQuery
}) {
  const path =
    '/devices/customers/' +
    model.customer.id +
    '/sites/' +
    model.site.id +
    '/types/' +
    model.deviceType.id

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Devices', href: '/devices' },
          {
            label: model.customer.name,
            href: '/devices/customers/' + model.customer.id,
          },
          {
            label: model.site.name,
            href:
              '/devices/customers/' +
              model.customer.id +
              '/sites/' +
              model.site.id,
          },
          { label: model.deviceType.name },
        ]}
        eyebrow="Device group"
        title={model.deviceType.name}
        description="Individual devices are shown only at this level. Problems are ordered first; technical detail remains on the device."
        meta={
          <span>
            {model.counts.total + ' devices · ' + model.counts.attention + ' need attention'}
          </span>
        }
        actions={
          <Link
            href={exportHref(
              {
                scope: 'deviceType',
                customerId: model.customer.id,
                siteId: model.site.id,
                deviceTypeId: model.deviceType.id,
              },
              query,
            )}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Export inventory
          </Link>
        }
      />
      <InventoryToolbar
        path={path}
        query={query}
        filters={model.filters}
        searchPlaceholder={'Search ' + model.deviceType.name.toLowerCase() + '…'}
        showDeviceType={false}
      />
      <InventorySummary {...model.counts} />
      <AttentionToggle path={path} query={query} />
      <DeviceRows
        rows={model.devices}
        caption={
          model.deviceType.name +
          ' at ' +
          model.customer.name +
          ' / ' +
          model.site.name
        }
      />
      <Pagination
        path={path}
        query={query}
        page={model.pagination.page}
        totalPages={model.pagination.totalPages}
        total={model.pagination.total}
      />
    </>
  )
}
