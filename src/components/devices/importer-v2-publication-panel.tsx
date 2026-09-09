'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
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
  const values = Object.entries(proposal.context)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}: ${value}`)
  return values.join(' · ')
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

function requiredProposalsFor(
  qa: ImporterV2PublicationQa,
  mode: ImporterV2PublicationMode,
) {
  const rows = new Set(candidateRowsFor(qa, mode))
  return qa.catalogProposals.filter((proposal) =>
    proposal.rowNumbers.some((rowNumber) => rows.has(rowNumber)),
  )
}

type RetryRequest = {
  signature: string
  idempotencyKey: string
}

type PublicationResult = {
  publishedRows: Array<{ rowNumber: number }>
  remainingIncludedRows: number
  batchStatus: string
}

export function ImporterV2PublicationPanel({
  batchId,
  embedded = false,
}: {
  batchId: string
  embedded?: boolean
}) {
  const [qa, setQa] = useState<ImporterV2PublicationQa | null>(null)
  const [mode, setMode] = useState<ImporterV2PublicationMode>('ALL_RESOLVED')
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [excludingRow, setExcludingRow] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const retryRequest = useRef<RetryRequest | null>(null)

  const fetchQa = useCallback(async () => {
    const response = await fetch(
      `/api/v1/device-import-v2/batches/${batchId}/publication`,
      { cache: 'no-store' },
    )
    return responseData<ImporterV2PublicationQa>(response)
  }, [batchId])

  const loadQa = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchQa()
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

  const candidateRows = useMemo(
    () => (qa ? candidateRowsFor(qa, mode) : []),
    [mode, qa],
  )
  const requiredProposals = useMemo(
    () => (qa ? requiredProposalsFor(qa, mode) : []),
    [mode, qa],
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
      (mode === 'VALID_ONLY' || qa.publication.unresolvedRows.length === 0),
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

        // Keep the immutable-snapshot safety boundary, but recover gracefully
        // when QA changed between opening the dialog and pressing Publish.
        const freshQa = await fetchQa()
        const freshRequired = requiredProposalsFor(freshQa, mode)
        const freshRequiredKeys = new Set(freshRequired.map((item) => item.key))
        const stillApproved = approvalKeys.filter((key) => freshRequiredKeys.has(key))
        const freshCandidates = candidateRowsFor(freshQa, mode)
        const mayRetry =
          freshCandidates.length > 0 &&
          stillApproved.length === freshRequired.length &&
          (mode === 'VALID_ONLY' || freshQa.publication.unresolvedRows.length === 0)

        setQa(freshQa)
        setApproved(new Set(stillApproved))
        retryRequest.current = null

        if (!mayRetry) {
          throw new Error(
            'The staged QA changed while this dialog was open. QA has been refreshed; review the changed proposal/review summary and publish again.',
          )
        }

        result = await publishRequest(freshQa, stillApproved.sort(), crypto.randomUUID())
      }

      retryRequest.current = null
      setSuccess(
        `${result.publishedRows.length.toLocaleString()} row(s) published atomically. ${result.remainingIncludedRows.toLocaleString()} included row(s) remain staged.`,
      )
      await loadQa()
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
            Review exceptions and the canonical objects this import would create. Existing exact canonical links do not require approval; only new canonical proposals do.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadQa()} disabled={loading || publishing}>
          Refresh QA
        </Button>
      </div>

      {qa ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Valid" value={qa.counts.valid} />
            <Stat label="Warnings" value={qa.counts.warning} />
            <Stat label="Needs review" value={qa.counts.needsReview} />
            <Stat label="Excluded" value={qa.counts.excluded} />
            <Stat label="Already published" value={qa.counts.alreadyPublished} />
            <Stat label="Create" value={qa.counts.create} />
            <Stat label="Update" value={qa.counts.update} />
            <Stat label="Unchanged" value={qa.counts.unchanged} />
            <Stat label="Conflicts" value={qa.counts.conflict} />
            <Stat label="Field errors" value={qa.fieldErrors.length} />
          </div>

          {qa.publication.unresolvedRows.length ? (
            <div className="rounded-md border border-[#8f4747] bg-[#512b2b] p-3 text-sm text-[#ffd7d7]">
              <div className="font-semibold">
                {qa.publication.unresolvedRows.length.toLocaleString()} included row(s) still require review.
              </div>
              <p className="mt-1 text-xs opacity-90">
                Rows with incomplete source identity can either be given a Source ID / serial / MAC in the Inspector, or explicitly excluded as stale below. Hostname/site/customer remain context, not durable identity.
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

          {requiredProposals.length ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    New canonical data to create
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {requiredProposals.length.toLocaleString()} distinct proposal(s) are required by {candidateRows.length.toLocaleString()} publishable row(s). Approve all, approve a category, or open a category to inspect individual values and context.
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
                              {group.proposals.length} proposal(s) · {affectedRows} affected row(s)
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
                                Used by {proposal.rowNumbers.length.toLocaleString()} row(s) · sample #{proposal.rowNumbers.slice(0, 6).join(', #')}
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="text-sm font-medium text-[var(--foreground)]">
                Publication scope
                <select
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as ImporterV2PublicationMode)
                    setApproved(new Set())
                    retryRequest.current = null
                  }}
                  className="mt-1 block rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                >
                  <option value="ALL_RESOLVED">Publish entire resolved batch</option>
                  <option value="VALID_ONLY">Publish only currently valid rows</option>
                </select>
              </label>
              <div className="text-right">
                <div className="mb-1 text-xs text-[var(--muted)]">
                  {candidateRows.length.toLocaleString()} row(s) · {approvedRequiredCount}/{requiredProposals.length} proposal approvals
                </div>
                <Button onClick={() => void publish()} disabled={!canPublish || publishing || loading}>
                  {publishing ? 'Publishing…' : 'Publish atomically'}
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
