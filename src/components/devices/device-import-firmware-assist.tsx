'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'

type ApiError = { error?: { message?: string } }
type FirmwareProposal = {
  key: string
  vendorId: string
  vendorName: string
  vendorCode: string
  referenceIds: string[]
  versions: string[]
  version: string
  platform: string
  modelIds: string[]
  modelNames: string[]
  status: string
  existingTarget: { id: string; version: string; platform: string; status: string } | null
}
type Assist = { proposals: FirmwareProposal[]; rawReferenceCount: number; proposalCount: number }
type AssistPayload = { data?: Assist } & ApiError
type CreatePayload = { data?: { created: number; linkedExisting: number; assist: Assist } } & ApiError
type DraftFirmware = FirmwareProposal & { include: boolean }

const STATUSES = ['AVAILABLE', 'TESTING', 'APPROVED', 'RECOMMENDED', 'DEPRECATED', 'BLOCKED'] as const

export function DeviceImportFirmwareAssist({ batchId }: { batchId: string }) {
  const [drafts, setDrafts] = useState<DraftFirmware[]>([])
  const [summary, setSummary] = useState({ rawReferenceCount: 0, proposalCount: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function install(data: Assist) {
    setDrafts(data.proposals.map((proposal) => ({ ...proposal, include: true })))
    setSummary({ rawReferenceCount: data.rawReferenceCount, proposalCount: data.proposalCount })
  }

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`)
      .then(async (response) => {
        const payload = await response.json() as AssistPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Firmware proposals could not be loaded.')
        return payload.data
      })
      .then(
        (data) => { if (!cancelled) install(data) },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The Firmware proposals could not be loaded.') },
      )
    return () => { cancelled = true }
  }, [batchId])

  const selected = useMemo(() => drafts.filter((draft) => draft.include), [drafts])

  function patch(key: string, values: Partial<DraftFirmware>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...values } : draft))
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
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map((draft) => ({
              referenceIds: draft.referenceIds,
              version: draft.version,
              platform: draft.platform,
              status: draft.status,
            })),
          }),
        })
        const payload = await response.json() as CreatePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The prepared Firmware Releases could not be created.')
        created += payload.data.created
        linkedExisting += payload.data.linkedExisting
        if (index + 250 >= selected.length) install(payload.data.assist)
      }
      setNotice(`Created ${created.toLocaleString()} Firmware Release${created === 1 ? '' : 's'} and linked ${linkedExisting.toLocaleString()} existing Release${linkedExisting === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The prepared Firmware Releases could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <PageHeader
      eyebrow="Staged inventory"
      title="Review Firmware creation"
      description="Repeated device firmware is collapsed into canonical Vendor + Platform + Version proposals. Review the defaults, edit exceptions, then create/link the selected Releases in one action."
      actions={<Link href={`/devices/import/${batchId}/bulk`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to bulk resolver</Link>}
    />

    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-sm font-semibold">Prepared Firmware Releases</h2><p className="mt-1 text-xs text-[var(--muted)]">{summary.rawReferenceCount.toLocaleString()} raw firmware references → {summary.proposalCount.toLocaleString()} canonical proposals.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={busy || !drafts.length} onClick={() => setDrafts((current) => current.map((draft) => ({ ...draft, include: true })))}>Select all</Button>
          <Button type="button" variant="ghost" disabled={busy || !selected.length} onClick={() => setDrafts((current) => current.map((draft) => ({ ...draft, include: false })))}>Clear</Button>
          <Button type="button" variant="primary" disabled={busy || !selected.length} onClick={() => void createSelected()}>{busy ? 'Creating…' : `Create/link ${selected.length.toLocaleString()} Releases`}</Button>
        </div>
      </div>
    </section>

    {drafts.length ? <div className="space-y-3">{drafts.map((draft) => <section key={draft.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[34px_minmax(180px,.65fr)_minmax(230px,.9fr)_minmax(180px,.65fr)_minmax(170px,.6fr)_minmax(260px,1fr)] xl:items-end">
        <label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={busy} onChange={(event) => patch(draft.key, { include: event.target.checked })} aria-label={`Include firmware ${draft.version}`} /></label>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vendor</div><div className="mt-1 text-sm font-semibold">{draft.vendorName}</div><div className="mt-1 text-xs text-[var(--muted)]">{draft.vendorCode}</div></div>
        <div><label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`firmware-platform-${draft.key}`}>Platform</label><TextInput id={`firmware-platform-${draft.key}`} value={draft.platform} disabled={busy || Boolean(draft.existingTarget)} placeholder="Required" onChange={(event) => patch(draft.key, { platform: event.target.value })} />{!draft.platform ? <div className="mt-1 text-xs font-medium text-amber-200">Model has no Platform yet; enter the firmware compatibility platform before creating.</div> : null}</div>
        <div><label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`firmware-version-${draft.key}`}>Version</label><TextInput id={`firmware-version-${draft.key}`} value={draft.version} disabled={busy || Boolean(draft.existingTarget)} onChange={(event) => patch(draft.key, { version: event.target.value })} /></div>
        <div><label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`firmware-status-${draft.key}`}>Catalog status</label><SelectInput id={`firmware-status-${draft.key}`} value={draft.status} disabled={busy || Boolean(draft.existingTarget)} onChange={(event) => patch(draft.key, { status: event.target.value })}>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</SelectInput></div>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Applies to imported Models</div><div className="mt-1 text-sm">{draft.modelNames.join(', ')}</div><div className="mt-1 text-xs text-[var(--muted)]">Raw version{draft.versions.length === 1 ? '' : 's'}: {draft.versions.join(' · ')}</div>{draft.existingTarget ? <div className="mt-1 text-xs text-[var(--accent-light)]">Existing Release found; this proposal will link it instead of creating a duplicate.</div> : null}</div>
      </div>
    </section>)}</div> : <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-sm text-[var(--muted)]">No unresolved Firmware Releases are ready. Resolve/create Models first, or all Firmware is already linked.</div>}
  </>
}
