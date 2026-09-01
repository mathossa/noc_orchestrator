'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import type { DeviceImportPreview, DeviceImportReferenceKind, DeviceImportResult } from '@/lib/device-import'
import { suggestedImportReferenceCode } from '@/lib/device-import-staging'

type ApiError = { error?: { message?: string } }
type ReferenceMetadata = {
  rowNumbers?: number[]
  customerSourceValue?: string | null
  customerTargetId?: string | null
  vendorSourceValue?: string | null
  vendorTargetId?: string | null
  deviceTypeSourceValue?: string | null
  deviceTypeTargetId?: string | null
  modelSourceValue?: string | null
  modelTargetId?: string | null
  platform?: string | null
  waitingFor?: DeviceImportReferenceKind[]
}
type StagedReference = {
  id: string
  batchId: string
  kind: DeviceImportReferenceKind
  sourceValue: string
  normalizedSourceValue: string
  contextKey: string
  metadata: ReferenceMetadata
  status: 'UNRESOLVED' | 'WAITING' | 'LINKED'
  targetId: string | null
  targetLabel: string | null
  suggestedTargetId: string | null
  suggestedTargetLabel: string | null
  suggestionScore: number | null
  resolutionSource: string | null
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
    familyId: string | null
    model: string
    platform: string | null
    isActive: boolean
    vendor: { id: string; code: string; name: string; isActive: boolean }
    deviceType: { id: string; code: string; name: string; isActive: boolean }
  }>
  contracts: Array<{ id: string; code: string; name: string; isActive: boolean }>
  firmwareReleases: Array<{
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    vendor: { id: string; code: string; name: string; isActive: boolean }
  }>
}
type Workspace = {
  batch: {
    id: string
    profileId: string | null
    profileName: string | null
    fileName: string
    sheetName: string
    headerRow: number
    status: string
    totalRows: number
    publishedAt: string | null
    createdAt: string
    updatedAt: string
  }
  counts: {
    references: {
      total: number
      linked: number
      unresolved: number
      byKind: Record<string, { total: number; linked: number; unresolved: number; waiting: number }>
    }
    rows: { total: number; sample: number }
  }
  references: StagedReference[]
  rows: Array<{ id: string; rowNumber: number; rawData: unknown; mappedData: unknown; status: string }>
  options: WorkspaceOptions
  canValidate: boolean
  canPublish: boolean
}
type WorkspacePayload = { data?: Workspace } & ApiError
type PreviewPayload = { data?: DeviceImportPreview } & ApiError
type ResultPayload = { data?: DeviceImportResult } & ApiError

type CreateDraft = {
  name: string
  code: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string
  version: string
}

const KINDS: Array<{ kind: DeviceImportReferenceKind; label: string; description: string }> = [
  { kind: 'CUSTOMER', label: 'Customers', description: 'Organizations discovered in the source export.' },
  { kind: 'SITE', label: 'Sites', description: 'Locations resolved inside their customer.' },
  { kind: 'VENDOR', label: 'Vendors', description: 'Hardware manufacturers.' },
  { kind: 'DEVICE_TYPE', label: 'Device types', description: 'Switch, Firewall, Access Point, and similar categories.' },
  { kind: 'DEVICE_MODEL', label: 'Models', description: 'Concrete hardware models after Vendor and Type are known.' },
  { kind: 'FIRMWARE_RELEASE', label: 'Firmware', description: 'Current firmware values after Model/platform are known.' },
  { kind: 'CONTRACT_TYPE', label: 'Contracts', description: 'Contract context is validated, never assigned to Device.' },
]

function samePlatform(left: string, right: string) {
  return left.normalize('NFKC').trim().toLowerCase() === right.normalize('NFKC').trim().toLowerCase()
}

function initialDraft(reference: StagedReference, options: WorkspaceOptions): CreateDraft {
  return {
    name: reference.sourceValue,
    code: suggestedImportReferenceCode(reference.sourceValue),
    vendorId: reference.metadata.vendorTargetId ?? options.vendors.find((record) => record.isActive)?.id ?? '',
    deviceTypeId: reference.metadata.deviceTypeTargetId ?? options.deviceTypes.find((record) => record.isActive)?.id ?? '',
    model: reference.sourceValue,
    platform: reference.metadata.platform ?? '',
    version: reference.sourceValue,
  }
}

