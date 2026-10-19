import Link from 'next/link'
import { Button, ButtonLink } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
} from '@/components/ui/filter-bar'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/page-state'
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge'
import { firmwareReviewCycleHref } from '@/lib/firmware-review-links'
import type { listFirmwareReviewWorkspace } from '@/lib/firmware-review-store'
import type { FirmwareReviewDueState } from '@/lib/firmware-review'

type WorkspaceRow = Awaited<
  ReturnType<typeof listFirmwareReviewWorkspace>
>[number]

export type FirmwareReviewWorkspaceFilters = {
  q: string
  review: string
  attention: string
}

const dueStyle: Record<
  FirmwareReviewDueState,
  { label: string; tone: StatusTone }
> = {
  NO_CYCLE: { label: 'No cycle', tone: 'warning' },
  CURRENT: { label: 'Current', tone: 'success' },
  UPCOMING: { label: 'Upcoming', tone: 'info' },
  DUE: { label: 'Due', tone: 'recommended' },
  OVERDUE: { label: 'Overdue', tone: 'required' },
}

function dateOnly(value: Date | string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
}

function compactCounts(
  values: Array<[string, number | null | undefined]>,
) {
  const visible = values.filter(([, value]) => (value ?? 0) > 0)
  if (!visible.length) return <span className="text-[var(--muted)]">None</span>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {visible.map(([label, value]) => (
        <span key={label}>
          <strong className="tabular-nums text-[var(--foreground)]">{value}</strong>{' '}
          {label}
        </span>
      ))}
    </div>
  )
}

function reviewMatches(row: WorkspaceRow, filter: string) {
  return !filter || row.dueState === filter
}

function attentionMatches(row: WorkspaceRow, filter: string) {
  if (!filter) return true
  const metrics = row.metrics
  if (!metrics) return filter === 'NO_REPORT'
  switch (filter) {
    case 'UPDATE_REQUIRED':
      return metrics.updateRequired > 0
    case 'UPDATE_RECOMMENDED':
      return metrics.updateRecommended > 0
    case 'PLATFORM_MIGRATION':
      return metrics.platformMigration > 0
    case 'UNPLANNED':
      return metrics.unplannedRecommendations > 0
    case 'AWAITING_CUSTOMER':
      return metrics.awaitingCustomerPlans > 0
    case 'EXPIRING_EXCEPTION':
      return metrics.exceptionsExpiring > 0
    case 'BLOCKED_RELEASE':
      return metrics.blockedReleases > 0
    case 'REPLACEMENT_OR_EOL':
      return metrics.replacementOrEol > 0
    case 'MISSING_REFERENCE':
      return metrics.missingExternalReferences > 0
    case 'NO_REPORT':
      return !row.latestReport
    default:
      return true
  }
}

export function filterFirmwareReviewWorkspace(
  rows: WorkspaceRow[],
  filters: FirmwareReviewWorkspaceFilters,
) {
  const needle = filters.q.normalize('NFKC').trim().toLocaleLowerCase()
  return rows.filter(
    (row) =>
      (!needle ||
        row.customer.name.toLocaleLowerCase().includes(needle) ||
        row.customer.code?.toLocaleLowerCase().includes(needle)) &&
      reviewMatches(row, filters.review) &&
      attentionMatches(row, filters.attention),
  )
}

