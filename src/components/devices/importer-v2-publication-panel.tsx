'use client'

import { fetchImporterV2Read } from '@/lib/importer-v2-client-request'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { importerV2CatalogProposalRequiresApproval } from '@/lib/importer-v2-publication-approval'
import type { ImporterV2WorkspaceSelection } from '@/lib/importer-v2-workspace'
import type {
  ImporterV2CatalogProposal,
  ImporterV2CatalogProposalField,
  ImporterV2PublicationMode,
  ImporterV2PublicationQa,
} from '@/lib/importer-v2-publication'

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) {
    throw new ApiRequestError(
      body?.error?.message ?? 'Request failed.',
      response.status,
      typeof body?.error?.code === 'string' ? body.error.code : null,
    )
  }
  return body.data as T
}

function count(value: number) {
  return value.toLocaleString()
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[var(--foreground)]">
        {count(value)}
      </div>
    </div>
  )
}

const PROPOSAL_LABELS: Record<ImporterV2CatalogProposalField, string> = {
  customer: 'Customers',
  businessUnit: 'Business units / subdomains',
  site: 'Sites',
  vendor: 'Vendors',
  productFamily: 'Product families',
  deviceType: 'Device types',
  model: 'Models',
  currentFirmware: 'Observed firmware releases',
}

const PROPOSAL_ORDER: ImporterV2CatalogProposalField[] = [
  'customer',
  'businessUnit',
  'site',
  'vendor',
  'deviceType',
  'productFamily',
  'model',
  'currentFirmware',
]

function proposalContext(proposal: ImporterV2CatalogProposal) {
  return Object.entries(proposal.context)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ')
}

function proposalGroups(proposals: ImporterV2CatalogProposal[]) {
  return PROPOSAL_ORDER.map((field) => ({
    field,
    label: PROPOSAL_LABELS[field],
    proposals: proposals.filter((proposal) => proposal.field === field),
  })).filter((group) => group.proposals.length > 0)
}

function candidateRowsFor(qa: ImporterV2PublicationQa, mode: ImporterV2PublicationMode) {
  return mode === 'VALID_ONLY'
    ? qa.publication.validOnlyCandidateRows
    : qa.publication.allResolvedCandidateRows
}

function publicationSourceRowsFor(
  qa: ImporterV2PublicationQa,
  mode: ImporterV2PublicationMode,
  selectedCandidateRows?: readonly number[],
) {
  const rows = new Set(
    selectedCandidateRows ?? candidateRowsFor(qa, mode),
  )
  for (const group of [
    ...qa.topology.stackGroups,
    ...qa.topology.haGroups,
  ]) {
    if (!rows.has(group.parentRowNumber)) continue
    for (const member of group.memberRows) rows.add(member.rowNumber)
  }
  return rows
}

function requiredProposalsFor(
  qa: ImporterV2PublicationQa,
  mode: ImporterV2PublicationMode,
  selectedCandidateRows?: readonly number[],
) {
  const rows = publicationSourceRowsFor(
    qa,
    mode,
    selectedCandidateRows,
  )
  return qa.catalogProposals
    .filter((proposal) =>
      proposal.rowNumbers.some((rowNumber) => rows.has(rowNumber)),
    )
    .filter((proposal) =>
      importerV2CatalogProposalRequiresApproval(qa, proposal),
    )
}

type RetryRequest = {
  signature: string
  idempotencyKey: string
}

type PublicationResult = {
  publishedRows: Array<{ rowNumber: number; stackMemberCount?: number }>
  publishedStackMemberRowCount?: number
  remainingIncludedRows: number
  batchStatus: string
}

type PublicationScopePreview = {
  qaFingerprint: string
  mode: ImporterV2PublicationMode
  rowNumbers: number[]
  matchedCount: number
  eligibleCount: number
  skippedCount: number
  conflictingRowNumbers: number[]
  safeCandidateRows: number[]
  safeCandidateCount: number
  identityConflicts: Array<{
    rowNumber: number
    sourceName: string | null
    hostname: string | null
    sourceId: string | null
    selectedCanonicalDeviceId: string | null
    canonicalConflicts: Array<{
      canonicalDeviceId: string
      name: string | null
      hostname: string | null
      matchingIdentifiers: Array<{
        field: 'sourceId' | 'serialNumber' | 'macAddress'
        value: string
      }>
    }>
    stagedConflicts: Array<{
      rowNumber: number
      sourceName: string | null
      hostname: string | null
      sourceId: string | null
      selectedCanonicalDeviceId: string | null
      matchingIdentifiers: Array<{
        field: 'sourceId' | 'serialNumber' | 'macAddress'
        value: string
      }>
    }>
  }>
  nameConflictRowNumbers: number[]
}

