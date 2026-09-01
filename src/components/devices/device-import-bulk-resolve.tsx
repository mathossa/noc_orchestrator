'use client'

import Link from 'next/link'
import { useMemo, useState, useEffect } from 'react'
import { SearchableReferencePicker } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import type { DeviceImportReferenceKind } from '@/lib/device-import'

type ApiError = { error?: { message?: string } }

type ReferenceMetadata = {
  customerTargetId?: string | null
  vendorTargetId?: string | null
  deviceTypeTargetId?: string | null
  platform?: string | null
  waitingFor?: DeviceImportReferenceKind[]
}

type StagedReference = {
  id: string
  kind: DeviceImportReferenceKind
  sourceValue: string
  metadata: ReferenceMetadata
  status: 'UNRESOLVED' | 'WAITING' | 'LINKED'
  targetId: string | null
  targetLabel: string | null
  suggestedTargetId: string | null
  suggestedTargetLabel: string | null
  suggestionScore: number | null
  occurrenceCount: number
}

type WorkspaceOptions = {
  customers: Array<{ id: string; code: string | null; name: string; isActive: boolean }>
  sites: Array<{ id: string; customerId: string; code: string | null; name: string; isActive: boolean }>
  vendors: Array<{ id: string; code: string; name: string; isActive: boolean }>
  deviceTypes: Array<{ id: string; code: string; name: string; isActive: boolean }>
  models: Array<{
    id: string
    vendorId: string
    deviceTypeId: string
    model: string
    platform: string | null
    isActive: boolean
    vendor: { id: string; name: string }
    deviceType: { id: string; name: string }
  }>
  contracts: Array<{ id: string; code: string; name: string; isActive: boolean }>
  firmwareReleases: Array<{
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    vendor: { id: string; name: string }
  }>
}

type Workspace = {
  batch: {
    id: string
    profileId: string | null
    profileName: string | null
    fileName: string
    status: string
    totalRows: number
  }
  counts: {
    references: {
      total: number
      linked: number
      unresolved: number
      byKind: Record<string, { total: number; linked: number; unresolved: number; waiting: number }>
    }
  }
  references: StagedReference[]
  options: WorkspaceOptions
}

type WorkspacePayload = { data?: Workspace } & ApiError
type BulkSitePayload = {
  data?: {
    workspace: Workspace
    created: number
    linkedExisting: number
    sites: Array<{ id: string; name: string; code: string; customerId: string }>
  }
} & ApiError

type KindDefinition = { kind: DeviceImportReferenceKind; label: string }
const KINDS: KindDefinition[] = [
  { kind: 'CUSTOMER', label: 'Customers' },
  { kind: 'SITE', label: 'Sites' },
  { kind: 'VENDOR', label: 'Vendors' },
  { kind: 'DEVICE_TYPE', label: 'Device types' },
  { kind: 'DEVICE_MODEL', label: 'Models' },
  { kind: 'FIRMWARE_RELEASE', label: 'Firmware' },
  { kind: 'CONTRACT_TYPE', label: 'Contracts' },
]

function samePlatform(left: string, right: string) {
  return left.normalize('NFKC').trim().toLowerCase() === right.normalize('NFKC').trim().toLowerCase()
}

function referenceOptions(reference: StagedReference, options: WorkspaceOptions) {
  if (reference.kind === 'CUSTOMER') {
    return options.customers.filter((record) => record.isActive)
      .map((record) => ({
        id: record.id,
        label: `${record.name}${record.code ? ` (${record.code})` : ''}`,
        keywords: [record.name, record.code ?? ''],
      }))
  }
  if (reference.kind === 'SITE') {
    return options.sites
      .filter((record) => record.isActive && record.customerId === reference.metadata.customerTargetId)
      .map((record) => ({
        id: record.id,
        label: `${record.name}${record.code ? ` (${record.code})` : ''}`,
        keywords: [record.name, record.code ?? ''],
      }))
  }
  if (reference.kind === 'VENDOR') {
    return options.vendors.filter((record) => record.isActive)
      .map((record) => ({ id: record.id, label: `${record.name} (${record.code})`, keywords: [record.name, record.code] }))
  }
  if (reference.kind === 'DEVICE_TYPE') {
    return options.deviceTypes.filter((record) => record.isActive)
      .map((record) => ({ id: record.id, label: `${record.name} (${record.code})`, keywords: [record.name, record.code] }))
  }
  if (reference.kind === 'DEVICE_MODEL') {
    return options.models
      .filter((record) =>
        record.isActive &&
        (!reference.metadata.vendorTargetId || record.vendorId === reference.metadata.vendorTargetId) &&
        (!reference.metadata.deviceTypeTargetId || record.deviceTypeId === reference.metadata.deviceTypeTargetId),
      )
      .map((record) => ({
        id: record.id,
        label: `${record.vendor.name} · ${record.model} · ${record.deviceType.name}`,
        keywords: [record.model, record.vendor.name, record.deviceType.name, record.platform ?? ''],
      }))
  }
  if (reference.kind === 'CONTRACT_TYPE') {
    return options.contracts.filter((record) => record.isActive)
      .map((record) => ({ id: record.id, label: `${record.name} (${record.code})`, keywords: [record.name, record.code] }))
  }
  return options.firmwareReleases
    .filter((record) =>
      record.isActive &&
      (!reference.metadata.vendorTargetId || record.vendorId === reference.metadata.vendorTargetId) &&
      (!reference.metadata.platform || samePlatform(record.platform, reference.metadata.platform)),
    )
    .map((record) => ({
      id: record.id,
      label: `${record.vendor.name} · ${record.platform} · ${record.version} · ${record.status}`,
      keywords: [record.version, record.platform, record.vendor.name, record.status],
    }))
}