function mappedSummary(mappedData: unknown) {
  const value = typeof mappedData === 'object' && mappedData !== null ? mappedData as Record<string, unknown> : {}
  return {
    identity: String(value.name ?? value.hostname ?? value.externalId ?? 'Unnamed device'),
    customer: String(value.customer ?? '—'),
    site: String(value.site ?? '—'),
    vendor: String(value.vendor ?? '—'),
    model: String(value.model ?? '—'),
    firmware: String(value.currentFirmware ?? '—'),
  }
}

export function DeviceImportBatchWorkspace({ batchId }: { batchId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [section, setSection] = useState<DeviceImportReferenceKind | 'OVERVIEW' | 'DEVICES'>('OVERVIEW')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [createId, setCreateId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, CreateDraft>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null)
  const [result, setResult] = useState<DeviceImportResult | null>(null)

  const loadWorkspace = useCallback(async () => {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}`)
    const payload = (await response.json()) as WorkspacePayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged import could not be loaded.')
    setWorkspace(payload.data)
    return payload.data
  }, [batchId])

  useEffect(() => {
    void loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'The staged import could not be loaded.'))
  }, [loadWorkspace])

  const unresolvedKinds = useMemo(() => {
    if (!workspace) return []
    return KINDS.filter(({ kind }) => (workspace.counts.references.byKind[kind]?.unresolved ?? 0) + (workspace.counts.references.byKind[kind]?.waiting ?? 0) > 0)
  }, [workspace])

  function choiceOptions(reference: StagedReference) {
    if (!workspace) return []
    const options = workspace.options
    if (reference.kind === 'CUSTOMER') return options.customers.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name}${r.code ? ` (${r.code})` : ''}` }))
    if (reference.kind === 'SITE') return options.sites.filter((r) => r.isActive && r.customerId === reference.metadata.customerTargetId).map((r) => ({ id: r.id, label: `${r.name}${r.code ? ` (${r.code})` : ''}` }))
    if (reference.kind === 'VENDOR') return options.vendors.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
    if (reference.kind === 'DEVICE_TYPE') return options.deviceTypes.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
    if (reference.kind === 'DEVICE_MODEL') return options.models
      .filter((r) => r.isActive && (!reference.metadata.vendorTargetId || r.vendorId === reference.metadata.vendorTargetId) && (!reference.metadata.deviceTypeTargetId || r.deviceTypeId === reference.metadata.deviceTypeTargetId))
      .map((r) => ({ id: r.id, label: `${r.vendor.name} · ${r.model} · ${r.deviceType.name}` }))
    if (reference.kind === 'CONTRACT_TYPE') return options.contracts.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
    return options.firmwareReleases
      .filter((r) => r.isActive && (!reference.metadata.vendorTargetId || r.vendorId === reference.metadata.vendorTargetId) && (!reference.metadata.platform || samePlatform(r.platform, reference.metadata.platform)))
      .map((r) => ({ id: r.id, label: `${r.vendor.name} · ${r.platform} · ${r.version} · ${r.status}` }))
  }

  async function resolve(reference: StagedReference, targetId: string, remember: boolean, created = false) {
    if (!targetId) return
    setBusy(reference.id)
    setError(null)
    setNotice(null)
    setPreview(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/${reference.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, remember, created }),
      })
      const payload = (await response.json()) as WorkspacePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged reference could not be resolved.')
      setWorkspace(payload.data)
      setChoices((current) => ({ ...current, [reference.id]: '' }))
      setCreateId(null)
      setNotice(remember
        ? `Remembered “${reference.sourceValue}” for ${payload.data.batch.profileName ?? 'future imports'}.`
        : `Linked “${reference.sourceValue}” for this staged batch.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The staged reference could not be resolved.')
    } finally {
      setBusy(null)
    }
  }

  async function refresh() {
    setBusy('refresh')
    setError(null)
    setPreview(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/refresh`, { method: 'POST' })
      const payload = (await response.json()) as WorkspacePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged references could not be refreshed.')
      setWorkspace(payload.data)
      setNotice('Reference matches refreshed from current NOC Orchestrator data and the selected import profile.')
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'The staged references could not be refreshed.')
    } finally {
      setBusy(null)
    }
  }

  function openCreate(reference: StagedReference) {
    if (!workspace) return
    setCreateId((current) => current === reference.id ? null : reference.id)
    setDrafts((current) => current[reference.id] ? current : { ...current, [reference.id]: initialDraft(reference, workspace.options) })
  }

  function updateDraft(reference: StagedReference, patch: Partial<CreateDraft>) {
    if (!workspace) return
    setDrafts((current) => ({ ...current, [reference.id]: { ...(current[reference.id] ?? initialDraft(reference, workspace.options)), ...patch } }))
  }

  async function postJson<T extends { id: string }>(url: string, body: unknown, fallback: string) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = (await response.json()) as { data?: T } & ApiError
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? fallback)
    return payload.data
  }

  async function createReference(reference: StagedReference, remember: boolean) {
    if (!workspace) return
    const draft = drafts[reference.id] ?? initialDraft(reference, workspace.options)
    setBusy(reference.id)
    setError(null)
    setNotice(null)
    try {
      let record: { id: string }
      if (reference.kind === 'CUSTOMER') {
        record = await postJson('/api/v1/customers', { name: draft.name, code: draft.code || null, source: 'IMPORT', isActive: true }, 'The customer could not be created.')
      } else if (reference.kind === 'SITE') {
        const customerId = reference.metadata.customerTargetId
        if (!customerId) throw new Error('Resolve the customer before creating this site.')
        record = await postJson(`/api/v1/customers/${customerId}/sites`, { name: draft.name, code: draft.code || null, source: 'IMPORT', isActive: true }, 'The site could not be created.')
      } else if (reference.kind === 'VENDOR') {
        record = await postJson('/api/v1/reference-data/vendors', { code: draft.code, name: draft.name, isActive: true }, 'The vendor could not be created.')
      } else if (reference.kind === 'DEVICE_TYPE') {
        record = await postJson('/api/v1/reference-data/device-types', { code: draft.code, name: draft.name, isActive: true }, 'The device type could not be created.')
      } else if (reference.kind === 'DEVICE_MODEL') {
        if (!draft.vendorId) throw new Error('Resolve or choose the Vendor before creating this model.')
        if (!draft.deviceTypeId) throw new Error('Resolve or choose the Device Type before creating this model.')
        record = await postJson('/api/v1/models', {
          vendorId: draft.vendorId,
          deviceTypeId: draft.deviceTypeId,
          familyId: null,
          model: draft.model,
          platform: draft.platform || null,
          source: 'IMPORT',
          notes: `Created from staged XLSX value “${reference.sourceValue}”.`,
        }, 'The device model could not be created.')
      } else if (reference.kind === 'CONTRACT_TYPE') {
        record = await postJson('/api/v1/reference-data/contract-types', { code: draft.code, name: draft.name, firmwareManagementEnabled: true, isActive: true }, 'The contract type could not be created.')
      } else {
        if (!draft.vendorId) throw new Error('Resolve the model/vendor before creating this firmware release.')
        if (!draft.platform) throw new Error('A platform is required before creating this firmware release.')
        record = await postJson('/api/v1/firmware-releases', {
          vendorId: draft.vendorId,
          platform: draft.platform,
          version: draft.version,
          status: 'AVAILABLE',
          source: 'IMPORT',
          notes: `Created from staged XLSX value “${reference.sourceValue}”.`,
          isActive: true,
        }, 'The firmware release could not be created.')
      }
      await resolve(reference, record.id, remember, true)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The reference record could not be created.')
      setBusy(null)
    }
  }

  async function validateBatch() {
    setBusy('validate')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/validate`, { method: 'POST' })
      const payload = (await response.json()) as PreviewPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged devices could not be validated.')
      setPreview(payload.data)
      if (!payload.data.counts.error && !payload.data.counts.conflict) setNotice('Final device validation is clean. The batch is ready to publish.')
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'The staged devices could not be validated.')
    } finally {
      setBusy(null)
    }
  }

  async function publishBatch() {
    if (!preview || preview.counts.error || preview.counts.conflict) return
    const total = preview.counts.create + preview.counts.update
    if (!window.confirm(`Publish this staged batch? ${total.toLocaleString()} device row(s) will be created or updated in global inventory.`)) return
    setBusy('publish')
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/publish`, { method: 'POST' })
      const payload = (await response.json()) as ResultPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged batch could not be published.')
      setResult(payload.data)
      await loadWorkspace()
      setNotice('The staged batch has been accepted and published to normal inventory.')
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'The staged batch could not be published.')
    } finally {
      setBusy(null)
    }
  }

  if (!workspace) return <><PageHeader eyebrow="Inventory import" title="Loading staged import…" description="Loading the quarantined import workspace." /><div className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</div></>

  const activeReferences = section === 'OVERVIEW' || section === 'DEVICES'
    ? []
    : workspace.references.filter((reference) => reference.kind === section)
  const published = workspace.batch.status === 'PUBLISHED'

  return <>
    <PageHeader eyebrow="Staged inventory" title={workspace.batch.fileName} description={`${workspace.batch.totalRows.toLocaleString()} raw device rows · ${workspace.batch.profileName ?? 'No saved profile'} · nothing in this batch becomes normal inventory until publication.`} actions={<Link href="/devices/import" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Import inbox</Link>} />
    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Raw rows" value={workspace.batch.totalRows} />
        <Stat label="Unique entities" value={workspace.counts.references.total} />
        <Stat label="Linked" value={workspace.counts.references.linked} />
        <Stat label="Need attention" value={workspace.counts.references.unresolved} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <p className="text-xs text-[var(--muted)]">{published ? `Published ${workspace.batch.publishedAt ? new Date(workspace.batch.publishedAt).toLocaleString() : ''}` : unresolvedKinds.length ? `Resolve ${unresolvedKinds.map((item) => item.label).join(', ')} before final device validation.` : 'All unique references are linked. Run final device validation before publishing.'}</p>
        {!published ? <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={() => void refresh()} disabled={busy !== null}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh matches'}</Button><Button type="button" variant="primary" onClick={() => void validateBatch()} disabled={!workspace.canValidate || busy !== null}>{busy === 'validate' ? 'Validating…' : 'Validate staged devices'}</Button></div> : <Link href="/devices?source=IMPORT" className="rounded-md border border-[#4a8b6c] bg-[#1b382c] px-3 py-2 text-sm font-semibold text-[#c8f3da]">View published inventory</Link>}
      </div>
    </section>

    <div className="mb-5 flex flex-wrap gap-2">
      <SectionButton active={section === 'OVERVIEW'} onClick={() => setSection('OVERVIEW')}>Overview</SectionButton>
      {KINDS.map((item) => { const count = workspace.counts.references.byKind[item.kind] ?? { total: 0, linked: 0, unresolved: 0, waiting: 0 }; return <SectionButton key={item.kind} active={section === item.kind} onClick={() => setSection(item.kind)}>{item.label} <span className="ml-1 text-xs opacity-70">{count.linked}/{count.total}</span></SectionButton> })}
      <SectionButton active={section === 'DEVICES'} onClick={() => setSection('DEVICES')}>Devices <span className="ml-1 text-xs opacity-70">{workspace.batch.totalRows.toLocaleString()}</span></SectionButton>
    </div>

    {section === 'OVERVIEW' ? <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold">Resolve unique source entities</h2><p className="mt-1 text-xs text-[var(--muted)]">Repeated spreadsheet values are collapsed. Resolve a value once and every staged device using it inherits the decision.</p></div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">{KINDS.map((item) => {
        const count = workspace.counts.references.byKind[item.kind] ?? { total: 0, linked: 0, unresolved: 0, waiting: 0 }
        return <button key={item.kind} type="button" onClick={() => setSection(item.kind)} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-left hover:border-[var(--border-strong)]">
          <div className="flex items-start justify-between gap-3"><div className="font-semibold">{item.label}</div><span className="text-xs text-[var(--muted)]">{count.linked}/{count.total}</span></div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.description}</p>
          <div className="mt-3 flex gap-2 text-xs"><span>{count.unresolved} unresolved</span><span>·</span><span>{count.waiting} waiting</span></div>
        </button>
      })}</div>
    </section> : null}

    {section !== 'OVERVIEW' && section !== 'DEVICES' ? <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold">{KINDS.find((item) => item.kind === section)?.label}</h2><p className="mt-1 text-xs text-[var(--muted)]">Suggestions are never silently accepted. “Remember” stores the decision in {workspace.batch.profileName ?? 'the general import alias set'} for later imports.</p></div>
      {activeReferences.length ? <div className="divide-y divide-[var(--border)]">{activeReferences.map((reference) => {
        const options = choiceOptions(reference)
        const selected = choices[reference.id] ?? reference.suggestedTargetId ?? ''
        const draft = drafts[reference.id] ?? initialDraft(reference, workspace.options)
        return <div key={reference.id} className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="font-mono text-sm font-semibold">{reference.sourceValue}</div><div className="mt-1 text-xs text-[var(--muted)]">{reference.occurrenceCount.toLocaleString()} occurrence{reference.occurrenceCount === 1 ? '' : 's'}{reference.metadata.rowNumbers?.length ? ` · sample rows ${reference.metadata.rowNumbers.join(', ')}` : ''}</div></div>
            <StatusBadge reference={reference} />
          </div>
          {reference.status === 'LINKED' ? <div className="mt-3 rounded-md border border-[#285f48] bg-[#142b22] px-3 py-2 text-sm text-[#a9e8c6]">Linked to <strong>{reference.targetLabel ?? reference.targetId}</strong> · {reference.resolutionSource ?? 'resolved'}</div> : null}
          {reference.status === 'WAITING' ? <div className="mt-3 rounded-md border border-[#4e4a2a] bg-[#282416] px-3 py-2 text-sm text-amber-100">Waiting for {reference.metadata.waitingFor?.map((kind) => kind.replaceAll('_', ' ')).join(' + ') || 'a parent entity'} to be resolved first. This is not a row error.</div> : null}
          {reference.status === 'UNRESOLVED' ? <>
            {reference.suggestedTargetId ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2"><div className="text-sm"><span className="text-[var(--muted)]">Suggested:</span> <strong>{reference.suggestedTargetLabel}</strong>{reference.suggestionScore ? <span className="ml-2 text-xs text-[var(--muted)]">{Math.round(reference.suggestionScore * 100)}% similarity</span> : null}</div><div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => void resolve(reference, reference.suggestedTargetId!, false)} disabled={busy !== null}>Use suggestion</Button><Button type="button" variant="ghost" onClick={() => void resolve(reference, reference.suggestedTargetId!, true)} disabled={busy !== null}>Use + remember</Button></div></div> : null}
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
              <FormField label="Link to existing" htmlFor={`staged-ref-${reference.id}`}><SelectInput id={`staged-ref-${reference.id}`} value={selected} onChange={(event) => setChoices((current) => ({ ...current, [reference.id]: event.target.value }))}><option value="">Choose configured record</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</SelectInput></FormField>
              <Button type="button" variant="ghost" disabled={!selected || busy !== null} onClick={() => void resolve(reference, selected, false)}>Link once</Button>
              <Button type="button" variant="ghost" disabled={!selected || busy !== null} onClick={() => void resolve(reference, selected, true)}>{workspace.batch.profileName ? `Remember for ${workspace.batch.profileName}` : 'Remember match'}</Button>
              <Button type="button" variant="primary" disabled={busy !== null} onClick={() => openCreate(reference)}>{createId === reference.id ? 'Close create' : 'Create new'}</Button>
            </div>
            {createId === reference.id ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <CreateFields reference={reference} draft={draft} options={workspace.options} onChange={(patch) => updateDraft(reference, patch)} />
              <div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void createReference(reference, false)}>Create + link</Button><Button type="button" variant="primary" disabled={busy !== null} onClick={() => void createReference(reference, true)}>Create + remember</Button></div>
            </div> : null}
          </> : null}
        </div>
      })}</div> : <div className="px-4 py-6 text-sm text-[var(--muted)] sm:px-5">No values of this type were found in the staged workbook.</div>}
    </section> : null}

    {section === 'DEVICES' ? <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold">Raw staged devices</h2><p className="mt-1 text-xs text-[var(--muted)]">Showing {workspace.rows.length} sample rows from {workspace.batch.totalRows.toLocaleString()}. These are quarantined and are not visible in normal inventory.</p></div>
      <div className="noc-scrollbar overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Identity</th><th className="px-3 py-2">Customer / site</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Firmware</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{workspace.rows.map((row) => { const summary = mappedSummary(row.mappedData); return <tr key={row.id}><td className="px-3 py-2 tabular-nums text-[var(--muted)]">{row.rowNumber}</td><td className="px-3 py-2 font-semibold">{summary.identity}</td><td className="px-3 py-2"><div>{summary.customer}</div><div className="text-xs text-[var(--muted)]">{summary.site}</div></td><td className="px-3 py-2">{summary.vendor}</td><td className="px-3 py-2">{summary.model}</td><td className="px-3 py-2 font-mono">{summary.firmware}</td></tr> })}</tbody></table></div>
    </section> : null}

    {preview ? <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5"><div><h2 className="text-sm font-semibold">Final device validation</h2><p className="mt-1 text-xs text-[var(--muted)]">This uses the same canonical device validation as normal inventory. No devices have been published yet.</p></div><div className="flex flex-wrap gap-2 text-xs"><Count label="Create" value={preview.counts.create} /><Count label="Update" value={preview.counts.update} /><Count label="Unchanged" value={preview.counts.unchanged} /><Count label="Conflict" value={preview.counts.conflict} /><Count label="Error" value={preview.counts.error} /></div></div>
      {preview.rows.length ? <div className="noc-scrollbar overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><tbody className="divide-y divide-[var(--border)]">{preview.rows.map((row) => <tr key={row.rowNumber} className={row.action === 'ERROR' || row.action === 'CONFLICT' ? 'bg-[#2a1b1b]/35' : ''}><td className="px-3 py-2 tabular-nums">{row.rowNumber}</td><td className="px-3 py-2 font-semibold">{row.action}</td><td className="px-3 py-2">{row.identity}</td><td className="px-3 py-2">{row.customer ?? '—'} / {row.site ?? '—'}</td><td className="px-3 py-2">{row.model ?? '—'}</td><td className="px-3 py-2 text-xs">{row.issues.map((issue) => issue.message).join(' · ') || `${row.changes.length} change(s)`}</td></tr>)}</tbody></table></div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-5"><p className="max-w-3xl text-xs text-[var(--muted)]">Publishing is blocked while any device row has an Error or Conflict. Desired firmware/lifecycle/planning state is never imported.</p><Button variant="primary" onClick={() => void publishBatch()} disabled={published || preview.counts.error > 0 || preview.counts.conflict > 0 || busy !== null}>{busy === 'publish' ? 'Publishing…' : 'Accept and publish batch'}</Button></div>
    </section> : null}

    {result ? <section className="mt-5 rounded-lg border border-[#285f48] bg-[#142b22] p-5"><h2 className="text-sm font-semibold text-[#c8f3da]">Import published</h2><div className="mt-4 grid gap-3 sm:grid-cols-4"><Stat label="Created" value={result.created} /><Stat label="Updated" value={result.updated} /><Stat label="Skipped" value={result.skipped} /><Stat label="Failed" value={result.failed} /></div></section> : null}
  </>
}

