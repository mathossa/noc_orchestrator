'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ImporterV2PublicationMode, ImporterV2PublicationQa } from '@/lib/importer-v2-publication'

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message ?? 'Request failed.')
  return body.data as T
}

function count(value: number) {
  return value.toLocaleString()
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[var(--foreground)]">{count(value)}</div>
    </div>
  )
}

export function ImporterV2PublicationPanel({ batchId }: { batchId: string }) {
  const [qa, setQa] = useState<ImporterV2PublicationQa | null>(null)
  const [mode, setMode] = useState<ImporterV2PublicationMode>('ALL_RESOLVED')
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadQa = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/publication`, { cache: 'no-store' })
      const next = await responseData<ImporterV2PublicationQa>(response)
      setQa(next)
      setApproved(new Set())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load publication QA.')
    } finally {
      setLoading(false)
    }
  }, [batchId])

  useEffect(() => {
    void loadQa()
  }, [loadQa])

  const candidateRows = useMemo(() => {
    if (!qa) return []
    return mode === 'VALID_ONLY'
      ? qa.publication.validOnlyCandidateRows
      : qa.publication.allResolvedCandidateRows
  }, [mode, qa])

  const requiredProposals = useMemo(() => {
    if (!qa) return []
    const rows = new Set(candidateRows)
    return qa.catalogProposals.filter((proposal) => proposal.rowNumbers.some((rowNumber) => rows.has(rowNumber)))
  }, [candidateRows, qa])

  const allProposalsApproved = requiredProposals.every((proposal) => approved.has(proposal.key))
  const canPublish = Boolean(
    qa &&
      candidateRows.length > 0 &&
      allProposalsApproved &&
      (mode === 'VALID_ONLY' || qa.publication.unresolvedRows.length === 0),
  )

  const toggleProposal = (key: string) => {
    setApproved((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const publish = async () => {
    if (!qa || !canPublish) return
    setPublishing(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`/api/v1/device-import-v2/batches/${batchId}/publication`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          qaFingerprint: qa.qaFingerprint,
          idempotencyKey: crypto.randomUUID(),
          approvedProposalKeys: [...approved],
        }),
      })
      const result = await responseData<{
        publishedRows: Array<{ rowNumber: number }>
        remainingIncludedRows: number
        batchStatus: string
      }>(response)
      setSuccess(
        `${result.publishedRows.length.toLocaleString()} row(s) published atomically. ${result.remainingIncludedRows.toLocaleString()} included row(s) remain staged.`,
      )
      await loadQa()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Publication failed.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section className="mt-4 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="import-publication-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--accent-light)]">Final QA</div>
          <h2 id="import-publication-title" className="mt-1 text-lg font-semibold text-[var(--foreground)]">Review and publish</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Publication uses the immutable evaluated snapshot plus confirmed reconciliation decisions. Any staged change after this QA invalidates the publish fingerprint.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadQa()} disabled={loading || publishing}>
          Refresh QA
        </Button>
      </div>

      {error ? <div role="alert" className="rounded-md border border-[#8f4747] bg-[#512b2b] px-3 py-2 text-sm text-[#ffd7d7]">{error}</div> : null}
      {success ? <div className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--accent-light)]">{success}</div> : null}

      {loading && !qa ? <p className="text-sm text-[var(--muted)]">Building QA summary…</p> : null}
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

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Firmware assurance</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--muted-strong)]">
                <dt>Deterministic parser</dt><dd className="text-right">{count(qa.firmware.deterministicParserRows.length)}</dd>
                <dt>Remembered exact</dt><dd className="text-right">{count(qa.firmware.rememberedExactRows.length)}</dd>
                <dt>Manual resolutions</dt><dd className="text-right">{count(qa.firmware.manuallyResolvedRows.length)}</dd>
                <dt>Firmware ≠ Software</dt><dd className="text-right">{count(qa.firmware.rawFirmwareSoftwareDifferences.length)}</dd>
                <dt>Raw ≠ effective</dt><dd className="text-right">{count(qa.firmware.rawVsEffective.length)}</dd>
                <dt>Unknown running firmware</dt><dd className="text-right">{count(qa.firmware.unknownFirmwareRows.length)}</dd>
                <dt>Platform conflicts</dt><dd className="text-right">{count(qa.firmware.platformConflictRows.length)}</dd>
                <dt>Observed release proposals</dt><dd className="text-right">{count(qa.firmware.newObservedReleaseProposalRows.length)}</dd>
              </dl>
              {qa.firmware.evidencePatterns.length ? (
                <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
                  {qa.firmware.evidencePatterns.slice(0, 8).map((pattern) => (
                    <div key={pattern.pattern} className="flex justify-between gap-3">
                      <span>{pattern.pattern}</span>
                      <span>{pattern.count} · rows {pattern.sampleRows.join(', ')}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Evidence and repeat import</h3>
              <div className="mt-2 space-y-1 text-xs text-[var(--muted-strong)]">
                {qa.evidence.decisionSources.slice(0, 8).map((item) => (
                  <div key={item.source} className="flex justify-between gap-3"><span>{item.source}</span><span>{item.count}</span></div>
                ))}
              </div>
              {qa.evidence.matchedEvidence.length ? (
                <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
                  {qa.evidence.matchedEvidence.slice(0, 6).map((item) => (
                    <div key={`${item.source}:${item.evidenceId}:${item.version ?? ''}`} className="flex justify-between gap-3">
                      <span>{item.source} · {item.evidenceId}{item.version ? ` @ ${item.version}` : ''}</span>
                      <span>{item.count}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-2">
                {Object.entries(qa.repeatImport).map(([classification, value]) => (
                  <span key={classification} className="rounded border border-[var(--border-strong)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-strong)]">
                    {classification} {value}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {qa.publication.unresolvedRows.length ? (
            <div className="rounded-md border border-[#8f4747] bg-[#512b2b] p-3 text-sm text-[#ffd7d7]">
              <div className="font-semibold">{qa.publication.unresolvedRows.length.toLocaleString()} included row(s) still require review.</div>
              <div className="mt-1 text-xs opacity-90">
                {qa.publication.unresolvedRows.slice(0, 12).map((row) => `#${row.rowNumber}: ${row.reasons.join(' ')}`).join(' · ')}
              </div>
            </div>
          ) : null}

          {requiredProposals.length ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">Canonical proposals requiring approval</h3>
                <span className="text-xs text-[var(--muted)]">{approved.size}/{requiredProposals.length} approved</span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {requiredProposals.map((proposal) => (
                  <label key={proposal.key} className="flex cursor-pointer items-start gap-2 rounded border border-[var(--border)] p-2 text-sm">
                    <input type="checkbox" checked={approved.has(proposal.key)} onChange={() => toggleProposal(proposal.key)} />
                    <span>
                      <span className="font-semibold text-[var(--foreground)]">{proposal.field}: {proposal.label}</span>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">Rows {proposal.rowNumbers.slice(0, 8).join(', ')}{proposal.rowNumbers.length > 8 ? '…' : ''}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--border)] pt-3">
            <label className="text-sm font-medium text-[var(--foreground)]">
              Publication scope
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as ImporterV2PublicationMode)}
                className="mt-1 block rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
              >
                <option value="ALL_RESOLVED">Publish entire resolved batch</option>
                <option value="VALID_ONLY">Publish only currently valid rows</option>
              </select>
            </label>
            <div className="text-right">
              <div className="text-xs text-[var(--muted)]">{candidateRows.length.toLocaleString()} unpublished row(s) in this transaction</div>
              <Button onClick={() => void publish()} disabled={!canPublish || publishing}>
                {publishing ? 'Publishing…' : 'Publish atomically'}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