type HaConfirmationPreview = {
  rowNumbers: [number, number]
  scopeToken: string
  confirmationReasons: string[]
}

export function ImporterV2PublicationPanel({
  batchId,
  selectedWorkspaceRows = null,
  onPublished,
  embedded = false,
}: {
  batchId: string
  selectedWorkspaceRows?: ImporterV2WorkspaceSelection | null
  onPublished?: () => void
  embedded?: boolean
}) {
  const [qa, setQa] = useState<ImporterV2PublicationQa | null>(null)
  const [mode, setMode] = useState<ImporterV2PublicationMode>(
    selectedWorkspaceRows ? 'VALID_ONLY' : 'ALL_RESOLVED',
  )
  const [publicationScope, setPublicationScope] =
    useState<'BATCH' | 'SELECTION'>(
      selectedWorkspaceRows ? 'SELECTION' : 'BATCH',
    )
  const [scoped, setScoped] = useState<PublicationScopePreview | null>(
    null,
  )
  const [scopedLoading, setScopedLoading] = useState(false)
  const [deferConflicts, setDeferConflicts] = useState(false)
  const [haPreview, setHaPreview] =
    useState<HaConfirmationPreview | null>(null)
  const [haBusy, setHaBusy] = useState(false)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [excludingRow, setExcludingRow] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const retryRequest = useRef<RetryRequest | null>(null)

  const haAction = useCallback(
    () => ({
      type: 'CONFIRM_HA_CLUSTER' as const,
      explanation:
        'Engineer confirmed these two provider source objects as physical peers of one logical HA cluster. Active/passive role is not used as durable identity.',
    }),
    [],
  )

  const fetchQa = useCallback(async (refresh = false) => {
    const response = await fetchImporterV2Read(
      `/api/v1/device-import-v2/batches/${batchId}/publication`,
      refresh ? crypto.randomUUID() : '',
    )
    return responseData<ImporterV2PublicationQa>(response)
  }, [batchId])

  const loadQa = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchQa(true)
      setQa(next)
      setApproved((current) => {
        const allowed = new Set(requiredProposalsFor(next, mode).map((item) => item.key))
        return new Set([...current].filter((key) => allowed.has(key)))
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load publication QA.',
      )
    } finally {
      setLoading(false)
    }
  }, [fetchQa, mode])

  const requestHaPreview = useCallback(
    async (leftRow: number, rightRow: number) => {
      const rowNumbers = [leftRow, rightRow].sort(
        (left, right) => left - right,
      ) as [number, number]
      setHaBusy(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/v1/device-import-v2/batches/${batchId}/actions`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mode: 'PREVIEW',
              selection: { mode: 'ROWS', rowNumbers },
              action: haAction(),
            }),
          },
        )
        const preview = await responseData<{
          scopeToken: string
          confirmationReasons: string[]
        }>(response)
        setHaPreview({
          rowNumbers,
          scopeToken: preview.scopeToken,
          confirmationReasons: preview.confirmationReasons,
        })
      } catch (previewError) {
        setHaPreview(null)
        setError(
          previewError instanceof Error
            ? previewError.message
            : 'Unable to preview HA confirmation.',
        )
      } finally {
        setHaBusy(false)
      }
    },
    [batchId, haAction],
  )

  const applyHaPreview = useCallback(async () => {
    if (!haPreview) return
    setHaBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/actions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'APPLY',
            selection: {
              mode: 'ROWS',
              rowNumbers: haPreview.rowNumbers,
            },
            action: haAction(),
            scopeToken: haPreview.scopeToken,
          }),
        },
      )
      await responseData(response)
      const rows = haPreview.rowNumbers
      setHaPreview(null)
      setScoped(null)
      setDeferConflicts(false)
      setApproved(new Set())
      setSuccess(
        `Rows #${rows[0]} and #${rows[1]} confirmed as one logical HA cluster.`,
      )
      await loadQa()
      onPublished?.()
    } catch (applyError) {
      setHaPreview(null)
      setError(
        applyError instanceof Error
          ? applyError.message
          : 'Unable to confirm HA cluster.',
      )
    } finally {
      setHaBusy(false)
    }
  }, [batchId, haAction, haPreview, loadQa, onPublished])

  useEffect(() => {
    let cancelled = false
    void fetchQa()
      .then((next) => {
        if (!cancelled) setQa(next)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load publication QA.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchQa])

  const selectionEnabled =
    publicationScope === 'SELECTION' && Boolean(selectedWorkspaceRows)

  useEffect(() => {
    if (!qa || !selectionEnabled || !selectedWorkspaceRows) return

    let cancelled = false
    const loadSelectedScope = async () => {
      setScoped(null)
      setScopedLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `/api/v1/device-import-v2/batches/${batchId}/publication/scope`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mode,
              selection: selectedWorkspaceRows,
            }),
          },
        )
        const preview =
          await responseData<PublicationScopePreview>(response)
        if (!cancelled) setScoped(preview)
      } catch (scopeError) {
        if (!cancelled) {
          setScoped(null)
          setError(
            scopeError instanceof Error
              ? scopeError.message
              : 'Unable to preview selected publication scope.',
          )
        }
      } finally {
        if (!cancelled) setScopedLoading(false)
      }
    }

    void loadSelectedScope()
    return () => {
      cancelled = true
    }
  }, [
    batchId,
    mode,
    qa,
    selectionEnabled,
    selectedWorkspaceRows,
  ])

  const candidateRows = useMemo(() => {
    if (!qa) return []
    if (!selectionEnabled) return candidateRowsFor(qa, mode)
    if (
      !scoped ||
      scoped.qaFingerprint !== qa.qaFingerprint ||
      scoped.mode !== mode
    ) {
      return []
    }
    return deferConflicts
      ? scoped.safeCandidateRows
      : scoped.rowNumbers
  }, [
    deferConflicts,
    mode,
    qa,
    scoped,
    selectionEnabled,
  ])

  const publicationSourceRows = useMemo(
    () =>
      qa
        ? publicationSourceRowsFor(qa, mode, candidateRows)
        : new Set<number>(),
    [mode, qa, candidateRows],
  )
  const requiredProposals = useMemo(
    () =>
      qa
        ? requiredProposalsFor(qa, mode, candidateRows)
        : [],
    [mode, qa, candidateRows],
  )
  const groups = useMemo(() => proposalGroups(requiredProposals), [requiredProposals])
  const requiredKeys = useMemo(
    () => new Set(requiredProposals.map((proposal) => proposal.key)),
    [requiredProposals],
  )
  const approvedRequiredCount = useMemo(
    () => [...approved].filter((key) => requiredKeys.has(key)).length,
    [approved, requiredKeys],
  )
  const allProposalsApproved = approvedRequiredCount === requiredProposals.length
  const canPublish = Boolean(
    qa &&
      candidateRows.length > 0 &&
      allProposalsApproved &&
      (!selectionEnabled ||
        (scoped &&
          scoped.qaFingerprint === qa.qaFingerprint &&
          scoped.mode === mode &&
          (scoped.conflictingRowNumbers.length === 0 ||
            deferConflicts))) &&
      (selectionEnabled ||
        mode === 'VALID_ONLY' ||
        qa.publication.unresolvedRows.length === 0),
  )

  const approveKeys = (keys: string[], checked: boolean) => {
    setApproved((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (checked) next.add(key)
        else next.delete(key)
      }
      return next
    })
    retryRequest.current = null
  }

  const publishRequest = async (
    currentQa: ImporterV2PublicationQa,
    approvalKeys: string[],
    idempotencyKey: string,
  ) => {
    const response = await fetch(
      `/api/v1/device-import-v2/batches/${batchId}/publication`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          qaFingerprint: currentQa.qaFingerprint,
          idempotencyKey,
          approvedProposalKeys: approvalKeys,
          selection: selectionEnabled
            ? selectedWorkspaceRows
            : undefined,
          skipConflicts: selectionEnabled
            ? deferConflicts
            : false,
          expectedCandidateRows: selectionEnabled
            ? candidateRows
            : undefined,
        }),
      },
    )
    return responseData<PublicationResult>(response)
  }

  const publish = async () => {
    if (!qa || !canPublish) return
    setPublishing(true)
    setError(null)
    setSuccess(null)

    try {
      const approvalKeys = [...approved].filter((key) => requiredKeys.has(key)).sort()
      const signature = JSON.stringify({
        qaFingerprint: qa.qaFingerprint,
        mode,
        approvedProposalKeys: approvalKeys,
        selection: selectionEnabled ? selectedWorkspaceRows : null,
        deferConflicts: selectionEnabled ? deferConflicts : false,
        candidateRows: selectionEnabled ? candidateRows : null,
      })
      if (retryRequest.current?.signature !== signature) {
        retryRequest.current = {
          signature,
          idempotencyKey: crypto.randomUUID(),
        }
      }

      let result: PublicationResult
      try {
        result = await publishRequest(
          qa,
          approvalKeys,
          retryRequest.current.idempotencyKey,
        )
      } catch (publishError) {
        if (!(publishError instanceof ApiRequestError) || publishError.status !== 409) {
          throw publishError
        }

        const freshQa = await fetchQa(true)
        setQa(freshQa)
        retryRequest.current = null

        if (selectionEnabled) {
          throw new Error(
            'The staged QA or selected scope changed while this dialog was open. Review the refreshed selected scope and publish again.',
          )
        }

        const freshRequired = requiredProposalsFor(freshQa, mode)
        const freshRequiredKeys = new Set(freshRequired.map((item) => item.key))
        const stillApproved = approvalKeys.filter((key) => freshRequiredKeys.has(key))
        const freshCandidates = candidateRowsFor(freshQa, mode)
        const mayRetry =
          freshCandidates.length > 0 &&
          stillApproved.length === freshRequired.length &&
          (mode === 'VALID_ONLY' || freshQa.publication.unresolvedRows.length === 0)

        setApproved(new Set(stillApproved))

        if (!mayRetry) {
          throw new Error(
            'The staged QA changed while this dialog was open. QA has been refreshed; review the changed proposal/review summary and publish again.',
          )
        }

        result = await publishRequest(freshQa, stillApproved.sort(), crypto.randomUUID())
      }

      retryRequest.current = null
      const memberCount = result.publishedStackMemberRowCount ?? 0
      setSuccess(
        `${result.publishedRows.length.toLocaleString()} managed device(s) published atomically${memberCount ? ` with ${memberCount.toLocaleString()} physical stack member row(s)` : ''}. ${result.remainingIncludedRows.toLocaleString()} included source row(s) remain staged.`,
      )
      await loadQa()
      onPublished?.()
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : 'Publication failed.',
      )
    } finally {
      setPublishing(false)
    }
  }

  const excludeStaleRow = async (rowNumber: number) => {
    setExcludingRow(rowNumber)
    setError(null)
    setSuccess(null)
    try {
      const selection = { mode: 'ROWS' as const, rowNumbers: [rowNumber] }
      const action = {
        type: 'EXCLUDE_ROW' as const,
        explanation:
          'Explicitly excluded this stale or incomplete source record from publication. Canonical inventory is unchanged.',
      }
      const previewResponse = await fetch(
        `/api/v1/device-import-v2/batches/${batchId}/actions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'PREVIEW', selection, action }),
        },
      )
      const preview = await responseData<{ scopeToken: string }>(previewResponse)
      const applyResponse = await fetch(
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
      await responseData(applyResponse)
      setSuccess(`Row #${rowNumber} was explicitly excluded from this import.`)
      retryRequest.current = null
      await loadQa()
    } catch (excludeError) {
      setError(
        excludeError instanceof Error
          ? excludeError.message
          : 'Unable to exclude the staged row.',
      )
    } finally {
      setExcludingRow(null)
    }
  }

  return (
    <section
      className={[
        'space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4',
        embedded ? '' : 'mt-4',
      ].join(' ')}
      aria-labelledby="import-publication-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--accent-light)]">
            Final QA
          </div>
          <h2 id="import-publication-title" className="mt-1 text-lg font-semibold text-[var(--foreground)]">
            Review and publish
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Review exceptions and canonical objects this import would create. Logical stacks and confirmed HA clusters publish as one managed Device while physical member evidence is retained below them.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadQa()} disabled={loading || publishing}>
          Refresh QA
        </Button>
      </div>

      {qa ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <Stat label="Valid" value={qa.counts.valid} />
            <Stat label="Warnings" value={qa.counts.warning} />
            <Stat label="Needs review" value={qa.counts.needsReview} />
            <Stat label="Excluded" value={qa.counts.excluded} />
            <Stat label="Stacks" value={qa.counts.stacks} />
            <Stat label="Stack members" value={qa.counts.stackMembers} />
            <Stat label="HA clusters" value={qa.counts.haClusters} />
            <Stat label="HA members" value={qa.counts.haMembers} />
            <Stat label="Create" value={qa.counts.create} />
            <Stat label="Update" value={qa.counts.update} />
            <Stat label="Unchanged" value={qa.counts.unchanged} />
            <Stat label="Conflicts" value={qa.counts.conflict} />
            <Stat label="Field errors" value={qa.fieldErrors.length} />
            <Stat label="Already published" value={qa.counts.alreadyPublished} />
          </div>

          {qa.topology.stackGroups.length ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Detected logical stacks</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {qa.topology.stackGroups.length.toLocaleString()} stack(s) contain {qa.counts.stackMembers.toLocaleString()} physical member row(s). The stack is the firmware/planning target; member serial, model and firmware evidence are retained without creating duplicate managed devices.
              </p>
              <div className="mt-3 space-y-2">
                {qa.topology.stackGroups.map((stack) => (
                  <details key={stack.groupKey} className="rounded border border-[var(--border)] bg-[var(--background)]">
                    <summary className="cursor-pointer px-3 py-2 text-sm">
                      <strong>{stack.parentName}</strong>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        row #{stack.parentRowNumber} · {stack.memberRows.length} member(s)
                      </span>
                    </summary>
                    <div className="overflow-x-auto border-t border-[var(--border)] p-2">
                      <table className="w-full min-w-[620px] text-left text-xs">
                        <thead className="text-[var(--muted)]">
                          <tr>
                            <th className="px-2 py-1">Member</th>
                            <th className="px-2 py-1">Source row</th>
                            <th className="px-2 py-1">Serial</th>
                            <th className="px-2 py-1">Model</th>
                            <th className="px-2 py-1">Firmware</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stack.memberRows.map((member) => (
                            <tr key={member.rowNumber} className="border-t border-[var(--border)]">
                              <td className="px-2 py-1.5">{member.memberIndex} · {member.name}</td>
                              <td className="px-2 py-1.5">#{member.rowNumber}</td>
                              <td className="px-2 py-1.5">{member.serialNumber ?? '—'}</td>
                              <td className="px-2 py-1.5">{member.model ?? '—'}</td>
                              <td className="px-2 py-1.5">{member.firmware ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}

          {qa.topology.haGroups.length ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">
                Confirmed logical HA clusters
              </h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {qa.topology.haGroups.length.toLocaleString()} HA cluster(s) contain {qa.counts.haMembers.toLocaleString()} physical member row(s). Members remain peers; active/passive role is not durable identity.
              </p>
              <div className="mt-3 space-y-2">
                {qa.topology.haGroups.map((group) => (
                  <details
                    key={group.groupKey}
                    className="rounded border border-[var(--border)] bg-[var(--background)]"
                  >
                    <summary className="cursor-pointer px-3 py-2 text-sm">
                      <strong>{group.parentName}</strong>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        logical HA · {group.memberRows.length} member(s)
                      </span>
                    </summary>
                    <div className="overflow-x-auto border-t border-[var(--border)] p-2">
                      <table className="w-full min-w-[620px] text-left text-xs">
                        <thead className="text-[var(--muted)]">
                          <tr>
                            <th className="px-2 py-1">Member</th>
                            <th className="px-2 py-1">Source row</th>
                            <th className="px-2 py-1">Serial</th>
                            <th className="px-2 py-1">Model</th>
                            <th className="px-2 py-1">Firmware</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.memberRows.map((member) => (
                            <tr
                              key={member.rowNumber}
                              className="border-t border-[var(--border)]"
                            >
                              <td className="px-2 py-1.5">
                                {member.memberIndex} · {member.name}
                              </td>
                              <td className="px-2 py-1.5">
                                #{member.rowNumber}
                              </td>
                              <td className="px-2 py-1.5">
                                {member.serialNumber ?? '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                {member.model ?? '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                {member.firmware ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}

          {!selectionEnabled && qa.publication.unresolvedRows.length ? (
            <div className="rounded-md border border-[#8f4747] bg-[#512b2b] p-3 text-sm text-[#ffd7d7]">
              <div className="font-semibold">
                {qa.publication.unresolvedRows.length.toLocaleString()} included row(s) still require review.
              </div>
              <p className="mt-1 text-xs opacity-90">
                Incomplete standalone devices can be given a Source ID / serial / MAC or explicitly excluded as stale. Stack members are resolved through their logical parent but still need valid model/catalog evidence.
              </p>
              <div className="mt-3 space-y-2">
                {qa.publication.unresolvedRows.slice(0, 20).map((row) => (
                  <div
                    key={row.rowNumber}
                    className="flex flex-wrap items-start justify-between gap-2 rounded border border-[#9e5a5a] bg-black/10 p-2"
                  >
                    <div className="min-w-0 flex-1 text-xs">
                      <strong>Row #{row.rowNumber}</strong>
                      <span className="ml-2 opacity-90">{row.reasons.join(' ')}</span>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={excludingRow !== null || publishing}
                      onClick={() => void excludeStaleRow(row.rowNumber)}
                    >
                      {excludingRow === row.rowNumber ? 'Excluding…' : 'Exclude from this import'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {qa.firmware.newObservedReleaseProposalRows.length ? (
            <div className="rounded-md border border-blue-400/30 bg-blue-500/10 p-3 text-sm text-blue-100">
              <strong>{qa.firmware.newObservedReleaseProposalRows.length.toLocaleString()} observed firmware row(s)</strong> can be canonicalized automatically as Needs review because vendor, platform, and exact running version are already resolved. This does not allow or prefer the release.
            </div>
          ) : null}

          {requiredProposals.length ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    New canonical data to create
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {requiredProposals.length.toLocaleString()} distinct proposal(s) are required by {candidateRows.length.toLocaleString()} managed device(s) across {publicationSourceRows.size.toLocaleString()} source row(s), including topology members. Approve all, approve a category, or inspect individual values.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    approveKeys(
                      requiredProposals.map((proposal) => proposal.key),
                      approvedRequiredCount !== requiredProposals.length,
                    )
                  }
                >
                  {approvedRequiredCount === requiredProposals.length
                    ? 'Clear all approvals'
                    : `Approve all ${requiredProposals.length}`}
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                {groups.map((group) => {
                  const keys = group.proposals.map((proposal) => proposal.key)
                  const approvedInGroup = keys.filter((key) => approved.has(key)).length
                  const affectedRows = new Set(
                    group.proposals.flatMap((proposal) => proposal.rowNumbers),
                  ).size
                  const allApproved = approvedInGroup === keys.length
                  return (
                    <details
                      key={group.field}
                      className="rounded border border-[var(--border)] bg-[var(--background)]"
                    >
                      <summary className="cursor-pointer list-none px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <strong className="text-sm text-[var(--foreground)]">{group.label}</strong>
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              {group.proposals.length} proposal(s) · {affectedRows} affected source row(s)
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--muted)]">
                              {approvedInGroup}/{keys.length} approved
                            </span>
                            <button
                              type="button"
                              className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs font-semibold text-[var(--muted-strong)] hover:border-[var(--accent-muted)]"
                              onClick={(event) => {
                                event.preventDefault()
                                approveKeys(keys, !allApproved)
                              }}
                            >
                              {allApproved ? 'Clear category' : 'Approve category'}
                            </button>
                          </div>
                        </div>
                      </summary>
                      <div className="grid gap-2 border-t border-[var(--border)] p-2 md:grid-cols-2">
                        {group.proposals.map((proposal) => (
                          <label
                            key={proposal.key}
                            className="flex cursor-pointer items-start gap-2 rounded border border-[var(--border)] p-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={approved.has(proposal.key)}
                              onChange={(event) => approveKeys([proposal.key], event.target.checked)}
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold text-[var(--foreground)]">
                                {proposal.label}
                              </span>
                              {proposalContext(proposal) ? (
                                <span className="mt-0.5 block text-xs text-[var(--muted-strong)]">
                                  {proposalContext(proposal)}
                                </span>
                              ) : null}
                              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                                Used by {proposal.rowNumbers.length.toLocaleString()} source row(s) · sample #{proposal.rowNumbers.slice(0, 6).join(', #')}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--muted-strong)]">
              No new canonical objects require approval for the selected publication scope.
            </div>
          )}

          <details className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">
              Evidence and firmware assurance
            </summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--muted-strong)]">
                <dt>Deterministic parser</dt><dd className="text-right">{count(qa.firmware.deterministicParserRows.length)}</dd>
                <dt>Remembered exact</dt><dd className="text-right">{count(qa.firmware.rememberedExactRows.length)}</dd>
                <dt>Manual resolutions</dt><dd className="text-right">{count(qa.firmware.manuallyResolvedRows.length)}</dd>
                <dt>Firmware ≠ Software</dt><dd className="text-right">{count(qa.firmware.rawFirmwareSoftwareDifferences.length)}</dd>
                <dt>Unknown running firmware</dt><dd className="text-right">{count(qa.firmware.unknownFirmwareRows.length)}</dd>
                <dt>Platform conflicts</dt><dd className="text-right">{count(qa.firmware.platformConflictRows.length)}</dd>
                <dt>Observed release proposals</dt><dd className="text-right">{count(qa.firmware.newObservedReleaseProposalRows.length)}</dd>
              </dl>
              <div className="space-y-1 text-xs text-[var(--muted-strong)]">
                {qa.evidence.decisionSources.slice(0, 10).map((item) => (
                  <div key={item.source} className="flex justify-between gap-3">
                    <span>{item.source}</span><span>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </details>

          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]">
            {error ? (
              <div role="alert" className="mb-3 rounded-md border border-[#8f4747] bg-[#512b2b] px-3 py-2 text-sm text-[#ffd7d7]">
                <strong>Publication not completed.</strong> {error}
              </div>
            ) : null}
            {success ? (
              <div className="mb-3 rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--accent-light)]">
                {success}
              </div>
            ) : null}
            {selectionEnabled && scoped?.conflictingRowNumbers.length ? (
              <div className="mb-3 rounded-md border border-[#8f4747] bg-[#512b2b] px-3 py-2 text-sm text-[#ffd7d7]">
                <div className="font-semibold">
                  {scoped.conflictingRowNumbers.length.toLocaleString()} selected candidate row(s) still have publication conflicts.
                </div>
                <p className="mt-1 text-xs opacity-90">
                  These are scope-level identity/name uniqueness checks performed immediately before publication. They can exist even when staging itself has no validation warning.
                </p>
                {scoped.safeCandidateCount > 0 ? (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 rounded border border-[#9e5a5a] bg-black/10 p-2 text-xs">
                    <input
                      type="checkbox"
                      checked={deferConflicts}
                      onChange={(event) => {
                        setDeferConflicts(event.target.checked)
                        setApproved(new Set())
                        retryRequest.current = null
                      }}
                    />
                    <span>
                      Leave these {scoped.conflictingRowNumbers.length.toLocaleString()} conflicting row(s) staged and publish the {scoped.safeCandidateCount.toLocaleString()} safe candidate(s) from this selection.
                    </span>
                  </label>
                ) : null}
                <details className="mt-2 rounded border border-[#9e5a5a] bg-black/10">
                  <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold">
                    Show conflicting rows and reasons
                  </summary>
                  <div className="max-h-64 space-y-2 overflow-y-auto border-t border-[#9e5a5a] p-2 text-xs">
                    {scoped.identityConflicts.map((conflict) => (
                      <div
                        key={`identity-${conflict.rowNumber}`}
                        className="rounded border border-[#9e5a5a] bg-black/10 p-2"
                      >
                        <div className="font-semibold">
                          Row #{conflict.rowNumber} · {conflict.sourceName ?? conflict.hostname ?? 'Unnamed device'}
                        </div>
                        <div className="mt-1 opacity-90">
                          Source ID: {conflict.sourceId ?? '—'} · canonical: {conflict.selectedCanonicalDeviceId ?? 'CREATE_NEW / unresolved'}
                        </div>
                        {conflict.stagedConflicts.map((match) => {
                          const pair = [
                            conflict.rowNumber,
                            match.rowNumber,
                          ].sort(
                            (left, right) => left - right,
                          ) as [number, number]
                          const canReviewAsHa =
                            conflict.rowNumber < match.rowNumber &&
                            Boolean(conflict.sourceId) &&
                            Boolean(match.sourceId) &&
                            conflict.sourceId !== match.sourceId &&
                            match.matchingIdentifiers.some(
                              (item) =>
                                item.field === 'serialNumber' ||
                                item.field === 'macAddress',
                            )
                          const previewingPair =
                            haPreview?.rowNumbers[0] === pair[0] &&
                            haPreview?.rowNumbers[1] === pair[1]

                          return (
                            <div
                              key={`staged-${conflict.rowNumber}-${match.rowNumber}`}
                              className="mt-1"
                            >
                              Matches staged row #{match.rowNumber} · {match.sourceName ?? match.hostname ?? 'Unnamed device'} · Source ID: {match.sourceId ?? '—'} · canonical: {match.selectedCanonicalDeviceId ?? 'CREATE_NEW / unresolved'} · on{' '}
                              {match.matchingIdentifiers
                                .map(
                                  (item) =>
                                    `${item.field}: ${item.value}`,
                                )
                                .join(', ')}
                              {canReviewAsHa ? (
                                <div className="mt-2 rounded border border-[#9e5a5a] bg-black/10 p-2">
                                  {previewingPair && haPreview ? (
                                    <>
                                      <div className="font-semibold">
                                        HA confirmation preview
                                      </div>
                                      <ul className="mt-1 list-disc space-y-1 pl-4 opacity-90">
                                        {haPreview.confirmationReasons.map(
                                          (reason) => (
                                            <li key={reason}>{reason}</li>
                                          ),
                                        )}
                                      </ul>
                                      <div className="mt-2 flex gap-2">
                                        <Button
                                          variant="ghost"
                                          disabled={haBusy}
                                          onClick={() =>
                                            setHaPreview(null)
                                          }
                                        >
                                          Cancel
                                        </Button>
                                        <Button
                                          variant="primary"
                                          disabled={haBusy}
                                          onClick={() =>
                                            void applyHaPreview()
                                          }
                                        >
                                          {haBusy
                                            ? 'Confirming…'
                                            : 'Confirm HA cluster'}
                                        </Button>
                                      </div>
                                    </>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      disabled={haBusy}
                                      onClick={() =>
                                        void requestHaPreview(
                                          pair[0],
                                          pair[1],
                                        )
                                      }
                                    >
                                      {haBusy
                                        ? 'Checking…'
                                        : 'Review as HA cluster'}
                                    </Button>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                        {conflict.canonicalConflicts.map((match) => (
                          <div
                            key={`canonical-${conflict.rowNumber}-${match.canonicalDeviceId}`}
                            className="mt-1"
                          >
                            Matches canonical device {match.name ?? match.hostname ?? match.canonicalDeviceId} on{' '}
                            {match.matchingIdentifiers
                              .map((item) => `${item.field}: ${item.value}`)
                              .join(', ')}
                          </div>
                        ))}
                      </div>
                    ))}
                    {scoped.nameConflictRowNumbers.length ? (
                      <div className="rounded border border-[#9e5a5a] bg-black/10 p-2">
                        <div className="font-semibold">Customer + device-name conflicts</div>
                        <div className="mt-1">
                          Rows {scoped.nameConflictRowNumbers.map((row) => `#${row}`).join(', ')}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                {selectedWorkspaceRows ? (
                  <label className="text-sm font-medium text-[var(--foreground)]">
                    Publish rows
                    <select
                      aria-label="Publication row selection"
                      value={publicationScope}
                      onChange={(event) => {
                        setPublicationScope(
                          event.target.value as 'SELECTION' | 'BATCH',
                        )
                        setDeferConflicts(false)
                        setApproved(new Set())
                        retryRequest.current = null
                      }}
                      className="mt-1 block rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                    >
                      <option value="SELECTION">
                        {selectedWorkspaceRows.mode === 'QUERY'
                          ? 'Selected / filtered matching rows'
                          : `Only ${selectedWorkspaceRows.rowNumbers.length} selected row(s)`}
                      </option>
                      <option value="BATCH">Entire batch</option>
                    </select>
                  </label>
                ) : null}

                <label className="text-sm font-medium text-[var(--foreground)]">
                  Eligibility
                  <select
                    value={mode}
                    onChange={(event) => {
                      setMode(
                        event.target.value as ImporterV2PublicationMode,
                      )
                      setDeferConflicts(false)
                      setApproved(new Set())
                      retryRequest.current = null
                    }}
                    className="mt-1 block rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                  >
                    <option value="VALID_ONLY">
                      {selectionEnabled
                        ? 'Valid devices within selected scope'
                        : 'Only currently valid devices'}
                    </option>
                    <option value="ALL_RESOLVED">
                      {selectionEnabled
                        ? 'All resolved devices within selected scope'
                        : 'Entire resolved batch'}
                    </option>
                  </select>
                </label>
              </div>

              <div className="text-right">
                {selectionEnabled ? (
                  <div className="mb-1 text-xs text-[var(--muted)]">
                    {scopedLoading
                      ? 'Checking exact server-side selection…'
                      : scoped
                        ? `${scoped.matchedCount.toLocaleString()} matching · ${scoped.eligibleCount.toLocaleString()} eligible · ${scoped.skippedCount.toLocaleString()} skipped · ${scoped.conflictingRowNumbers.length.toLocaleString()} conflicts · ${scoped.safeCandidateCount.toLocaleString()} safe`
                        : 'Preparing selected scope…'}
                  </div>
                ) : null}
                <div className="mb-1 text-xs text-[var(--muted)]">
                  {candidateRows.length.toLocaleString()} managed device(s) · {publicationSourceRows.size.toLocaleString()} source row(s) · {approvedRequiredCount}/{requiredProposals.length} proposal approvals
                </div>
                <Button
                  onClick={() => void publish()}
                  disabled={
                    !canPublish ||
                    publishing ||
                    loading ||
                    (selectionEnabled && scopedLoading)
                  }
                >
                  {publishing
                    ? 'Publishing…'
                    : selectionEnabled
                      ? deferConflicts
                        ? 'Publish safe selected rows'
                        : 'Publish selected atomically'
                      : 'Publish atomically'}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : loading ? (
        <p className="text-sm text-[var(--muted)]">Building QA summary…</p>
      ) : null}
    </section>
  )
}
