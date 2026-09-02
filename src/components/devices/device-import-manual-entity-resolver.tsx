'use client'

import { useMemo, useState } from 'react'
import { SearchableReferencePicker } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import type { DeviceImportReferenceKind } from '@/lib/device-import'

type ApiError = { error?: { message?: string } }
type ReferenceMetadata = {
  customerTargetId?: string | null
  vendorTargetId?: string | null
  deviceTypeTargetId?: string | null
  modelTargetId?: string | null
  platform?: string | null
  platforms?: string[]
}
type Reference = {
  id: string
  kind: DeviceImportReferenceKind
  sourceValue: string
  status: 'UNRESOLVED' | 'WAITING' | 'LINKED'
  occurrenceCount: number
  metadata: ReferenceMetadata
}
type OptionRecord = { id: string; code?: string | null; name: string; isActive: boolean }
type ModelRecord = {
  id: string
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string | null
  isActive: boolean
  vendor: { id: string; name: string }
  deviceType: { id: string; name: string }
}
type Family = { id: string; vendorId: string; name: string; isActive: boolean }
type LinkedModel = {
  id: string
  vendorId: string
  familyId: string | null
  model: string
  platform: string | null
  supportedPlatforms: Array<{ id: string; platform: string }>
  vendor: { id: string; code: string; name: string }
  proposedNewFamilyName: string | null
}
type Assist = {
  workspace: {
    batch: { status: string }
    references: Reference[]
    options: {
      customers: OptionRecord[]
      vendors: OptionRecord[]
      deviceTypes: OptionRecord[]
      models: ModelRecord[]
      contracts: OptionRecord[]
    }
  }
  models: { linkedModels: LinkedModel[]; families: Family[] }
}
type AssistPayload = { data?: Assist } & ApiError

type Draft = {
  name: string
  code: string
  customerId: string
  vendorId: string
  deviceTypeId: string
  modelId: string
  model: string
  platform: string
  platforms: string
  familyId: string
  version: string
  status: string
}

const KIND_LABELS: Record<DeviceImportReferenceKind, string> = {
  CUSTOMER: 'Customer',
  SITE: 'Site',
  VENDOR: 'Vendor',
  DEVICE_TYPE: 'Device Type',
  DEVICE_MODEL: 'Device Model',
  FIRMWARE_RELEASE: 'Firmware Release',
  CONTRACT_TYPE: 'Contract Type',
}

function emptyDraft(): Draft {
  return {
    name: '', code: '', customerId: '', vendorId: '', deviceTypeId: '', modelId: '', model: '',
    platform: '', platforms: '', familyId: '', version: '', status: 'AVAILABLE',
  }
}

function suggestedCode(value: string, separator: '_' | '-' = '_') {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, separator).replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '').slice(0, 40) || 'IMPORT'
}

function compact(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
}

function likelyVendor(reference: Reference, vendors: OptionRecord[]) {
  if (reference.metadata.vendorTargetId) return reference.metadata.vendorTargetId
  const source = compact(reference.sourceValue)
  const matches = vendors.filter((vendor) => {
    const name = compact(vendor.name)
    const code = compact(vendor.code ?? '')
    return (name && source.startsWith(name)) || (code && source.startsWith(code))
  })
  return matches.length === 1 ? matches[0].id : ''
}

function seedDraft(reference: Reference, assist: Assist): Draft {
  const vendorId = likelyVendor(reference, assist.workspace.options.vendors.filter((item) => item.isActive))
  const platform = reference.metadata.platform ?? (reference.metadata.platforms?.length === 1 ? reference.metadata.platforms[0] : '')
  return {
    ...emptyDraft(),
    name: reference.sourceValue,
    code: suggestedCode(reference.sourceValue, reference.kind === 'SITE' ? '-' : '_'),
    customerId: reference.metadata.customerTargetId ?? '',
    vendorId,
    deviceTypeId: reference.metadata.deviceTypeTargetId ?? '',
    modelId: reference.metadata.modelTargetId ?? '',
    model: reference.sourceValue,
    platform,
    platforms: reference.metadata.platforms?.join(', ') ?? (platform ? platform : ''),
    version: reference.sourceValue,
  }
}