export function FirmwareReviewWorkspace({
  rows,
  filters,
}: {
  rows: WorkspaceRow[]
  filters: FirmwareReviewWorkspaceFilters
}) {
  const filtered = filterFirmwareReviewWorkspace(rows, filters)
  const overdue = rows.filter((row) => row.dueState === 'OVERDUE').length
  const due = rows.filter((row) => row.dueState === 'DUE').length
  const unplanned = rows.reduce(
    (total, row) => total + (row.metrics?.unplannedRecommendations ?? 0),
    0,
  )
  const awaiting = rows.reduce(
    (total, row) => total + (row.metrics?.awaitingCustomerPlans ?? 0),
    0,
  )

  const columns: Array<DataTableColumn<WorkspaceRow>> = [
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <div className="min-w-48">
          <div className="font-semibold text-[var(--foreground)]">
            {row.cycle ? (
              <Link
                href={firmwareReviewCycleHref(row.cycle.id)}
                className="hover:text-[var(--accent-light)] hover:underline"
              >
                {row.customer.name}
              </Link>
            ) : (
              row.customer.name
            )}
          </div>
          {row.customer.code ? (
            <div className="mt-1 font-mono text-xs text-[var(--muted)]">
              {row.customer.code}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'review',
      header: 'Review timing',
      render: (row) => {
        const style = dueStyle[row.dueState]
        return (
          <div className="min-w-36 space-y-1.5">
            <StatusBadge tone={style.tone}>{style.label}</StatusBadge>
            <div className="text-xs">
              Next: {dateOnly(row.cycle?.nextReviewAt)}
            </div>
            {row.cycle ? (
              <div className="text-xs text-[var(--muted)]">
                {row.cycle.state} · through {dateOnly(row.cycle.periodEnd)}
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'technical',
      header: 'Technical',
      render: (row) =>
        row.metrics
          ? compactCounts([
              ['preferred', row.metrics.preferred],
              ['accepted', row.metrics.accepted],
              ['blocked', row.metrics.blockedReleases],
            ])
          : <span className="text-xs text-[var(--muted)]">Generate a report snapshot</span>,
    },
    {
      key: 'recommendations',
      header: 'Recommendations',
      render: (row) =>
        row.metrics
          ? compactCounts([
              ['required', row.metrics.updateRequired],
              ['recommended', row.metrics.updateRecommended],
              ['migration', row.metrics.platformMigration],
              ['review', row.metrics.reviewRequired],
            ])
          : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: 'planning',
      header: 'Planning',
      render: (row) =>
        row.metrics
          ? compactCounts([
              ['unplanned', row.metrics.unplannedRecommendations],
              ['awaiting customer', row.metrics.awaitingCustomerPlans],
              ['missing ref', row.metrics.missingExternalReferences],
            ])
          : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: 'exceptions',
      header: 'Exceptions / lifecycle',
      render: (row) =>
        row.metrics
          ? compactCounts([
              ['expiring', row.metrics.exceptionsExpiring],
              ['replacement/EOL', row.metrics.replacementOrEol],
              ['unmanaged', row.metrics.unmanaged],
            ])
          : <span className="text-[var(--muted)]">—</span>,
    },
    {
      key: 'report',
      header: 'Latest report',
      render: (row) =>
        row.latestReport && row.cycle ? (
          <div className="min-w-32">
            <Link
              href={firmwareReviewCycleHref(
                row.cycle.id,
                row.latestReport.version,
              )}
              className="font-semibold text-[var(--accent-light)] hover:underline"
            >
              Version {row.latestReport.version}
            </Link>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {dateOnly(row.latestReport.generatedAt)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-[var(--muted)]">No snapshot yet</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Firmware review"
        description="Cross-customer review cycles and actionable firmware follow-up. Technical compliance, exceptions, and planning remain separate dimensions."
        meta={
          <>
            <span>{rows.length} active customers</span>
            <span aria-hidden="true">·</span>
            <span>{overdue} overdue</span>
            <span aria-hidden="true">·</span>
            <span>{due} due today</span>
            <span aria-hidden="true">·</span>
            <span>{unplanned} unplanned recommendations</span>
            <span aria-hidden="true">·</span>
            <span>{awaiting} plans awaiting customer</span>
          </>
        }
        actions={
          <ButtonLink href="/reports/new" variant="primary">
            Create review cycle
          </ButtonLink>
        }
      />

      <form method="get" className="mb-4">
        <FilterBar
          summary={
            <span>
              Showing {filtered.length} of {rows.length} customers
            </span>
          }
          actions={
            <>
              <Button type="submit">Apply</Button>
              <ButtonLink href="/reports" variant="ghost">
                Reset
              </ButtonLink>
            </>
          }
        >
          <FilterSearch
            name="q"
            defaultValue={filters.q}
            label="Customer"
            placeholder="Name or code"
          />
          <FilterSelect
            id="review-filter"
            name="review"
            label="Review state"
            defaultValue={filters.review}
            options={[
              { value: '', label: 'All review states' },
              { value: 'NO_CYCLE', label: 'No cycle' },
              { value: 'OVERDUE', label: 'Overdue' },
              { value: 'DUE', label: 'Due today' },
              { value: 'UPCOMING', label: 'Upcoming' },
              { value: 'CURRENT', label: 'Current' },
            ]}
          />
          <FilterSelect
            id="attention-filter"
            name="attention"
            label="Needs attention"
            defaultValue={filters.attention}
            options={[
              { value: '', label: 'All customers' },
              { value: 'NO_REPORT', label: 'No report snapshot' },
              { value: 'UPDATE_REQUIRED', label: 'Update required' },
              { value: 'UPDATE_RECOMMENDED', label: 'Update recommended' },
              { value: 'PLATFORM_MIGRATION', label: 'Platform migration' },
              { value: 'UNPLANNED', label: 'Recommendation not planned' },
              { value: 'AWAITING_CUSTOMER', label: 'Awaiting customer' },
              { value: 'EXPIRING_EXCEPTION', label: 'Exception expiring' },
              { value: 'BLOCKED_RELEASE', label: 'Blocked release' },
              { value: 'REPLACEMENT_OR_EOL', label: 'Replacement / EOL' },
              { value: 'MISSING_REFERENCE', label: 'Plan missing reference' },
            ]}
          />
        </FilterBar>
      </form>

      <DataTable
        caption="Customer firmware review cycles"
        rows={filtered}
        rowKey={(row) => row.customer.id}
        columns={columns}
        emptyState={
          <EmptyState
            title="No customers match these review filters"
            description="Adjust the customer, timing, or attention filter. Review snapshots are never regenerated just to populate this workspace."
          />
        }
      />
    </>
  )
}
