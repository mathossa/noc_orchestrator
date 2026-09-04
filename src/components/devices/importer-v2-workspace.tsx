'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { ImporterV2Field } from '@/lib/importer-v2-evaluator'
import type {
  ImporterV2WorkspaceAction,
  ImporterV2WorkspaceFilters,
  ImporterV2WorkspaceGroup,
  ImporterV2WorkspaceSelection,
} from '@/lib/importer-v2-workspace'

const CLIENT_FIELDS: readonly ImporterV2Field[] = [
  'customer',
  'businessUnit',
  'site',
  'deviceName',
  'hostname',
  'sourceId',
  'serialNumber',
  'macAddress',
  'vendor',
  'productFamily',
  'softwarePlatform',
  'model',
  'deviceType',
  'managementAddress',
  'currentFirmware',
  'firmwareVersion',
  'softwareVersion',
  'notes',
]

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

const ACTIONS = [
  ['SET_FIELD', 'Set field'],
  ['LINK_FIELD', 'Link canonical value'],
  ['CLEAR_FIELD', 'Clear field'],
  ['IGNORE_FIELD', 'Ignore source field'],
  ['EXCLUDE_ROW', 'Exclude row/device'],
  ['REMEMBER_EXACT', 'Remember exact mapping'],
  ['CREATE_SCOPED_RULE', 'Create scoped rule'],
] as const

type ActionKind = (typeof ACTIONS)[number][0]
type RuleScopeDimension =
  | 'customer'
  | 'businessUnit'
  | 'site'
  | 'vendor'
  | 'model'
  | 'productFamily'
  | 'deviceType'

type WorkspaceRow = {
  rowNumber: number
  inclusion: string
  statuses: string[]
  primaryStatus: string
  repeatClassification: string | null
  issueCount: number
  hasErrors: boolean
  needsReevaluation: boolean
  sourceName: string | null
  hostname: string | null
  customer: string | null
  businessUnit: string | null
  site: string | null
  vendor: string | null
  deviceType: string | null
  sourceModel: string | null
  canonicalModel: string | null
  productFamily: string | null
  softwarePlatform: string | null
  firmwareEvidencePattern: string | null
  rawFirmwareVersion: string | null
  rawSoftwareVersion: string | null
  interpretedFirmware: string | null
  confidence: string | null
}

type WorkspaceData = {
  batch: {
    id: string
    name: string
    provider: string
    profileId: string
    profileVersion: string
    status: string
    rowCount: number
  }
  page: number
  pageSize: number
  total: number
  pageCount: number
  rows: WorkspaceRow[]
  groups: { value: string; count: number; issueCount: number }[]
  summary: { errorCount: number; warningCount: number }
}

type EvaluatedField = {
  proposedValue?: { id: string | null; label: string } | null
  decision?: {
    source?: string
    confidence?: string
    explanation?: string
    matchedRuleId?: string | null
    matchedRuleVersion?: string | null
    matchedParserId?: string | null
    matchedParserVersion?: string | null
  }
}

type RowDetail = WorkspaceRow & {
  evaluated: {
    rawValues?: Record<string, string | null>
    proposedCanonicalValues?: Record<
      string,
      { id: string | null; label: string } | null
    >
    fields?: Record<string, EvaluatedField>
    issues?: Array<{
      field?: string
      severity?: string
      code?: string
      message?: string
    }>
    comparisonRecordId?: string | null
  }
  identityResolution?: unknown
  alternatives?: unknown
  repeatDiff?: unknown
  decisions?: Array<{
    id: string
    field: string | null
    action: string
    explanation: string
    createdAt: string
  }>
}

type ActionPreview = {
  scopeToken: string
  affectedRowCount: number
  sample: Array<{
    rowNumber: number
    sourceName: string | null
    customer: string | null
    businessUnit: string | null
    site: string | null
    sourceModel: string | null
    canonicalModel: string | null
    interpretedFirmware: string | null
  }>
  commonValues: Partial<Record<ImporterV2Field, string | null | 'MIXED'>>
  confirmationReasons: string[]
  contextVersion: string | null
}

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

