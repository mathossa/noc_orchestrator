'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImporterV2Inspector } from '@/components/devices/importer-v2-inspector'
import type {
  RowDetail,
  WorkspaceData,
  WorkspaceRow,
} from '@/components/devices/importer-v2-workspace-client-types'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import type {
  ImporterV2WorkspaceFilters,
  ImporterV2WorkspaceGroup,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'

const GROUPS: readonly { value: ImporterV2WorkspaceGroup; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'customer', label: 'Customer' },
  { value: 'businessUnit', label: 'Subdomain' },
  { value: 'site', label: 'Site' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'deviceType', label: 'Device type' },
  { value: 'sourceModel', label: 'Source model' },
  { value: 'canonicalModel', label: 'Canonical model' },
  { value: 'firmwareEvidencePattern', label: 'Firmware evidence' },
  { value: 'repeatClassification', label: 'Repeat classification' },
]

const EMPTY_FILTERS: ImporterV2WorkspaceFilters = {
  search: null,
  status: null,
  issue: null,
  customer: null,
  businessUnit: null,
  site: null,
  vendor: null,
  deviceType: null,
  sourceModel: null,
  canonicalModel: null,
  firmwareEvidencePattern: null,
  repeatClassification: null,
}

type BulkVerificationResult = {
  selectedCount: number
  verifiedCount: number
  alreadyResolvedCount: number
  manualReviewCount: number
  invalidCount: number
  publishedCount: number
  manualReviewRows: number[]
  firmware: {
    selectedCount: number
    verifiedCount: number
    alreadyVerifiedCount: number
    alreadyTrustedCount: number
    manualReviewCount: number
    notApplicableCount: number
    excludedCount: number
    publishedCount: number
    manualReviewRows: Array<{ rowNumber: number; reason: string }>
  }
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Request failed.')
  }
  return body.data as T
}

