import Link from 'next/link'
import { GenerateFirmwareReviewReportButton } from '@/components/firmware/reports/firmware-review-actions'
import { ButtonLink } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/page-state'
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge'
import {
  firmwareReviewActionGroups,
  firmwareReviewSnapshotFromJson,
  type FirmwareReviewActionGroup,
  type FirmwareReviewSnapshot,
} from '@/lib/firmware-review'
import {
  firmwareReviewCycleHref,
  firmwareReviewExceptionHref,
  firmwareReviewInventoryHref,
  firmwareReviewPlanHref,
  firmwareReviewReleaseHref,
  firmwareReviewSiteHref,
  firmwareReviewTrainHref,
} from '@/lib/firmware-review-links'
import type { getFirmwareReviewCycle } from '@/lib/firmware-review-store'

type ReviewCycle = NonNullable<
  Awaited<ReturnType<typeof getFirmwareReviewCycle>>
>
type ReviewReport = ReviewCycle['reports'][number]

function dateTime(value: Date | string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
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

function displayCode(value: string) {
  return value
    .toLocaleLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase())
}

function actionTone(action: FirmwareReviewActionGroup['actionKind']): StatusTone {
  switch (action) {
    case 'UPDATE_REQUIRED':
      return 'required'
    case 'UPDATE_RECOMMENDED':
      return 'recommended'
    case 'PLATFORM_MIGRATION':
      return 'warning'
    case 'REVIEW_REQUIRED':
      return 'info'
    case 'REPLACEMENT_OR_EOL':
      return 'danger'
    case 'UNMANAGED':
      return 'neutral'
    case 'NO_ACTION':
      return 'success'
  }
}

function distribution(
  rows: Array<{ value: string; count: number }>,
  empty = '—',
) {
  if (!rows.length) return empty
  return rows.map((row) => row.value + (row.count > 1 ? ' ×' + row.count : '')).join(', ')
}

function occurrence(group: FirmwareReviewActionGroup) {
  if (group.scheduledOccurrences.length)
    return {
      label: 'Scheduled',
      values: group.scheduledOccurrences,
      tone: 'success' as const,
    }
  if (group.proposedOccurrences.length)
    return {
      label: 'Proposed',
      values: group.proposedOccurrences,
      tone: 'info' as const,
    }
  return {
    label: 'Unscheduled',
    values: [] as string[],
    tone: 'neutral' as const,
  }
}

function snapshotDevices(snapshot: FirmwareReviewSnapshot) {
  return snapshot.sites.flatMap((site) => site.devices)
}

function exceptionContexts(
  snapshot: FirmwareReviewSnapshot,
  group: FirmwareReviewActionGroup,
) {
  const ids = new Set(group.deviceIds)
  const contexts = new Map<string, { scope: string; scopeId: string }>()
  for (const device of snapshotDevices(snapshot)) {
    if (!ids.has(device.deviceId) || !device.exception) continue
    const key = device.exception.scope + ':' + device.exception.scopeId
    contexts.set(key, {
      scope: device.exception.scope,
      scopeId: device.exception.scopeId,
    })
  }
  return [...contexts.values()]
}

function policySources(
  snapshot: FirmwareReviewSnapshot,
  group: FirmwareReviewActionGroup,
) {
  const ids = new Set(group.deviceIds)
  const values = new Set<string>()
  for (const device of snapshotDevices(snapshot)) {
    if (!ids.has(device.deviceId) || !device.technical.policySource) continue
    const source = device.technical.policySource
    values.add(
      displayCode(source.scope) +
        ' · ' +
        (source.trackName || device.technical.policy?.trackName || 'Policy'),
    )
  }
  return [...values].sort()
}

function technicalReason(
  snapshot: FirmwareReviewSnapshot,
  group: FirmwareReviewActionGroup,
) {
  const ids = new Set(group.deviceIds)
  const explanations = new Set<string>()
  for (const device of snapshotDevices(snapshot)) {
    if (ids.has(device.deviceId) && device.technical.explanation)
      explanations.add(device.technical.explanation)
  }
  return [...explanations]
}