export function DeviceImportManualEntityResolver({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false)
  const [assist, setAssist] = useState<Assist | null>(null)
  const [referenceId, setReferenceId] = useState('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [familyModelId, setFamilyModelId] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [quickKind, setQuickKind] = useState<'customer' | 'vendor' | 'device-type' | null>(null)
  const [quickName, setQuickName] = useState('')
  const [quickCode, setQuickCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Missing-entity data could not be loaded.')
    setAssist(payload.data)
    return payload.data
  }

  async function openResolver() {
    setOpen(true)
    if (assist) return
    setError(null)
    try {
      await load()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Missing-entity data could not be loaded.')
    }
  }

  const references = useMemo(() => assist?.workspace.references.filter((reference) => reference.status !== 'LINKED') ?? [], [assist])
  const selectedReference = references.find((reference) => reference.id === referenceId) ?? null
  const linkedFamilyModels = useMemo(() => assist?.models.linkedModels.filter((model) => !model.familyId) ?? [], [assist])
  const selectedFamilyModel = linkedFamilyModels.find((model) => model.id === familyModelId) ?? null

  function patch(values: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...values }))
  }

  function selectReference(id: string) {
    setReferenceId(id)
    const reference = references.find((item) => item.id === id)
    if (reference && assist) setDraft(seedDraft(reference, assist))
    else setDraft(emptyDraft())
    setError(null)
  }

  async function createAndLink() {
    if (!selectedReference) return
    setBusy(true)
    setError(null)
    try {
      const body = selectedReference.kind === 'SITE'
        ? { customerId: draft.customerId, name: draft.name, code: draft.code }
        : selectedReference.kind === 'DEVICE_MODEL'
          ? {
              vendorId: draft.vendorId,
              deviceTypeId: draft.deviceTypeId,
              model: draft.model,
              platform: draft.platform || null,
              platforms: draft.platforms,
              familyId: draft.familyId || null,
            }
          : selectedReference.kind === 'FIRMWARE_RELEASE'
            ? {
                vendorId: draft.vendorId,
                modelId: draft.modelId,
                platform: draft.platform,
                version: draft.version,
                status: draft.status,
              }
            : { name: draft.name, code: draft.code }
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/${selectedReference.id}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'The missing entity could not be created.')
      window.location.reload()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The missing entity could not be created.')
      setBusy(false)
    }
  }

  async function quickCreate() {
    if (!quickKind) return
    setBusy(true)
    setError(null)
    try {
      const url = quickKind === 'customer' ? '/api/v1/customers' : `/api/v1/reference-data/${quickKind === 'vendor' ? 'vendors' : 'device-types'}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quickName, code: quickCode, source: 'IMPORT', isActive: true }),
      })
      const payload = await response.json() as { data?: { id: string } } & ApiError
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The supporting record could not be created.')
      const createdId = payload.data.id
      const next = await load()
      if (quickKind === 'customer') patch({ customerId: createdId })
      if (quickKind === 'vendor') patch({ vendorId: createdId })
      if (quickKind === 'device-type') patch({ deviceTypeId: createdId })
      setQuickKind(null)
      setQuickName('')
      setQuickCode('')
      const refreshed = next.workspace.references.find((item) => item.id === referenceId)
      if (refreshed) setDraft((current) => ({ ...seedDraft(refreshed, next), ...current, customerId: quickKind === 'customer' ? createdId : current.customerId, vendorId: quickKind === 'vendor' ? createdId : current.vendorId, deviceTypeId: quickKind === 'device-type' ? createdId : current.deviceTypeId }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The supporting record could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function createFamily() {
    if (!selectedFamilyModel || !familyName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_FAMILIES',
          items: [{ vendorId: selectedFamilyModel.vendorId, name: familyName, modelIds: [selectedFamilyModel.id] }],
        }),
      })
      const payload = await response.json() as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'The Family could not be created and assigned.')
      window.location.reload()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The Family could not be created and assigned.')
      setBusy(false)
    }
  }

  function openQuick(kind: 'customer' | 'vendor' | 'device-type', seed: string) {
    setQuickKind(kind)
    setQuickName(seed)
    setQuickCode(suggestedCode(seed))
    setError(null)
  }

  const referenceOptions = references.map((reference) => ({
    id: reference.id,
    label: `${KIND_LABELS[reference.kind]} · ${reference.sourceValue} · ${reference.status === 'WAITING' ? 'waiting' : 'unresolved'} · ${reference.occurrenceCount.toLocaleString()}x`,
    keywords: [reference.sourceValue, KIND_LABELS[reference.kind], reference.status],
  }))
  const customerOptions = assist?.workspace.options.customers.filter((item) => item.isActive).map((item) => ({ id: item.id, label: `${item.name}${item.code ? ` (${item.code})` : ''}`, keywords: [item.name, item.code ?? ''] })) ?? []
  const vendorOptions = assist?.workspace.options.vendors.filter((item) => item.isActive).map((item) => ({ id: item.id, label: `${item.name}${item.code ? ` (${item.code})` : ''}`, keywords: [item.name, item.code ?? ''] })) ?? []
  const typeOptions = assist?.workspace.options.deviceTypes.filter((item) => item.isActive).map((item) => ({ id: item.id, label: `${item.name}${item.code ? ` (${item.code})` : ''}`, keywords: [item.name, item.code ?? ''] })) ?? []
  const modelOptions = assist?.workspace.options.models.filter((item) => item.isActive && (!draft.vendorId || item.vendorId === draft.vendorId)).map((item) => ({ id: item.id, label: `${item.vendor.name} · ${item.model} · ${item.deviceType.name}`, keywords: [item.model, item.vendor.name, item.deviceType.name, item.platform ?? ''] })) ?? []
  const familyOptions = assist?.models.families.filter((item) => item.isActive && item.vendorId === draft.vendorId).map((item) => ({ id: item.id, label: item.name, keywords: [item.name] })) ?? []

  return <>
    <div className="fixed bottom-6 left-6 z-40">
      <Button type="button" variant="primary" onClick={() => void openResolver()}>Create / fill missing entities</Button>
    </div>

    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Create or fill missing import entities">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Manual reconciliation</div>
            <h2 className="mt-1 text-xl font-semibold">Create or fill missing entities</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Choose an unresolved reference, supply missing context, then create the canonical record and link it back to every occurrence in this batch.</p>
          </div>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
        </div>

        <div className="space-y-5 p-5">
          {error ? <div className="rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

          {!assist ? <div className="text-sm text-[var(--muted)]">Loading unresolved references…</div> : assist.workspace.batch.status === 'PUBLISHED' ? <div className="text-sm text-[var(--muted)]">This batch is already published.</div> : <>
            <FormField label="Missing staged entity" htmlFor="manual-missing-reference" description={`${references.length.toLocaleString()} references still need review.`}>
              <SearchableReferencePicker id="manual-missing-reference" value={referenceId} options={referenceOptions} disabled={busy} placeholder="Search unresolved reference…" onChange={selectReference} />
            </FormField>

            {selectedReference ? <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">{KIND_LABELS[selectedReference.kind]}</div><div className="mt-1 font-mono text-sm font-semibold">{selectedReference.sourceValue}</div><div className="mt-1 text-xs text-[var(--muted)]">{selectedReference.occurrenceCount.toLocaleString()} occurrence{selectedReference.occurrenceCount === 1 ? '' : 's'} · {selectedReference.status}</div></div>
              </div>

              {(selectedReference.kind === 'CUSTOMER' || selectedReference.kind === 'VENDOR' || selectedReference.kind === 'DEVICE_TYPE' || selectedReference.kind === 'CONTRACT_TYPE') ? <div className="grid gap-3 md:grid-cols-2">
                <FormField label="Name" htmlFor="manual-name"><TextInput id="manual-name" value={draft.name} disabled={busy} onChange={(event) => patch({ name: event.target.value })} /></FormField>
                <FormField label="Code" htmlFor="manual-code"><TextInput id="manual-code" value={draft.code} disabled={busy} onChange={(event) => patch({ code: event.target.value.toUpperCase() })} /></FormField>
              </div> : null}

              {selectedReference.kind === 'SITE' ? <div className="grid gap-3 md:grid-cols-3">
                <FormField label="Customer" htmlFor="manual-site-customer"><SearchableReferencePicker id="manual-site-customer" value={draft.customerId} options={customerOptions} disabled={busy} placeholder="Choose Customer…" onChange={(value) => patch({ customerId: value })} /></FormField>
                <FormField label="Site name" htmlFor="manual-site-name"><TextInput id="manual-site-name" value={draft.name} disabled={busy} onChange={(event) => patch({ name: event.target.value })} /></FormField>
                <FormField label="Site code" htmlFor="manual-site-code"><TextInput id="manual-site-code" value={draft.code} disabled={busy} onChange={(event) => patch({ code: event.target.value.toUpperCase() })} /></FormField>
                <div className="md:col-span-3"><Button type="button" variant="ghost" disabled={busy} onClick={() => openQuick('customer', '')}>+ Create supporting Customer</Button></div>
              </div> : null}

              {selectedReference.kind === 'DEVICE_MODEL' ? <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Vendor" htmlFor="manual-model-vendor"><SearchableReferencePicker id="manual-model-vendor" value={draft.vendorId} options={vendorOptions} disabled={busy} placeholder="Choose Vendor…" onChange={(value) => patch({ vendorId: value, familyId: '' })} /></FormField>
                  <FormField label="Device Type" htmlFor="manual-model-type"><SearchableReferencePicker id="manual-model-type" value={draft.deviceTypeId} options={typeOptions} disabled={busy} placeholder="Choose Device Type…" onChange={(value) => patch({ deviceTypeId: value })} /></FormField>
                </div>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => openQuick('vendor', '')}>+ Create Vendor</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => openQuick('device-type', '')}>+ Create Device Type</Button></div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <FormField label="Concrete Model" htmlFor="manual-model-name"><TextInput id="manual-model-name" value={draft.model} disabled={busy} onChange={(event) => patch({ model: event.target.value })} /></FormField>
                  <FormField label="Preferred platform" htmlFor="manual-model-platform"><TextInput id="manual-model-platform" value={draft.platform} disabled={busy} placeholder="Optional" onChange={(event) => patch({ platform: event.target.value })} /></FormField>
                  <FormField label="Supported platforms" htmlFor="manual-model-platforms" description="Comma separated; use both AOS-8 and AOS-10 for dual-platform hardware."><TextInput id="manual-model-platforms" value={draft.platforms} disabled={busy} placeholder="AOS-8, AOS-10" onChange={(event) => patch({ platforms: event.target.value })} /></FormField>
                  <FormField label="Existing Family" htmlFor="manual-model-family"><SearchableReferencePicker id="manual-model-family" value={draft.familyId} options={familyOptions} disabled={busy || !draft.vendorId} placeholder="Optional Family…" onChange={(value) => patch({ familyId: value })} /></FormField>
                </div>
              </div> : null}

              {selectedReference.kind === 'FIRMWARE_RELEASE' ? <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <FormField label="Vendor" htmlFor="manual-fw-vendor"><SearchableReferencePicker id="manual-fw-vendor" value={draft.vendorId} options={vendorOptions} disabled={busy} placeholder="Choose Vendor…" onChange={(value) => patch({ vendorId: value, modelId: '' })} /></FormField>
                  <FormField label="Model" htmlFor="manual-fw-model"><SearchableReferencePicker id="manual-fw-model" value={draft.modelId} options={modelOptions} disabled={busy || !draft.vendorId} placeholder="Choose Model…" onChange={(value) => patch({ modelId: value })} /></FormField>
                  <FormField label="Platform" htmlFor="manual-fw-platform"><TextInput id="manual-fw-platform" value={draft.platform} disabled={busy} placeholder="Required" onChange={(event) => patch({ platform: event.target.value })} /></FormField>
                  <FormField label="Version" htmlFor="manual-fw-version"><TextInput id="manual-fw-version" value={draft.version} disabled={busy} onChange={(event) => patch({ version: event.target.value })} /></FormField>
                  <FormField label="Status" htmlFor="manual-fw-status"><SelectInput id="manual-fw-status" value={draft.status} disabled={busy} onChange={(event) => patch({ status: event.target.value })}><option value="AVAILABLE">Available</option><option value="TESTING">Testing</option><option value="APPROVED">Approved</option><option value="RECOMMENDED">Recommended</option><option value="DEPRECATED">Deprecated</option><option value="BLOCKED">Blocked</option></SelectInput></FormField>
                </div>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => openQuick('vendor', '')}>+ Create supporting Vendor</Button>
              </div> : null}

              <div className="mt-4 flex justify-end"><Button type="button" variant="primary" disabled={busy} onClick={() => void createAndLink()}>{busy ? 'Creating…' : `Create & link ${KIND_LABELS[selectedReference.kind]}`}</Button></div>
            </div> : null}

            {quickKind ? <div className="rounded-lg border border-[var(--accent)] bg-[var(--surface-raised)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3"><div className="font-semibold">Create supporting {quickKind === 'customer' ? 'Customer' : quickKind === 'vendor' ? 'Vendor' : 'Device Type'}</div><Button type="button" variant="ghost" disabled={busy} onClick={() => setQuickKind(null)}>Cancel</Button></div>
              <div className="grid gap-3 md:grid-cols-[1fr_.6fr_auto] md:items-end"><FormField label="Name" htmlFor="quick-name"><TextInput id="quick-name" value={quickName} disabled={busy} onChange={(event) => { setQuickName(event.target.value); if (!quickCode) setQuickCode(suggestedCode(event.target.value)) }} /></FormField><FormField label="Code" htmlFor="quick-code"><TextInput id="quick-code" value={quickCode} disabled={busy} onChange={(event) => setQuickCode(event.target.value.toUpperCase())} /></FormField><Button type="button" variant="primary" disabled={busy || !quickName.trim() || !quickCode.trim()} onClick={() => void quickCreate()}>{busy ? 'Creating…' : 'Create'}</Button></div>
            </div> : null}

            {linkedFamilyModels.length ? <div className="rounded-lg border border-[var(--border)] p-4">
              <h3 className="text-sm font-semibold">Missing Model Family</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">Create a Family that is not configured yet and assign it to the selected already-linked Model.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <FormField label="Model" htmlFor="manual-family-model"><SearchableReferencePicker id="manual-family-model" value={familyModelId} options={linkedFamilyModels.map((model) => ({ id: model.id, label: `${model.vendor.name} · ${model.model}`, keywords: [model.vendor.name, model.vendor.code, model.model] }))} disabled={busy} placeholder="Choose Model…" onChange={(value) => { setFamilyModelId(value); const model = linkedFamilyModels.find((item) => item.id === value); setFamilyName(model?.proposedNewFamilyName ?? '') }} /></FormField>
                <FormField label="New Family name" htmlFor="manual-family-name"><TextInput id="manual-family-name" value={familyName} disabled={busy || !familyModelId} placeholder="e.g. Smart-UPS 1000" onChange={(event) => setFamilyName(event.target.value)} /></FormField>
                <Button type="button" variant="primary" disabled={busy || !familyModelId || !familyName.trim()} onClick={() => void createFamily()}>{busy ? 'Creating…' : 'Create & assign Family'}</Button>
              </div>
            </div> : null}
          </>}
        </div>
      </div>
    </div> : null}
  </>
}