function display(value: string | null | undefined) {
  return value || '—'
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function StatusPill({ row }: { row: WorkspaceRow }) {
  const danger = row.hasErrors
  const warning = row.primaryStatus === 'WARNING'
  return (
    <span
      className={[
        'inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
        danger
          ? 'border-[#8f4747] bg-[#512b2b] text-[#ffd7d7]'
          : warning
            ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
            : 'border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--muted-strong)]',
      ].join(' ')}
    >
      {statusLabel(row.primaryStatus)}
    </span>
  )
}

function filterForGroup(
  filters: ImporterV2WorkspaceFilters,
  groupBy: ImporterV2WorkspaceGroup,
  value: string,
): ImporterV2WorkspaceFilters | null {
  if (value === '(blank)') return null
  switch (groupBy) {
    case 'status':
      return { ...filters, status: value }
    case 'repeatClassification':
      return {
        ...filters,
        repeatClassification:
          value as ImporterV2WorkspaceFilters['repeatClassification'],
      }
    case 'customer':
      return { ...filters, customer: value }
    case 'businessUnit':
      return { ...filters, businessUnit: value }
    case 'site':
      return { ...filters, site: value }
    case 'vendor':
      return { ...filters, vendor: value }
    case 'deviceType':
      return { ...filters, deviceType: value }
    case 'sourceModel':
      return { ...filters, sourceModel: value }
    case 'canonicalModel':
      return { ...filters, canonicalModel: value }
    case 'firmwareEvidencePattern':
      return { ...filters, firmwareEvidencePattern: value }
  }
}

function groupFilterValue(
  filters: ImporterV2WorkspaceFilters,
  groupBy: ImporterV2WorkspaceGroup,
) {
  switch (groupBy) {
    case 'status':
      return filters.status
    case 'repeatClassification':
      return filters.repeatClassification
    case 'customer':
      return filters.customer
    case 'businessUnit':
      return filters.businessUnit
    case 'site':
      return filters.site
    case 'vendor':
      return filters.vendor
    case 'deviceType':
      return filters.deviceType
    case 'sourceModel':
      return filters.sourceModel
    case 'canonicalModel':
      return filters.canonicalModel
    case 'firmwareEvidencePattern':
      return filters.firmwareEvidencePattern
  }
}

function withoutGroupFilter(
  filters: ImporterV2WorkspaceFilters,
  groupBy: ImporterV2WorkspaceGroup,
): ImporterV2WorkspaceFilters {
  switch (groupBy) {
    case 'status':
      return { ...filters, status: null }
    case 'repeatClassification':
      return { ...filters, repeatClassification: null }
    case 'customer':
      return { ...filters, customer: null }
    case 'businessUnit':
      return { ...filters, businessUnit: null }
    case 'site':
      return { ...filters, site: null }
    case 'vendor':
      return { ...filters, vendor: null }
    case 'deviceType':
      return { ...filters, deviceType: null }
    case 'sourceModel':
      return { ...filters, sourceModel: null }
    case 'canonicalModel':
      return { ...filters, canonicalModel: null }
    case 'firmwareEvidencePattern':
      return { ...filters, firmwareEvidencePattern: null }
  }
}

function workspaceSearchParams(
  page: number,
  groupBy: ImporterV2WorkspaceGroup | null,
  filters: ImporterV2WorkspaceFilters,
) {
  const params = new URLSearchParams({ page: String(page), pageSize: '100' })
  if (groupBy) params.set('groupBy', groupBy)
  if (filters.search) params.set('q', filters.search)
  if (filters.status) params.set('status', filters.status)
  if (filters.issue) params.set('issue', filters.issue)
  if (filters.customer) params.set('customer', filters.customer)
  if (filters.businessUnit) params.set('businessUnit', filters.businessUnit)
  if (filters.site) params.set('site', filters.site)
  if (filters.vendor) params.set('vendor', filters.vendor)
  if (filters.deviceType) params.set('deviceType', filters.deviceType)
  if (filters.sourceModel) params.set('sourceModel', filters.sourceModel)
  if (filters.canonicalModel) params.set('canonicalModel', filters.canonicalModel)
  if (filters.firmwareEvidencePattern) {
    params.set('firmwareEvidencePattern', filters.firmwareEvidencePattern)
  }
  if (filters.repeatClassification) {
    params.set('repeat', filters.repeatClassification)
  }
  return params
}

export function ImporterV2WorkspaceShell({ batchId }: { batchId: string }) {
  const [filters, setFilters] =
    useState<ImporterV2WorkspaceFilters>(EMPTY_FILTERS)
  const [groupBy, setGroupBy] =
    useState<ImporterV2WorkspaceGroup | null>('customer')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [querySelection, setQuerySelection] =
    useState<ImporterV2WorkspaceFilters | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [loadedDetail, setLoadedDetail] = useState<RowDetail | null>(null)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = workspaceSearchParams(page, groupBy, filters)
        const response = await fetch(
          `/api/v1/device-import-v2/batches/${batchId}/workspace?${params}`,
          { cache: 'no-store' },
        )
        const workspace = await responseData<WorkspaceData>(response)
        if (!cancelled) setData(workspace)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load importer workspace.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [batchId, page, groupBy, filters, refreshKey])

  const explicitSelection = useMemo(
    () => [...selectedRows].sort((left, right) => left - right),
    [selectedRows],
  )
  const selection: ImporterV2WorkspaceSelection | null = querySelection
    ? { mode: 'QUERY', filters: querySelection }
    : explicitSelection.length
      ? { mode: 'ROWS', rowNumbers: explicitSelection }
      : null
  const selectedCount = querySelection
    ? (data?.total ?? 0)
    : explicitSelection.length
  const inspectedRowNumber =
    !querySelection && explicitSelection.length === 1
      ? explicitSelection[0]
      : null
  const detail =
    inspectedRowNumber !== null && loadedDetail?.rowNumber === inspectedRowNumber
      ? loadedDetail
      : null
  const detailLoading = inspectedRowNumber !== null && detail === null

  useEffect(() => {
    let cancelled = false
    if (inspectedRowNumber === null) return
    void fetch(
      `/api/v1/device-import-v2/batches/${batchId}/rows/${inspectedRowNumber}`,
      { cache: 'no-store' },
    )
      .then((response) => responseData<RowDetail>(response))
      .then((row) => {
        if (!cancelled) setLoadedDetail(row)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load staged row detail.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [batchId, inspectedRowNumber, refreshKey])

  const updateFilters = (patch: Partial<ImporterV2WorkspaceFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const inspectOnly = (rowNumber: number) => {
    setQuerySelection(null)
    setSelectedRows(new Set([rowNumber]))
  }

  const toggleRow = (rowNumber: number) => {
    setQuerySelection(null)
    setSelectedRows((current) => {
      const next = new Set(current)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

  const allPageSelected =
    Boolean(data?.rows.length) &&
    data!.rows.every((row) => selectedRows.has(row.rowNumber)) &&
    !querySelection

  const jumpToFirstIssue = () => {
    const row = data?.rows.find((candidate) => candidate.issueCount > 0)
    if (!row) return
    inspectOnly(row.rowNumber)
    requestAnimationFrame(() => rowRefs.current.get(row.rowNumber)?.focus())
  }

  const selectionLabel = querySelection
    ? `${data?.total.toLocaleString() ?? 0} devices selected across all matching results.`
    : explicitSelection.length === 1
      ? `Staged row #${explicitSelection[0]}`
      : explicitSelection.length > 1
        ? `${explicitSelection.length} explicit rows selected.`
        : 'Select one or more rows to inspect or reconcile.'

  const verifySelectedEvidence = async () => {
    if (!selection) return
    setVerifyBusy(true)
    setVerifyMessage(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/identity/verify`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selection }),
        },
      )
      const result = await responseData<BulkVerificationResult>(response)
      const identityUnresolved = result.manualReviewCount + result.invalidCount
      const firmware = result.firmware
      const parts: string[] = []

      if (result.verifiedCount > 0) {
        parts.push(
          `${result.verifiedCount.toLocaleString()} identity match${result.verifiedCount === 1 ? '' : 'es'} verified`,
        )
      }
      if (result.alreadyResolvedCount > 0) {
        parts.push(
          `${result.alreadyResolvedCount.toLocaleString()} identities already resolved`,
        )
      }
      if (identityUnresolved > 0) {
        parts.push(
          `${identityUnresolved.toLocaleString()} identity row${identityUnresolved === 1 ? '' : 's'} need manual review`,
        )
      }
      if (firmware.verifiedCount > 0) {
        parts.push(
          `${firmware.verifiedCount.toLocaleString()} observed firmware value${firmware.verifiedCount === 1 ? '' : 's'} verified`,
        )
      }
      if (firmware.alreadyVerifiedCount > 0) {
        parts.push(
          `${firmware.alreadyVerifiedCount.toLocaleString()} firmware value${firmware.alreadyVerifiedCount === 1 ? '' : 's'} already verified`,
        )
      }
      if (firmware.alreadyTrustedCount > 0) {
        parts.push(
          `${firmware.alreadyTrustedCount.toLocaleString()} firmware value${firmware.alreadyTrustedCount === 1 ? '' : 's'} already trusted`,
        )
      }
      if (firmware.manualReviewCount > 0) {
        parts.push(
          `${firmware.manualReviewCount.toLocaleString()} firmware row${firmware.manualReviewCount === 1 ? '' : 's'} need manual review`,
        )
      }
      if (firmware.notApplicableCount > 0) {
        parts.push(
          `${firmware.notApplicableCount.toLocaleString()} row${firmware.notApplicableCount === 1 ? '' : 's'} have no firmware evidence`,
        )
      }
      const alreadyPublished = Math.max(
        result.publishedCount,
        firmware.publishedCount,
      )
      if (alreadyPublished > 0) {
        parts.push(`${alreadyPublished.toLocaleString()} already published`)
      }
      if (parts.length === 0) parts.push('Selected evidence required no changes')

      setVerifyMessage(`${parts.join(' · ')}.`)
      setRefreshKey((key) => key + 1)
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : 'Unable to verify selected device evidence.',
      )
    } finally {
      setVerifyBusy(false)
    }
  }

  const groupLabel =
    GROUPS.find((group) => group.value === groupBy)?.label ?? 'None'
  const activeGroupValue = groupBy ? groupFilterValue(filters, groupBy) : null

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Importer v2"
        title={data?.batch.name ?? 'Device reconciliation'}
        description={
          data
            ? `${data.batch.provider} · Profile v${data.batch.profileVersion} · ${data.batch.rowCount.toLocaleString()} staged rows. Every correction remains staged; canonical publication is separate.`
            : 'One server-paginated workspace for the full staged batch.'
        }
        actions={
          <Link
            href="/devices/import"
            className="text-sm font-semibold text-[var(--accent-light)] hover:underline"
          >
            All batches
          </Link>
        }
      />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-[#8f4747] bg-[#512b2b] px-4 py-3 text-sm text-[#ffd7d7]"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => updateFilters({ issue: 'ERROR' })}
          className="rounded-md border border-[#8f4747] bg-[#512b2b] px-3 py-2 text-sm font-semibold text-[#ffd7d7]"
        >
          {data?.summary.errorCount ?? 0} errors
        </button>
        <button
          type="button"
          onClick={() => updateFilters({ issue: 'WARNING' })}
          className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--muted-strong)]"
        >
          {data?.summary.warningCount ?? 0} warnings
        </button>
        <Button
          variant="ghost"
          onClick={jumpToFirstIssue}
          disabled={!data || data.rows.every((row) => row.issueCount === 0)}
        >
          Jump to first visible issue
        </Button>
        {filters.issue || filters.status || filters.repeatClassification ? (
          <Button
            variant="ghost"
            onClick={() => {
              setFilters((current) => ({
                ...current,
                issue: null,
                status: groupBy === 'status' ? current.status : null,
                repeatClassification:
                  groupBy === 'repeatClassification'
                    ? current.repeatClassification
                    : null,
              }))
              setPage(1)
            }}
          >
            Clear status filters
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_180px]">
        <TextInput
          aria-label="Search all staged devices"
          placeholder="Search device, customer, model or firmware…"
          value={filters.search ?? ''}
          onChange={(event) =>
            updateFilters({ search: event.target.value || null })
          }
        />
        <SelectInput
          aria-label="Group staged devices"
          value={groupBy ?? ''}
          onChange={(event) => {
            setGroupBy(
              (event.target.value || null) as ImporterV2WorkspaceGroup | null,
            )
            setExpandedGroups(new Set())
            setPage(1)
          }}
        >
          <option value="">No grouping</option>
          {GROUPS.map((group) => (
            <option key={group.value} value={group.value}>
              {group.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Repeat-import classification"
          value={filters.repeatClassification ?? ''}
          onChange={(event) =>
            updateFilters({
              repeatClassification: (event.target.value ||
                null) as ImporterV2WorkspaceFilters['repeatClassification'],
            })
          }
        >
          <option value="">All repeat states</option>
          {[
            'NEW',
            'CHANGED',
            'UNCHANGED',
            'MOVED',
            'RENAMED',
            'MISSING',
            'AMBIGUOUS',
          ].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Issue filter"
          value={filters.issue ?? ''}
          onChange={(event) =>
            updateFilters({
              issue: (event.target.value ||
                null) as ImporterV2WorkspaceFilters['issue'],
            })
          }
        >
          <option value="">All issue states</option>
          <option value="ERROR">Errors</option>
          <option value="WARNING">Warnings</option>
          <option value="NONE">No issues</option>
        </SelectInput>
      </div>

      {groupBy && data?.groups.length ? (
        <section
          aria-label={`Groups by ${groupLabel}`}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                Grouped by {groupLabel}
              </h2>
              {activeGroupValue ? (
                <p className="mt-1 text-xs text-[var(--muted-strong)]">
                  Showing only {groupLabel}: <strong>{activeGroupValue}</strong>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-[var(--muted)]">
                Counts are server-side across the full filtered batch
              </span>
              {activeGroupValue ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFilters((current) => withoutGroupFilter(current, groupBy))
                    setExpandedGroups(new Set())
                    setSelectedRows(new Set())
                    setQuerySelection(null)
                    setPage(1)
                  }}
                >
                  Back to all {groupLabel} groups
                </Button>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.groups.map((group) => {
              const key = `${groupBy}:${group.value}`
              const expanded = expandedGroups.has(key)
              const scoped = filterForGroup(filters, groupBy, group.value)
              const showingThisGroup = activeGroupValue === group.value
              return (
                <div
                  key={key}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2.5"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedGroups((current) => {
                        const next = new Set(current)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {group.value}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                      {group.count.toLocaleString()} · {group.issueCount} issues
                    </span>
                  </button>
                  {expanded ? (
                    <div className="mt-2 flex flex-wrap gap-2 border-t border-[var(--border)] pt-2">
                      <Button
                        variant="ghost"
                        disabled={!scoped || showingThisGroup}
                        onClick={() => {
                          if (scoped) {
                            setFilters(scoped)
                            setExpandedGroups(new Set())
                            setSelectedRows(new Set())
                            setQuerySelection(null)
                            setPage(1)
                          }
                        }}
                      >
                        {showingThisGroup ? 'Showing group' : 'Show only'}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!scoped}
                        onClick={() => {
                          if (scoped) {
                            setSelectedRows(new Set())
                            setQuerySelection(scoped)
                          }
                        }}
                      >
                        Select all {group.count.toLocaleString()}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="grid min-h-0 min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section
          className="min-h-0 min-w-0 space-y-3"
          aria-label="Staged device grid"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!data?.rows.length}
                onClick={() => {
                  setQuerySelection(null)
                  setSelectedRows((current) => {
                    const next = new Set(current)
                    if (allPageSelected) {
                      data?.rows.forEach((row) => next.delete(row.rowNumber))
                    } else {
                      data?.rows.forEach((row) => next.add(row.rowNumber))
                    }
                    return next
                  })
                }}
              >
                {allPageSelected ? 'Clear visible' : 'Select visible page'}
              </Button>
              <Button
                variant="secondary"
                disabled={!data?.total}
                onClick={() => {
                  setSelectedRows(new Set())
                  setQuerySelection({ ...filters })
                }}
              >
                Select all {data?.total.toLocaleString() ?? 0} matching
              </Button>
              {selection ? (
                <Button
                  variant="primary"
                  disabled={verifyBusy}
                  onClick={() => void verifySelectedEvidence()}
                >
                  {verifyBusy
                    ? 'Verifying…'
                    : `Verify selected (${selectedCount.toLocaleString()})`}
                </Button>
              ) : null}
              {selection ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelectedRows(new Set())
                    setQuerySelection(null)
                    setVerifyMessage(null)
                  }}
                >
                  Clear selection
                </Button>
              ) : null}
            </div>
            {querySelection ? (
              <span className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-light)]">
                {data?.total.toLocaleString() ?? 0} devices selected across all matching results
              </span>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                {selectedRows.size} selected · {data?.total.toLocaleString() ?? 0} matching
              </span>
            )}
          </div>

          {verifyMessage ? (
            <div
              role="status"
              className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--muted-strong)]"
            >
              {verifyMessage}
            </div>
          ) : null}

          <div className="noc-scrollbar min-h-0 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[2050px] border-collapse text-left text-xs">
              <caption className="sr-only">
                Staged devices in the current importer workspace
              </caption>
              <thead className="sticky top-0 z-10 bg-[var(--surface-raised)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2">Select</th>
                  <th className="px-2 py-2">Row / status</th>
                  <th className="px-2 py-2">Device</th>
                  <th className="px-2 py-2">Customer → Subdomain → Site</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Source model</th>
                  <th className="px-2 py-2">Canonical model</th>
                  <th className="px-2 py-2">Family / platform</th>
                  <th className="px-2 py-2">Firmware Version</th>
                  <th className="px-2 py-2">Software Version</th>
                  <th className="px-2 py-2">Running firmware</th>
                  <th className="px-2 py-2">Confidence</th>
                  <th className="px-2 py-2">Issues</th>
                  <th className="px-2 py-2">Repeat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {loading && !data ? (
                  <tr>
                    <td colSpan={14} className="p-6 text-center text-sm text-[var(--muted)]">
                      Loading staged devices…
                    </td>
                  </tr>
                ) : null}
                {!loading && data?.rows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="p-6 text-center text-sm text-[var(--muted)]">
                      No rows match the current filters.
                    </td>
                  </tr>
                ) : null}
                {data?.rows.map((row) => {
                  const selected = Boolean(querySelection) || selectedRows.has(row.rowNumber)
                  return (
                    <tr
                      key={row.rowNumber}
                      ref={(node) => {
                        if (node) rowRefs.current.set(row.rowNumber, node)
                        else rowRefs.current.delete(row.rowNumber)
                      }}
                      tabIndex={0}
                      aria-selected={selected}
                      onKeyDown={(event) => {
                        if (querySelection) return
                        if (event.currentTarget !== event.target) return
                        if (event.key === ' ' || event.key === 'Enter') {
                          event.preventDefault()
                          toggleRow(row.rowNumber)
                        }
                      }}
                      className={
                        selected
                          ? 'bg-[var(--accent-soft)] outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--accent)]'
                          : 'outline-none hover:bg-[var(--surface-muted)] focus:ring-2 focus:ring-inset focus:ring-[var(--accent)]'
                      }
                    >
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={Boolean(querySelection)}
                          onChange={() => toggleRow(row.rowNumber)}
                          aria-label={`Select staged row ${row.rowNumber}`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => inspectOnly(row.rowNumber)}
                          className="font-semibold text-[var(--accent-light)] hover:underline"
                        >
                          #{row.rowNumber}
                        </button>
                        <div className="mt-1">
                          <StatusPill row={row} />
                          {row.needsReevaluation && row.primaryStatus !== 'RECHECK_REQUIRED' ? (
                            <span className="mt-1 block text-[10px] text-[var(--muted)]">
                              Recheck pending
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span className="font-semibold text-[var(--foreground)]">
                          {display(row.sourceName)}
                        </span>
                        <span className="mt-0.5 block text-[var(--muted)]">
                          {display(row.hostname)}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top text-[var(--muted-strong)]">
                        {display(row.customer)} → {display(row.businessUnit)} → {display(row.site)}
                      </td>
                      <td className="px-2 py-2 align-top">{display(row.deviceType)}</td>
                      <td className="px-2 py-2 align-top">{display(row.sourceModel)}</td>
                      <td className="px-2 py-2 align-top font-medium text-[var(--foreground)]">
                        {display(row.canonicalModel)}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {display(row.productFamily)}
                        <span className="mt-0.5 block text-[var(--muted)]">
                          {display(row.softwarePlatform)}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top font-mono">{display(row.rawFirmwareVersion)}</td>
                      <td className="px-2 py-2 align-top font-mono">{display(row.rawSoftwareVersion)}</td>
                      <td className="px-2 py-2 align-top font-mono text-[var(--foreground)]">
                        {display(row.interpretedFirmware)}
                        {row.needsReevaluation ? (
                          <span className="mt-1 block font-sans text-[10px] text-[var(--accent-light)]">
                            Previous evaluation
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top">{display(row.confidence)}</td>
                      <td className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => inspectOnly(row.rowNumber)}
                          className={
                            row.hasErrors
                              ? 'font-semibold text-[#f0a0a0] hover:underline'
                              : 'text-[var(--muted-strong)] hover:underline'
                          }
                        >
                          {row.issueCount}
                        </button>
                      </td>
                      <td className="px-2 py-2 align-top">{display(row.repeatClassification)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              disabled={!data || page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-[var(--muted)]">
              Page {data?.page ?? page} of {data?.pageCount ?? 1} · 100 rows/page
            </span>
            <Button
              variant="secondary"
              disabled={!data || page >= data.pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </section>

        <ImporterV2Inspector
          batchId={batchId}
          selection={selection}
          selectionLabel={selectionLabel}
          detail={detail}
          detailLoading={detailLoading}
          onRefresh={() => setRefreshKey((key) => key + 1)}
        />
      </div>
    </div>
  )
}