export function DeviceImportBulkResolve({ batchId }: { batchId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [section, setSection] = useState<DeviceImportReferenceKind>('CUSTOMER')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}`)
      .then(async (response) => {
        const payload = await response.json() as WorkspacePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged import could not be loaded.')
        return payload.data
      })
      .then(
        (data) => { if (!cancelled) setWorkspace(data) },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The staged import could not be loaded.') },
      )
    return () => { cancelled = true }
  }, [batchId])

  const activeReferences = useMemo(() =>
    workspace?.references.filter((reference) => reference.kind === section && reference.status === 'UNRESOLVED') ?? [],
  [workspace, section])

  const chosen = useMemo(() => activeReferences.flatMap((reference) => {
    const targetId = choices[reference.id] ?? ''
    return targetId ? [{ referenceId: reference.id, targetId }] : []
  }), [activeReferences, choices])

  function useSuggestions() {
    setChoices((current) => {
      const next = { ...current }
      for (const reference of activeReferences) {
        if (!next[reference.id] && reference.suggestedTargetId) next[reference.id] = reference.suggestedTargetId
      }
      return next
    })
  }

  function clearCurrentChoices() {
    setChoices((current) => {
      const next = { ...current }
      for (const reference of activeReferences) delete next[reference.id]
      return next
    })
  }

  async function applyBulk(remember: boolean) {
    if (!workspace || !chosen.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: chosen.map((item) => ({ ...item, remember })) }),
      })
      const payload = await response.json() as WorkspacePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The selected mappings could not be applied.')
      setWorkspace(payload.data)
      setChoices({})
      const destination = remember ? (payload.data.batch.profileName ?? 'future imports') : 'this batch only'
      setNotice(`Applied ${chosen.length.toLocaleString()} mapping${chosen.length === 1 ? '' : 's'} to ${destination}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The selected mappings could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  async function createAllReadySites() {
    if (!workspace || section !== 'SITE' || !activeReferences.length) return
    const siteReferences = activeReferences.slice(0, 250)
    const batchText = activeReferences.length > siteReferences.length
      ? `${siteReferences.length.toLocaleString()} of ${activeReferences.length.toLocaleString()}`
      : siteReferences.length.toLocaleString()
    if (!window.confirm(`Create ${batchText} unresolved Site${siteReferences.length === 1 ? '' : 's'} using the imported names and generated codes? You can edit them afterward.`)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceIds: siteReferences.map((reference) => reference.id) }),
      })
      const payload = await response.json() as BulkSitePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged Sites could not be created.')
      setWorkspace(payload.data.workspace)
      setChoices({})
      const linkedText = payload.data.linkedExisting ? ` ${payload.data.linkedExisting} already-existing Site${payload.data.linkedExisting === 1 ? ' was' : 's were'} linked instead.` : ''
      const remaining = payload.data.workspace.counts.references.byKind.SITE?.unresolved ?? 0
      const remainingText = remaining ? ` ${remaining.toLocaleString()} unresolved Site${remaining === 1 ? '' : 's'} remain; click again for the next batch.` : ''
      setNotice(`Created and linked ${payload.data.created.toLocaleString()} Site${payload.data.created === 1 ? '' : 's'} with generated codes.${linkedText}${remainingText}`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The staged Sites could not be created.')
    } finally {
      setBusy(false)
    }
  }

  if (!workspace) {
    return <>
      <PageHeader eyebrow="Inventory import" title="Bulk resolve mappings" description="Loading staged entity mappings." />
      <div className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</div>
    </>
  }

  const sectionCount = workspace.counts.references.byKind[section] ?? { total: 0, linked: 0, unresolved: 0, waiting: 0 }
  const profileLabel = workspace.batch.profileName ?? 'general import aliases'

  return <>
    <PageHeader
      eyebrow="Staged inventory"
      title="Bulk resolve mappings"
      description={`${workspace.batch.fileName} · type a code/name/model/version to narrow choices, then apply mappings in bulk.`}
      actions={<Link href={`/devices/import/${batchId}`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Detailed workspace</Link>}
    />

    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Bulk action</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Type to filter by code or label. Press Enter when only one result remains. Only mappings you explicitly choose are submitted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-semibold">{chosen.length.toLocaleString()} chosen</span>
          {section === 'SITE' && activeReferences.length ? <Button type="button" variant="primary" disabled={busy} onClick={() => void createAllReadySites()}>{activeReferences.length > 250 ? 'Create next 250 Sites' : `Create all ${activeReferences.length} Site${activeReferences.length === 1 ? '' : 's'}`}</Button> : null}
          <Button type="button" variant="ghost" disabled={busy || !activeReferences.some((reference) => reference.suggestedTargetId)} onClick={useSuggestions}>Use all suggestions</Button>
          <Button type="button" variant="ghost" disabled={busy || !chosen.length} onClick={clearCurrentChoices}>Clear</Button>
          <Button type="button" variant="ghost" disabled={busy || !chosen.length} onClick={() => void applyBulk(false)}>{busy ? 'Applying…' : `Link ${chosen.length || ''} once`}</Button>
          <Button type="button" variant="primary" disabled={busy || !chosen.length} onClick={() => void applyBulk(true)}>{busy ? 'Applying…' : `Remember ${chosen.length || ''} for ${workspace.batch.profileName ?? 'future imports'}`}</Button>
        </div>
      </div>
    </section>

    <div className="mb-5 flex flex-wrap gap-2">
      {KINDS.map(({ kind, label }) => {
        const count = workspace.counts.references.byKind[kind] ?? { total: 0, linked: 0, unresolved: 0, waiting: 0 }
        return <button
          key={kind}
          type="button"
          onClick={() => { setSection(kind); setChoices({}); setNotice(null) }}
          className={`rounded-md border px-3 py-2 text-sm font-semibold ${section === kind ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'border-[var(--border-strong)] bg-[var(--surface-raised)] hover:bg-[var(--surface-muted)]'}`}
        >
          {label} <span className="ml-1 text-xs opacity-70">{count.linked}/{count.total}</span>
        </button>
      })}
    </div>

    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">{KINDS.find((item) => item.kind === section)?.label}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{sectionCount.unresolved} unresolved · {sectionCount.waiting} waiting on parent entities · remembered mappings go to {profileLabel}.</p>
        </div>
      </div>

      {section === 'SITE' && activeReferences.length ? <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5">
        Bulk-create uses each imported Site name as-is and generates a readable Site code. Code collisions within a Customer receive a numeric suffix. Created Sites can be edited afterward.
      </div> : null}

      {sectionCount.waiting ? <div className="border-b border-[var(--border)] bg-[#282416] px-4 py-3 text-xs text-amber-100 sm:px-5">
        {sectionCount.waiting} value{sectionCount.waiting === 1 ? ' is' : 's are'} waiting for a parent entity. Resolve the parent section first; these are not errors.
      </div> : null}

      {activeReferences.length ? <div className="divide-y divide-[var(--border)]">
        {activeReferences.map((reference) => {
          const options = referenceOptions(reference, workspace.options)
          const selected = choices[reference.id] ?? ''
          return <div key={reference.id} className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(300px,1.2fr)] lg:items-end">
            <div>
              <div className="font-mono text-sm font-semibold">{reference.sourceValue}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{reference.occurrenceCount.toLocaleString()} occurrence{reference.occurrenceCount === 1 ? '' : 's'}</div>
              {reference.suggestedTargetId ? <div className="mt-2 text-xs">
                <span className="text-[var(--muted)]">Suggestion:</span> <strong>{reference.suggestedTargetLabel}</strong>
                {reference.suggestionScore ? <span className="ml-1 text-[var(--muted)]">({Math.round(reference.suggestionScore * 100)}%)</span> : null}
                <button type="button" className="ml-2 font-semibold text-[var(--accent-light)] hover:underline" onClick={() => setChoices((current) => ({ ...current, [reference.id]: reference.suggestedTargetId! }))}>Use</button>
              </div> : null}
            </div>
            <FormField label="Link to existing" htmlFor={`bulk-ref-${reference.id}`} description="Search by code, name, model, platform, or version. Enter selects when one result remains.">
              <SearchableReferencePicker
                id={`bulk-ref-${reference.id}`}
                value={selected}
                options={options}
                disabled={busy}
                onChange={(value) => setChoices((current) => ({ ...current, [reference.id]: value }))}
              />
            </FormField>
          </div>
        })}
      </div> : <div className="px-4 py-8 text-sm text-[var(--muted)] sm:px-5">
        {sectionCount.waiting ? 'No values in this section are ready for mapping yet.' : 'No unresolved values remain in this section.'}
      </div>}
    </section>
  </>
}
