'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'

type ApiError = { error?: { message?: string } }
type SiteProposal = {
  key: string
  customerId: string
  customerName: string
  customerCode: string | null
  referenceIds: string[]
  sourceValues: string[]
  organizationSiteSourceValues: string[]
  name: string
  code: string
  existingTarget: { id: string; name: string; code: string | null } | null
}
type ProposalPayload = {
  data?: {
    proposals: SiteProposal[]
    rawReferenceCount: number
    proposalCount: number
    duplicateReferenceCount: number
    normalizableGenericRowCount: number
  }
} & ApiError
type CreatePayload = { data?: { created: number; linkedExisting: number } } & ApiError
type NormalizePayload = { data?: { normalizedRows: number; rebuiltSiteReferences: number } } & ApiError

type DraftSite = SiteProposal & { include: boolean }

type Summary = {
  rawReferenceCount: number
  proposalCount: number
  duplicateReferenceCount: number
  normalizableGenericRowCount: number
}

const EMPTY_SUMMARY: Summary = {
  rawReferenceCount: 0,
  proposalCount: 0,
  duplicateReferenceCount: 0,
  normalizableGenericRowCount: 0,
}

export function DeviceImportSiteAssist({ batchId }: { batchId: string }) {
  const [drafts, setDrafts] = useState<DraftSite[]>([])
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`)
    const payload = await response.json() as ProposalPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Site proposals could not be prepared.')
    setDrafts(payload.data.proposals.map((proposal) => ({ ...proposal, include: true })))
    setSummary({
      rawReferenceCount: payload.data.rawReferenceCount,
      proposalCount: payload.data.proposalCount,
      duplicateReferenceCount: payload.data.duplicateReferenceCount,
      normalizableGenericRowCount: payload.data.normalizableGenericRowCount,
    })
  }

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`)
      .then(async (response) => {
        const payload = await response.json() as ProposalPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Site proposals could not be prepared.')
        return payload.data
      })
      .then(
        (data) => {
          if (cancelled) return
          setDrafts(data.proposals.map((proposal) => ({ ...proposal, include: true })))
          setSummary({
            rawReferenceCount: data.rawReferenceCount,
            proposalCount: data.proposalCount,
            duplicateReferenceCount: data.duplicateReferenceCount,
            normalizableGenericRowCount: data.normalizableGenericRowCount,
          })
        },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The Site proposals could not be prepared.') },
      )
    return () => { cancelled = true }
  }, [batchId])

  const selected = useMemo(() => drafts.filter((draft) => draft.include), [drafts])

  function patch(key: string, values: Partial<DraftSite>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...values } : draft))
  }

  async function normalizeLegacyGenericSites() {
    if (!summary.normalizableGenericRowCount) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'NORMALIZE_GENERIC_SITES' }),
      })
      const payload = await response.json() as NormalizePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The existing staged Sites could not be normalized.')
      await load()
      setNotice(`Normalized ${payload.data.normalizedRows.toLocaleString()} staged row${payload.data.normalizedRows === 1 ? '' : 's'} and rebuilt ${payload.data.rebuiltSiteReferences.toLocaleString()} Site reference${payload.data.rebuiltSiteReferences === 1 ? '' : 's'} without resetting the rest of the import.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The existing staged Sites could not be normalized.')
    } finally {
      setBusy(false)
    }
  }

  async function createSelected() {
    if (!selected.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    let created = 0
    let linkedExisting = 0
    try {
      for (let index = 0; index < selected.length; index += 250) {
        const chunk = selected.slice(index, index + 250)
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map((draft) => ({ referenceIds: draft.referenceIds, name: draft.name, code: draft.code })),
          }),
        })
        const payload = await response.json() as CreatePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The prepared Sites could not be created.')
        created += payload.data.created
        linkedExisting += payload.data.linkedExisting
      }
      await load()
      setNotice(`Created ${created.toLocaleString()} Site${created === 1 ? '' : 's'} and linked ${linkedExisting.toLocaleString()} existing Site${linkedExisting === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The prepared Sites could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <PageHeader
      eyebrow="Staged inventory"
      title="Review Site creation"
      description="NOC Orchestrator has grouped raw Site values by their resolved Customer. Edit exceptions, uncheck anything you do not want, then create the prepared Sites in one action."
      actions={<Link href={`/devices/import/${batchId}/bulk`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to bulk resolver</Link>}
    />

    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    {summary.normalizableGenericRowCount ? <section className="mb-5 rounded-lg border border-amber-700/60 bg-amber-950/20 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Existing batch uses generic Site placeholders</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            {summary.normalizableGenericRowCount.toLocaleString()} staged row{summary.normalizableGenericRowCount === 1 ? '' : 's'} still use values such as “Open internet”, while their Organization/Site field contains a more specific location. Normalize only those staged rows and rebuild Site references without resetting your other resolved import work.
          </p>
        </div>
        <Button type="button" variant="primary" disabled={busy} onClick={() => void normalizeLegacyGenericSites()}>
          {busy ? 'Normalizing…' : `Normalize ${summary.normalizableGenericRowCount.toLocaleString()} generic Site row${summary.normalizableGenericRowCount === 1 ? '' : 's'}`}
        </Button>
      </div>
    </section> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Prepared Sites</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {summary.rawReferenceCount.toLocaleString()} raw Site references → {summary.proposalCount.toLocaleString()} canonical proposals.
            {summary.duplicateReferenceCount ? ` ${summary.duplicateReferenceCount.toLocaleString()} duplicate raw reference${summary.duplicateReferenceCount === 1 ? '' : 's'} were collapsed after Customer resolution.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" disabled={busy || !drafts.length} onClick={() => setDrafts((current) => current.map((draft) => ({ ...draft, include: true })))}>Select all</Button>
          <Button type="button" variant="ghost" disabled={busy || !selected.length} onClick={() => setDrafts((current) => current.map((draft) => ({ ...draft, include: false })))}>Clear</Button>
          <Button type="button" variant="primary" disabled={busy || !selected.length} onClick={() => void createSelected()}>{busy ? 'Creating…' : `Create/link ${selected.length.toLocaleString()} prepared Sites`}</Button>
        </div>
      </div>
    </section>

    {drafts.length ? <div className="space-y-3">{drafts.map((draft) => <section key={draft.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[34px_minmax(210px,.8fr)_minmax(260px,1fr)_minmax(180px,.55fr)] xl:items-end">
        <label className="flex h-10 items-center justify-center">
          <input type="checkbox" checked={draft.include} disabled={busy} onChange={(event) => patch(draft.key, { include: event.target.checked })} aria-label={`Include ${draft.name}`} />
        </label>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Customer</div>
          <div className="mt-1 text-sm font-semibold">{draft.customerName}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{draft.customerCode ? `${draft.customerCode} · ` : ''}{draft.referenceIds.length} staged reference{draft.referenceIds.length === 1 ? '' : 's'}</div>
          {draft.organizationSiteSourceValues.length ? <div className="mt-1 text-xs text-[var(--muted)]">Source organization: {draft.organizationSiteSourceValues.join(' · ')}</div> : null}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`site-name-${draft.key}`}>Site name</label>
          <TextInput id={`site-name-${draft.key}`} value={draft.name} disabled={busy} onChange={(event) => patch(draft.key, { name: event.target.value })} />
          {draft.sourceValues.length > 1 ? <div className="mt-1 text-xs text-[var(--muted)]">Raw values: {draft.sourceValues.join(' · ')}</div> : null}
          {draft.existingTarget ? <div className="mt-1 text-xs text-[var(--accent-light)]">Existing Site found: {draft.existingTarget.name}. This row will link instead of creating a duplicate.</div> : null}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`site-code-${draft.key}`}>Site code</label>
          <TextInput id={`site-code-${draft.key}`} value={draft.code} disabled={busy || Boolean(draft.existingTarget)} onChange={(event) => patch(draft.key, { code: event.target.value.toUpperCase() })} />
        </div>
      </div>
    </section>)}</div> : <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-sm text-[var(--muted)]">No unresolved Sites are ready to create. Resolve their Customers first, or all Sites are already linked.</div>}
  </>
}