function ExecutiveSummary({ snapshot }: { snapshot: FirmwareReviewSnapshot }) {
  const items = [
    ['Preferred', snapshot.summary.preferred],
    ['Accepted', snapshot.summary.accepted],
    ['Update recommended', snapshot.summary.updateRecommended],
    ['Update required', snapshot.summary.updateRequired],
    ['Platform migration', snapshot.summary.platformMigration],
    ['Review required / unknown', snapshot.summary.reviewRequired],
    ['Accepted exception', snapshot.summary.acceptedException ?? 0],
    ['Customer declined', snapshot.summary.customerDeclined],
    ['Replacement / EOL', snapshot.summary.replacementOrEol],
    ['Unmanaged', snapshot.summary.unmanaged],
  ]

  return (
    <section className="mb-6 border-y border-[var(--border)] py-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
        Executive summary
      </h2>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-28">
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--foreground)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SiteActionGroups({
  snapshot,
  groups,
}: {
  snapshot: FirmwareReviewSnapshot
  groups: FirmwareReviewActionGroup[]
}) {
  const columns: Array<DataTableColumn<FirmwareReviewActionGroup>> = [
    {
      key: 'action',
      header: 'Action',
      render: (group) => (
        <div className="min-w-36">
          <StatusBadge tone={actionTone(group.actionKind)}>
            {displayCode(group.actionKind)}
          </StatusBadge>
          <div className="mt-2 text-xs text-[var(--muted)]">
            Technical: {group.complianceStates.map(displayCode).join(', ') || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'group',
      header: 'Device / model group',
      render: (group) => (
        <div className="min-w-48">
          <div className="font-semibold text-[var(--foreground)]">
            {group.modelName}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {group.vendorName} · {group.deviceTypeName} · {group.deviceCount}{' '}
            device{group.deviceCount === 1 ? '' : 's'}
          </div>
          <Link
            href={firmwareReviewInventoryHref({
              customerId: snapshot.customer.id,
              siteId: group.siteId,
              deviceTypeId: group.deviceTypeId,
              modelId: group.modelId,
            })}
            className="mt-1.5 inline-block text-xs font-semibold text-[var(--accent-light)] hover:underline"
          >
            View affected devices →
          </Link>
        </div>
      ),
    },
    {
      key: 'firmware',
      header: 'Firmware / track',
      render: (group) => (
        <div className="min-w-48 text-xs">
          <div>
            <span className="text-[var(--muted)]">Current:</span>{' '}
            {distribution(group.currentFirmware)}
          </div>
          <div className="mt-1">
            <span className="text-[var(--muted)]">Track:</span>{' '}
            {distribution(group.tracks)}
          </div>
          <div className="mt-1">
            <span className="text-[var(--muted)]">Preferred:</span>{' '}
            {distribution(group.preferredTargets, 'No resolved target')}
          </div>
          {policySources(snapshot, group).length ? (
            <div className="mt-1">
              <span className="text-[var(--muted)]">Source:</span>{' '}
              {policySources(snapshot, group).join(', ')}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {group.firmwareTrainIds.slice(0, 2).map((trainId) => (
              <Link
                key={trainId}
                href={firmwareReviewTrainHref(trainId)}
                className="font-semibold text-[var(--accent-light)] hover:underline"
              >
                Track
              </Link>
            ))}
            {group.preferredTargetReleaseIds.slice(0, 2).map((releaseId) => (
              <Link
                key={releaseId}
                href={firmwareReviewReleaseHref(releaseId)}
                className="font-semibold text-[var(--accent-light)] hover:underline"
              >
                Target release
              </Link>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (group) => {
        const explanations = technicalReason(snapshot, group)
        return (
          <div className="max-w-80 text-xs leading-5">
            {explanations.length
              ? explanations.slice(0, 2).join(' ')
              : group.recommendations.map(displayCode).join(', ')}
            {group.exceptionReasonCodes.length ? (
              <div className="mt-1 text-[var(--muted)]">
                Exception: {group.exceptionReasonCodes.map(displayCode).join(', ')}
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'planning',
      header: 'Planning',
      render: (group) => {
        const when = occurrence(group)
        return (
          <div className="min-w-44 text-xs">
            <StatusBadge tone={when.tone}>{when.label}</StatusBadge>
            {when.values.length ? (
              <div className="mt-2 space-y-1">
                {when.values.map((value) => (
                  <div key={value}>{dateTime(value)}</div>
                ))}
              </div>
            ) : null}
            {group.planningStates.length ? (
              <div className="mt-1 text-[var(--muted)]">
                {group.planningStates.map(displayCode).join(', ')}
              </div>
            ) : null}
            {group.externalReferences.length ? (
              <div className="mt-1 text-[var(--muted)]">
                Ref: {group.externalReferences.join(', ')}
              </div>
            ) : null}
            {group.missingExternalReferencePlanIds.length ? (
              <div className="mt-1 font-semibold text-[var(--warning)]">
                External reference missing
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
              {group.planIds.slice(0, 3).map((planId) => (
                <Link
                  key={planId}
                  href={firmwareReviewPlanHref(planId)}
                  className="font-semibold text-[var(--accent-light)] hover:underline"
                >
                  Open plan
                </Link>
              ))}
            </div>
          </div>
        )
      },
    },
    {
      key: 'exception',
      header: 'Exception',
      render: (group) => {
        const contexts = exceptionContexts(snapshot, group)
        if (!group.exceptionReasonCodes.length)
          return <span className="text-xs text-[var(--muted)]">None</span>
        return (
          <div className="min-w-36 text-xs">
            <div>{group.exceptionReasonCodes.map(displayCode).join(', ')}</div>
            {group.exceptionExpiries.length ? (
              <div className="mt-1 text-[var(--muted)]">
                Review / expiry: {group.exceptionExpiries.map(dateOnly).join(', ')}
              </div>
            ) : null}
            <div className="mt-2 flex flex-col items-start gap-1">
              {contexts.slice(0, 3).map((context) => (
                <Link
                  key={context.scope + ':' + context.scopeId}
                  href={firmwareReviewExceptionHref(
                    context.scope,
                    context.scopeId,
                  )}
                  className="font-semibold text-[var(--accent-light)] hover:underline"
                >
                  Open {displayCode(context.scope)} exception →
                </Link>
              ))}
            </div>
          </div>
        )
      },
    },
  ]

  const siteKeys = [
    ...new Set(groups.map((group) => group.siteId ?? '__NO_SITE__')),
  ]

  return (
    <div className="space-y-7">
      {siteKeys.map((siteKey) => {
        const siteGroups = groups.filter(
          (group) => (group.siteId ?? '__NO_SITE__') === siteKey,
        )
        const first = siteGroups[0]
        return (
          <section key={siteKey}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] pb-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Site
                </div>
                <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                  {first.siteName ?? 'No Site assigned'}
                </h2>
                {first.organizationUnit ? (
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {first.organizationUnit.name}
                  </div>
                ) : null}
              </div>
              {first.siteId ? (
                <ButtonLink
                  href={firmwareReviewSiteHref(
                    snapshot.customer.id,
                    first.siteId,
                  )}
                  variant="ghost"
                >
                  Open Site workspace
                </ButtonLink>
              ) : null}
            </div>
            <DataTable
              caption={(first.siteName ?? 'Unassigned') + ' firmware review actions'}
              rows={siteGroups}
              rowKey={(group) => group.key}
              columns={columns}
            />
          </section>
        )
      })}
    </div>
  )
}

export function FirmwareReviewDetail({
  cycle,
  selectedReport,
}: {
  cycle: ReviewCycle
  selectedReport: ReviewReport | null
}) {
  const latest = cycle.reports[0] ?? null
  const snapshot = selectedReport
    ? firmwareReviewSnapshotFromJson(selectedReport.snapshot)
    : null
  const groups = snapshot ? firmwareReviewActionGroups(snapshot) : []

  return (
    <>
      <PageHeader
        eyebrow="Firmware review"
        title={cycle.customerName}
        description="Immutable quarterly review snapshots grouped by Site and actionable firmware recommendation."
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
          { label: cycle.customerName },
        ]}
        meta={
          <>
            <span>
              Period {dateOnly(cycle.periodStart)} – {dateOnly(cycle.periodEnd)}
            </span>
            <span aria-hidden="true">·</span>
            <span>Cycle {cycle.state}</span>
            <span aria-hidden="true">·</span>
            <span>Next review {dateOnly(cycle.nextReviewAt)}</span>
          </>
        }
        actions={
          <GenerateFirmwareReviewReportButton cycleId={cycle.id} />
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-4 text-sm">
        <span className="font-semibold">Report versions:</span>
        {cycle.reports.length ? (
          cycle.reports.map((report) => (
            <Link
              key={report.id}
              href={firmwareReviewCycleHref(cycle.id, report.version)}
              className={
                'rounded-md border px-2.5 py-1.5 font-semibold ' +
                (selectedReport?.id === report.id
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
                  : 'border-[var(--border)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]')
              }
            >
              v{report.version}
              {latest?.id === report.id ? ' · latest' : ''}
            </Link>
          ))
        ) : (
          <span className="text-[var(--muted)]">No generated versions</span>
        )}
      </div>

      {!selectedReport || !snapshot ? (
        <EmptyState
          title={
            selectedReport
              ? 'Stored report snapshot is not readable'
              : 'No report version generated yet'
          }
          description={
            selectedReport
              ? 'The stored historical report was not regenerated from live data. Inspect the persisted snapshot before changing it.'
              : 'Generate the first immutable version when the review is ready to capture current firmware, policy, exceptions, and planning state.'
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
            <span>
              Viewing version <strong className="text-[var(--foreground)]">{selectedReport.version}</strong>
              {latest?.id === selectedReport.id ? ' (latest)' : ' (historical)'}
            </span>
            <span>Snapshot taken {dateTime(snapshot.generatedAt)}</span>
            <span>
              Snapshot schema v{snapshot.schemaVersion}
            </span>
            <span className="font-mono" title={selectedReport.snapshotHash}>
              SHA-256 {selectedReport.snapshotHash.slice(0, 12)}…
            </span>
          </div>

          <ExecutiveSummary snapshot={snapshot} />

          {groups.length ? (
            <SiteActionGroups snapshot={snapshot} groups={groups} />
          ) : (
            <EmptyState
              title="No devices in this snapshot"
              description="This immutable report version contains no device rows for the customer."
            />
          )}
        </>
      )}
    </>
  )
}