function display(value: string | null | undefined) {
  return value || '—'
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    businessUnit: 'Subdomain',
    deviceName: 'Device name',
    sourceId: 'Source ID',
    serialNumber: 'Serial number',
    macAddress: 'MAC address',
    productFamily: 'Product family',
    softwarePlatform: 'Software platform',
    deviceType: 'Device type',
    managementAddress: 'Management address',
    currentFirmware: 'Running firmware',
    firmwareVersion: 'Raw Firmware Version',
    softwareVersion: 'Raw Software Version',
  }
  return (
    labels[field] ??
    field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase())
  )
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Request failed.')
  }
  return body.data as T
}

function StatusPill({
  children,
  danger = false,
}: {
  children: string
  danger?: boolean
}) {
  return (
    <span
      className={[
        'inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
        danger
          ? 'border-[#8f4747] bg-[#512b2b] text-[#ffd7d7]'
          : 'border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--muted-strong)]',
      ].join(' ')}
    >
      {children}
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

export function ImporterV2Workspace({ batchId }: { batchId: string }) {
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
  const [detail, setDetail] = useState<RowDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionKind, setActionKind] = useState<ActionKind>('SET_FIELD')
  const [actionField, setActionField] = useState<ImporterV2Field>('model')
  const [targetLabel, setTargetLabel] = useState('')
  const [targetId, setTargetId] = useState('')
  const [explanation, setExplanation] = useState(
    'Engineer reconciliation decision',
  )
  const [sourceValue, setSourceValue] = useState('')
  const [ruleScopeDimension, setRuleScopeDimension] =
    useState<RuleScopeDimension>('model')
  const [ruleScopeValue, setRuleScopeValue] = useState('')
  const [preview, setPreview] = useState<ActionPreview | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
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
    () => [...selectedRows].sort((a, b) => a - b),
    [selectedRows],
  )
  const selection: ImporterV2WorkspaceSelection | null = querySelection
    ? { mode: 'QUERY', filters: querySelection }
    : explicitSelection.length > 0
      ? { mode: 'ROWS', rowNumbers: explicitSelection }
      : null

  useEffect(() => {
    let cancelled = false
    if (querySelection || explicitSelection.length !== 1) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    void fetch(
      `/api/v1/device-import-v2/batches/${batchId}/rows/${explicitSelection[0]}`,
      { cache: 'no-store' },
    )
      .then((response) => responseData<RowDetail>(response))
      .then((row) => {
        if (!cancelled) setDetail(row)
      })
      .catch((detailError) => {
        if (!cancelled) {
          setActionMessage(
            detailError instanceof Error
              ? detailError.message
              : 'Unable to load row detail.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [batchId, explicitSelection, querySelection, refreshKey])

  const action = useMemo<ImporterV2WorkspaceAction | null>(() => {
    const target = { id: targetId.trim() || null, label: targetLabel.trim() }
    if (actionKind === 'EXCLUDE_ROW') {
      return { type: 'EXCLUDE_ROW', explanation }
    }
    if (actionKind === 'CLEAR_FIELD' || actionKind === 'IGNORE_FIELD') {
      return { type: actionKind, field: actionField, explanation }
    }
    if (actionKind === 'SET_FIELD' || actionKind === 'LINK_FIELD') {
      return target.label
        ? { type: actionKind, field: actionField, value: target, explanation }
        : null
    }
    if (actionKind === 'REMEMBER_EXACT') {
      return target.label && sourceValue.trim()
        ? {
            type: 'REMEMBER_EXACT',
            field: actionField,
            normalizedInput: sourceValue.trim(),
            value: target,
            explanation,
          }
        : null
    }
    if (!target.label || !sourceValue.trim() || !ruleScopeValue.trim()) {
      return null
    }
    return {
      type: 'CREATE_SCOPED_RULE',
      field: actionField,
      sourceValue: sourceValue.trim(),
      value: target,
      scope: { [ruleScopeDimension]: [ruleScopeValue.trim()] },
      explanation,
    }
  }, [
    actionKind,
    actionField,
    targetId,
    targetLabel,
    explanation,
    sourceValue,
    ruleScopeDimension,
    ruleScopeValue,
  ])

  useEffect(() => {
    setPreview(null)
    setActionMessage(null)
  }, [
    actionKind,
    actionField,
    targetId,
    targetLabel,
    explanation,
    sourceValue,
    ruleScopeDimension,
    ruleScopeValue,
    querySelection,
    explicitSelection,
  ])

  const updateFilters = (patch: Partial<ImporterV2WorkspaceFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
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

  const inspectOnly = (rowNumber: number) => {
    setQuerySelection(null)
    setSelectedRows(new Set([rowNumber]))
  }

  const previewAction = async () => {
    if (!selection || !action) return
    setActionBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/actions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'PREVIEW', selection, action }),
        },
      )
      setPreview(await responseData<ActionPreview>(response))
    } catch (previewError) {
      setActionMessage(
        previewError instanceof Error
          ? previewError.message
          : 'Unable to preview action.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  const applyAction = async () => {
    if (!selection || !action || !preview) return
    setActionBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/actions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'APPLY',
            selection,
            action,
            scopeToken: preview.scopeToken,
          }),
        },
      )
      const result = await responseData<{ affectedRowCount: number }>(response)
      setActionMessage(
        `Applied to ${result.affectedRowCount.toLocaleString()} staged row${result.affectedRowCount === 1 ? '' : 's'}. Re-evaluation is flagged where required.`,
      )
      setPreview(null)
      setRefreshKey((key) => key + 1)
    } catch (applyError) {
      setPreview(null)
      setActionMessage(
        applyError instanceof Error
          ? applyError.message
          : 'Unable to apply action.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  const groupLabel =
    GROUPS.find((group) => group.value === groupBy)?.label ?? 'None'
  const allPageSelected =
    Boolean(data?.rows.length) &&
    data!.rows.every((row) => selectedRows.has(row.rowNumber)) &&
    !querySelection

  const setIssueFilter = (issue: 'ERROR' | 'WARNING') => {
    updateFilters({ issue })
    setQuerySelection(null)
  }

  const jumpToFirstIssue = () => {
    const row = data?.rows.find((candidate) => candidate.issueCount > 0)
    if (!row) return
    inspectOnly(row.rowNumber)
    requestAnimationFrame(() => rowRefs.current.get(row.rowNumber)?.focus())
  }

  const rawSourceValue = detail?.evaluated.rawValues?.[actionField] ?? null
  const previewCommonValues = preview
    ? CLIENT_FIELDS.map((field) => [field, preview.commonValues[field]] as const)
        .filter(([, value]) => value !== undefined)
        .slice(0, 10)
    : []

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
          onClick={() => setIssueFilter('ERROR')}
          className="rounded-md border border-[#8f4747] bg-[#512b2b] px-3 py-2 text-sm font-semibold text-[#ffd7d7]"
        >
          {data?.summary.errorCount ?? 0} errors
        </button>
        <button
          type="button"
          onClick={() => setIssueFilter('WARNING')}
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
              setFilters(EMPTY_FILTERS)
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
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Grouped by {groupLabel}
            </h2>
            <span className="text-xs text-[var(--muted)]">
              Counts are server-side across the full filtered batch
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.groups.slice(0, 24).map((group) => {
              const key = `${groupBy}:${group.value}`
              const expanded = expandedGroups.has(key)
              const scoped = filterForGroup(filters, groupBy, group.value)
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
                        disabled={!scoped}
                        onClick={() => {
                          if (scoped) {
                            setFilters(scoped)
                            setPage(1)
                          }
                        }}
                      >
                        Show group
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

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="min-w-0 space-y-3" aria-label="Staged device grid">
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
                  variant="ghost"
                  onClick={() => {
                    setSelectedRows(new Set())
                    setQuerySelection(null)
                  }}
                >
                  Clear selection
                </Button>
              ) : null}
            </div>
            <span className="text-xs text-[var(--muted)]">
              {querySelection
                ? 'Server-wide selection'
                : `${selectedRows.size} selected`}{' '}
              · {data?.total.toLocaleString() ?? 0} matching
            </span>
          </div>

          <div className="noc-scrollbar overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[2050px] border-collapse text-left text-xs">
              <caption className="sr-only">
                All staged devices in the current server-paginated importer workspace
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
                    <td
                      colSpan={14}
                      className="p-6 text-center text-sm text-[var(--muted)]"
                    >
                      Loading staged devices…
                    </td>
                  </tr>
                ) : null}
                {!loading && data?.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={14}
                      className="p-6 text-center text-sm text-[var(--muted)]"
                    >
                      No rows match the current filters.
                    </td>
                  </tr>
                ) : null}
                {data?.rows.map((row) => {
                  const selected = querySelection
                    ? false
                    : selectedRows.has(row.rowNumber)
                  return (
                    <tr
                      key={row.rowNumber}
                      ref={(node) => {
                        if (node) rowRefs.current.set(row.rowNumber, node)
                        else rowRefs.current.delete(row.rowNumber)
                      }}
                      tabIndex={0}
                      aria-selected={querySelection ? undefined : selected}
                      onKeyDown={(event) => {
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
                          <StatusPill danger={row.hasErrors}>
                            {row.primaryStatus}
                          </StatusPill>
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
                        {display(row.customer)} → {display(row.businessUnit)} →{' '}
                        {display(row.site)}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {display(row.deviceType)}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {display(row.sourceModel)}
                      </td>
                      <td className="px-2 py-2 align-top font-medium text-[var(--foreground)]">
                        {display(row.canonicalModel)}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {display(row.productFamily)}
                        <span className="mt-0.5 block text-[var(--muted)]">
                          {display(row.softwarePlatform)}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-top font-mono">
                        {display(row.rawFirmwareVersion)}
                      </td>
                      <td className="px-2 py-2 align-top font-mono">
                        {display(row.rawSoftwareVersion)}
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-[var(--foreground)]">
                        {display(row.interpretedFirmware)}
                        {row.needsReevaluation ? (
                          <span className="mt-1 block font-sans text-[10px] text-[var(--accent-light)]">
                            Re-evaluate
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {display(row.confidence)}
                      </td>
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
                      <td className="px-2 py-2 align-top">
                        {display(row.repeatClassification)}
                      </td>
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

        <aside
          className="self-start rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 xl:sticky xl:top-4"
          aria-label="Reconciliation inspector"
        >
          <div className="border-b border-[var(--border)] pb-3">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              Inspector
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {querySelection
                ? 'A full server-side filter/group scope is selected.'
                : explicitSelection.length === 1
                  ? `Staged row #${explicitSelection[0]}`
                  : explicitSelection.length > 1
                    ? `${explicitSelection.length} explicit rows selected.`
                    : 'Select one or more rows to inspect or reconcile.'}
            </p>
          </div>

          {detailLoading ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              Loading raw evidence and decision proof…
            </p>
          ) : null}

          {detail ? (
            <div className="max-h-[48vh] space-y-4 overflow-y-auto py-4 pr-1">
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Existing match
                </h3>
                <p className="mt-1 text-sm text-[var(--foreground)]">
                  {detail.evaluated.comparisonRecordId
                    ? `Canonical device ${detail.evaluated.comparisonRecordId}`
                    : 'No confirmed canonical comparison record'}
                </p>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Raw source evidence
                </h3>
                <dl className="mt-2 space-y-1.5">
                  {CLIENT_FIELDS.map((field) => (
                    <div
                      key={field}
                      className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-xs"
                    >
                      <dt className="text-[var(--muted)]">{fieldLabel(field)}</dt>
                      <dd className="break-words font-mono text-[var(--muted-strong)]">
                        {display(detail.evaluated.rawValues?.[field])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  Proposals and decision proof
                </h3>
                <div className="mt-2 space-y-2">
                  {CLIENT_FIELDS.map((field) => {
                    const evaluatedField = detail.evaluated.fields?.[field]
                    if (!evaluatedField?.proposedValue && !evaluatedField?.decision) {
                      return null
                    }
                    return (
                      <div
                        key={field}
                        className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs"
                      >
                        <div className="flex justify-between gap-2">
                          <strong className="text-[var(--foreground)]">
                            {fieldLabel(field)}
                          </strong>
                          <span className="text-[var(--accent-light)]">
                            {evaluatedField.proposedValue?.label ?? 'Unresolved'}
                          </span>
                        </div>
                        <p className="mt-1 text-[var(--muted)]">
                          {evaluatedField.decision?.source ?? 'UNRESOLVED'} ·{' '}
                          {evaluatedField.decision?.confidence ?? '—'}
                        </p>
                        <p className="mt-1 leading-5 text-[var(--muted-strong)]">
                          {evaluatedField.decision?.explanation ??
                            'No decision explanation available.'}
                        </p>
                        {evaluatedField.decision?.matchedRuleId ||
                        evaluatedField.decision?.matchedParserId ? (
                          <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                            Rule {evaluatedField.decision?.matchedRuleId ?? '—'} v
                            {evaluatedField.decision?.matchedRuleVersion ?? '—'} · Parser{' '}
                            {evaluatedField.decision?.matchedParserId ?? '—'} v
                            {evaluatedField.decision?.matchedParserVersion ?? '—'}
                          </p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>

              {detail.evaluated.issues?.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Errors and warnings
                  </h3>
                  <div className="mt-2 space-y-2">
                    {detail.evaluated.issues.map((issue, index) => (
                      <div
                        key={`${issue.field}-${index}`}
                        className="rounded border border-[var(--border)] p-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={
                              issue.severity === 'ERROR'
                                ? 'font-semibold text-[#f0a0a0]'
                                : 'font-semibold text-[var(--accent-light)]'
                            }
                          >
                            {issue.severity} · {fieldLabel(issue.field ?? 'row')}
                          </span>
                          {issue.field &&
                          CLIENT_FIELDS.includes(issue.field as ImporterV2Field) ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActionKind('SET_FIELD')
                                setActionField(issue.field as ImporterV2Field)
                                setTargetLabel('')
                              }}
                              className="text-[var(--accent-light)] hover:underline"
                            >
                              Correct field
                            </button>
                          ) : null}
                        </div>
                        <p className="mt-1 leading-5 text-[var(--muted-strong)]">
                          {issue.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {detail.identityResolution ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Identity candidates and durable evidence
                  </h3>
                  <pre className="noc-scrollbar mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[10px] leading-4 text-[var(--muted-strong)]">
                    {JSON.stringify(detail.identityResolution, null, 2)}
                  </pre>
                </section>
              ) : null}

              {detail.alternatives ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Alternative suggestions
                  </h3>
                  <pre className="noc-scrollbar mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--background)] p-2 text-[10px] leading-4 text-[var(--muted-strong)]">
                    {JSON.stringify(detail.alternatives, null, 2)}
                  </pre>
                </section>
              ) : null}

              {detail.decisions?.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Review decisions
                  </h3>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--muted-strong)]">
                    {detail.decisions.map((decision) => (
                      <li key={decision.id}>
                        {decision.action}
                        {decision.field ? ` · ${fieldLabel(decision.field)}` : ''}:{' '}
                        {decision.explanation}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {selection ? (
            <section className="space-y-3 border-t border-[var(--border)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Reconcile selection
              </h3>
              <SelectInput
                aria-label="Reconciliation action"
                value={actionKind}
                onChange={(event) =>
                  setActionKind(event.target.value as ActionKind)
                }
              >
                {ACTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>

              {actionKind !== 'EXCLUDE_ROW' ? (
                <SelectInput
                  aria-label="Field to reconcile"
                  value={actionField}
                  onChange={(event) =>
                    setActionField(event.target.value as ImporterV2Field)
                  }
                >
                  {CLIENT_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {fieldLabel(field)}
                    </option>
                  ))}
                </SelectInput>
              ) : null}

              {[
                'SET_FIELD',
                'LINK_FIELD',
                'REMEMBER_EXACT',
                'CREATE_SCOPED_RULE',
              ].includes(actionKind) ? (
                <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
                  <TextInput
                    aria-label="Target label"
                    placeholder="Target label"
                    value={targetLabel}
                    onChange={(event) => setTargetLabel(event.target.value)}
                  />
                  <TextInput
                    aria-label="Canonical target ID"
                    placeholder="ID (optional)"
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                  />
                </div>
              ) : null}

              {actionKind === 'REMEMBER_EXACT' ||
              actionKind === 'CREATE_SCOPED_RULE' ? (
                <div className="space-y-2">
                  <TextInput
                    aria-label="Exact source value"
                    placeholder="Source value to match exactly"
                    value={sourceValue}
                    onChange={(event) => setSourceValue(event.target.value)}
                  />
                  {rawSourceValue ? (
                    <Button
                      variant="ghost"
                      onClick={() => setSourceValue(rawSourceValue)}
                    >
                      Use selected raw value: {rawSourceValue}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {actionKind === 'CREATE_SCOPED_RULE' ? (
                <div className="grid grid-cols-[135px_minmax(0,1fr)] gap-2">
                  <SelectInput
                    aria-label="Rule scope dimension"
                    value={ruleScopeDimension}
                    onChange={(event) =>
                      setRuleScopeDimension(
                        event.target.value as RuleScopeDimension,
                      )
                    }
                  >
                    <option value="customer">Customer</option>
                    <option value="businessUnit">Subdomain</option>
                    <option value="site">Site</option>
                    <option value="vendor">Vendor</option>
                    <option value="model">Model</option>
                    <option value="productFamily">Product family</option>
                    <option value="deviceType">Device type</option>
                  </SelectInput>
                  <TextInput
                    aria-label="Rule scope value"
                    placeholder="Exact scope value"
                    value={ruleScopeValue}
                    onChange={(event) => setRuleScopeValue(event.target.value)}
                  />
                </div>
              ) : null}

              <TextInput
                aria-label="Decision explanation"
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
              />

              {preview ? (
                <div className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] p-3 text-xs">
                  <p className="font-semibold text-[var(--foreground)]">
                    Exact impact: {preview.affectedRowCount.toLocaleString()} staged rows
                  </p>
                  <p className="mt-1 text-[var(--muted-strong)]">
                    This preview is pinned to the affected row revisions
                    {preview.contextVersion ? ' and active rule-book revision' : ''}. If
                    anything changes, apply is rejected and a new preview is required.
                  </p>

                  {preview.confirmationReasons.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--muted-strong)]">
                      {preview.confirmationReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)] p-2">
                    <p className="font-semibold text-[var(--foreground)]">
                      Common vs different values
                    </p>
                    <dl className="mt-1 space-y-1">
                      {previewCommonValues.map(([field, value]) => (
                        <div
                          key={field}
                          className="grid grid-cols-[115px_minmax(0,1fr)] gap-2"
                        >
                          <dt className="text-[var(--muted)]">
                            {fieldLabel(field)}
                          </dt>
                          <dd
                            className={
                              value === 'MIXED'
                                ? 'font-semibold text-[var(--accent-light)]'
                                : 'truncate text-[var(--muted-strong)]'
                            }
                          >
                            {value === 'MIXED' ? 'Different values' : display(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="mt-3 max-h-36 overflow-y-auto">
                    {preview.sample.map((row) => (
                      <p
                        key={row.rowNumber}
                        className="truncate text-[var(--muted)]"
                      >
                        #{row.rowNumber} · {display(row.sourceName)} ·{' '}
                        {display(row.customer)} → {display(row.businessUnit)} →{' '}
                        {display(row.site)}
                      </p>
                    ))}
                  </div>
                  <Button
                    variant="primary"
                    className="mt-3 w-full"
                    disabled={actionBusy}
                    onClick={() => void applyAction()}
                  >
                    Confirm and apply to {preview.affectedRowCount.toLocaleString()}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!action || actionBusy}
                  onClick={() => void previewAction()}
                >
                  Preview exact scope
                </Button>
              )}
              {actionMessage ? (
                <p
                  role="status"
                  className="text-xs leading-5 text-[var(--accent-light)]"
                >
                  {actionMessage}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="py-5 text-sm leading-6 text-[var(--muted)]">
              Use the grid, an issue count, or a group’s “Select all” action. The
              same inspector handles one row, explicit multi-select, and full
              server-side group/filter selections.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