function CreateFields({ reference, draft, options, onChange }: { reference: StagedReference; draft: CreateDraft; options: WorkspaceOptions; onChange: (patch: Partial<CreateDraft>) => void }) {
  if (reference.kind === 'DEVICE_MODEL') return <div className="grid gap-3 md:grid-cols-2">
    <FormField label="Vendor" htmlFor={`create-vendor-${reference.id}`} description="Usually inherited from the resolved staged Vendor."><SelectInput id={`create-vendor-${reference.id}`} value={draft.vendorId} onChange={(event) => onChange({ vendorId: event.target.value })}><option value="">Select vendor</option>{options.vendors.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
    <FormField label="Device type" htmlFor={`create-type-${reference.id}`} description="Usually inherited from the resolved staged Device Type."><SelectInput id={`create-type-${reference.id}`} value={draft.deviceTypeId} onChange={(event) => onChange({ deviceTypeId: event.target.value })}><option value="">Select type</option>{options.deviceTypes.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
    <FormField label="Concrete model name" htmlFor={`create-model-${reference.id}`} description="Preserves the exact source notation by default."><TextInput id={`create-model-${reference.id}`} value={draft.model} onChange={(event) => onChange({ model: event.target.value })} /></FormField>
    <FormField label="Platform" htmlFor={`create-platform-${reference.id}`} description="Optional now; required for precise firmware compatibility."><TextInput id={`create-platform-${reference.id}`} value={draft.platform} onChange={(event) => onChange({ platform: event.target.value })} /></FormField>
  </div>
  if (reference.kind === 'FIRMWARE_RELEASE') return <div className="grid gap-3 md:grid-cols-3">
    <FormField label="Vendor" htmlFor={`create-fw-vendor-${reference.id}`}><SelectInput id={`create-fw-vendor-${reference.id}`} value={draft.vendorId} onChange={(event) => onChange({ vendorId: event.target.value })}><option value="">Select vendor</option>{options.vendors.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
    <FormField label="Platform" htmlFor={`create-fw-platform-${reference.id}`}><TextInput id={`create-fw-platform-${reference.id}`} value={draft.platform} onChange={(event) => onChange({ platform: event.target.value })} /></FormField>
    <FormField label="Version" htmlFor={`create-fw-version-${reference.id}`}><TextInput id={`create-fw-version-${reference.id}`} value={draft.version} onChange={(event) => onChange({ version: event.target.value })} /></FormField>
  </div>
  if (reference.kind === 'SITE') return <div className="grid gap-3 md:grid-cols-2"><FormField label="Site name" htmlFor={`create-name-${reference.id}`} description="The Customer is already resolved and enforced server-side."><TextInput id={`create-name-${reference.id}`} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} /></FormField><FormField label="Site code" htmlFor={`create-code-${reference.id}`}><TextInput id={`create-code-${reference.id}`} value={draft.code} onChange={(event) => onChange({ code: event.target.value })} /></FormField></div>
  return <div className="grid gap-3 md:grid-cols-2"><FormField label="Name" htmlFor={`create-name-${reference.id}`}><TextInput id={`create-name-${reference.id}`} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} /></FormField><FormField label="Code" htmlFor={`create-code-${reference.id}`}><TextInput id={`create-code-${reference.id}`} value={draft.code} onChange={(event) => onChange({ code: event.target.value })} /></FormField></div>
}

function StatusBadge({ reference }: { reference: StagedReference }) {
  if (reference.status === 'LINKED') return <span className="rounded border border-[#285f48] bg-[#142b22] px-2 py-1 text-xs font-semibold text-[#a9e8c6]">Linked</span>
  if (reference.status === 'WAITING') return <span className="rounded border border-[#4e4a2a] bg-[#282416] px-2 py-1 text-xs font-semibold text-amber-100">Waiting</span>
  return <span className="rounded border border-[#754040] bg-[#2a1b1b] px-2 py-1 text-xs font-semibold text-[#f0b0b0]">Needs review</span>
}

function SectionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-md border px-3 py-2 text-sm font-semibold ${active ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'border-[var(--border-strong)] bg-[var(--surface-raised)] hover:bg-[var(--surface-muted)]'}`}>{children}</button>
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</div></div>
}

function Count({ label, value }: { label: string; value: number }) {
  return <span className="rounded border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1"><strong>{value.toLocaleString()}</strong> {label}</span>
}
