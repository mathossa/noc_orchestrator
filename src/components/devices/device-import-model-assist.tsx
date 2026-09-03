'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SearchableReferencePicker } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { FormField, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'

type ApiError = { error?: { message?: string } }
type Family = { id: string; vendorId: string; name: string; isActive: boolean }
type ReadyModel = {
  id: string
  sourceValue: string
  vendorTargetId: string
  vendorName: string
  vendorCode: string
  deviceTypeTargetId: string
  deviceTypeName: string
  deviceTypeCode: string
  proposedModel: string
  proposedPlatform: string
  suggestedFamilyId: string | null
  suggestedFamilyName: string | null
  proposedNewFamilyName: string | null
}
type LinkedModel = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId: string | null
  model: string
  platform: string | null
  isActive: boolean
  vendor: { id: string; code: string; name: string }
  deviceType: { id: string; code: string; name: string }
  family: Family | null
  sourceValues: string[]
  suggestedFamilyId: string | null
  suggestedFamilyName: string | null
  proposedNewFamilyName: string | null
}
type NewFamilyProposal = {
  key: string
  vendorId: string
  vendorName: string
  name: string
  modelIds: string[]
  modelNames: string[]
}
type Assist = { readyToCreate: ReadyModel[]; linkedModels: LinkedModel[]; families: Family[]; newFamilyProposals: NewFamilyProposal[] }
type AssistPayload = { data?: Assist } & ApiError
type CreatePayload = { data?: { created: number; linkedExisting: number } } & ApiError
type FamilyPayload = { data?: { updated: number; assist: Assist } } & ApiError
type NewFamilyPayload = { data?: { createdFamilies: number; reusedFamilies: number; assignedModels: number; assist: Assist } } & ApiError

type ModelDraft = ReadyModel & { include: boolean; model: string; platform: string; familyId: string }
type FamilyDraft = NewFamilyProposal & { include: boolean }

function buildModelDrafts(assist: Assist) {
  return assist.readyToCreate.map((model): ModelDraft => ({
    ...model,
    include: true,
    model: model.proposedModel,
    platform: model.proposedPlatform,
    familyId: model.suggestedFamilyId ?? '',
  }))
}

function buildFamilyDrafts(assist: Assist) {
  return assist.newFamilyProposals.map((proposal): FamilyDraft => ({ ...proposal, include: true }))
}

export function DeviceImportModelAssist({ batchId }: { batchId: string }) {
  const [assist, setAssist] = useState<Assist | null>(null)
  const [modelDrafts, setModelDrafts] = useState<ModelDraft[]>([])
  const [familyDrafts, setFamilyDrafts] = useState<FamilyDraft[]>([])
  const [familyChoices, setFamilyChoices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function installAssist(data: Assist) {
    setAssist(data)
    setModelDrafts(buildModelDrafts(data))
    setFamilyDrafts(buildFamilyDrafts(data))
    setFamilyChoices({})
  }

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/models/assist`)
      .then(async (response) => {
        const payload = await response.json() as AssistPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Model assistant could not be loaded.')
        return payload.data
      })
      .then(
        (data) => { if (!cancelled) installAssist(data) },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The Model assistant could not be loaded.') },
      )
    return () => { cancelled = true }
  }, [batchId])

  async function reloadAssist() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Model assistant could not be refreshed.')
    installAssist(payload.data)
    return payload.data
  }

  const selectedModels = useMemo(() => modelDrafts.filter((model) => model.include), [modelDrafts])
  const selectedNewFamilies = useMemo(() => familyDrafts.filter((family) => family.include), [familyDrafts])
  const familySuggestions = useMemo(() => assist?.linkedModels.filter((model) => !model.familyId && model.suggestedFamilyId) ?? [], [assist])
  const chosenFamilies = useMemo(() => assist?.linkedModels.flatMap((model) => {
    const familyId = familyChoices[model.id] ?? ''
    return familyId && familyId !== model.familyId ? [{ modelId: model.id, familyId }] : []
  }) ?? [], [assist, familyChoices])

  function patchModel(referenceId: string, values: Partial<ModelDraft>) {
    setModelDrafts((current) => current.map((draft) => draft.id === referenceId ? { ...draft, ...values } : draft))
  }

  function patchNewFamily(key: string, values: Partial<FamilyDraft>) {
    setFamilyDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...values } : draft))
  }

  async function createPreparedModels() {
    if (!selectedModels.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    let created = 0
    let linkedExisting = 0
    try {
      for (let index = 0; index < selectedModels.length; index += 250) {
        const chunk = selectedModels.slice(index, index + 250)
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CREATE_MODELS',
            items: chunk.map((model) => ({
              referenceId: model.id,
              model: model.model,
              platform: model.platform,
              familyId: model.familyId || null,
            })),
          }),
        })
        const payload = await response.json() as CreatePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The prepared Models could not be created.')
        created += payload.data.created
        linkedExisting += payload.data.linkedExisting
      }
      const next = await reloadAssist()
      setNotice(`Created ${created.toLocaleString()} concrete Model${created === 1 ? '' : 's'} and linked ${linkedExisting.toLocaleString()} existing Model${linkedExisting === 1 ? '' : 's'}.${next.newFamilyProposals.length ? ` ${next.newFamilyProposals.length} new Family proposal${next.newFamilyProposals.length === 1 ? ' is' : 's are'} ready below.` : ''}`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The prepared Models could not be created.')
    } finally {
      setBusy(false)
    }
  }

  async function assignFamilies(items: Array<{ modelId: string; familyId: string }>, description: string) {
    if (!items.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      for (let index = 0; index < items.length; index += 250) {
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ASSIGN_FAMILIES', items: items.slice(index, index + 250) }),
        })
        const payload = await response.json() as FamilyPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Model families could not be updated.')
      }
      const next = await reloadAssist()
      setNotice(`${description}: ${items.length.toLocaleString()} Model family assignment${items.length === 1 ? '' : 's'} applied. ${next.newFamilyProposals.length ? `${next.newFamilyProposals.length} new Family proposal${next.newFamilyProposals.length === 1 ? ' remains' : 's remain'}.` : ''}`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The Model families could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function createProposedFamilies() {
    if (!selectedNewFamilies.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    let createdFamilies = 0
    let reusedFamilies = 0
    let assignedModels = 0
    try {
      for (let index = 0; index < selectedNewFamilies.length; index += 250) {
        const chunk = selectedNewFamilies.slice(index, index + 250)
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CREATE_FAMILIES',
            items: chunk.map((family) => ({ vendorId: family.vendorId, name: family.name, modelIds: family.modelIds })),
          }),
        })
        const payload = await response.json() as NewFamilyPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The proposed Families could not be created.')
        createdFamilies += payload.data.createdFamilies
        reusedFamilies += payload.data.reusedFamilies
        assignedModels += payload.data.assignedModels
      }
      await reloadAssist()
      setNotice(`Created ${createdFamilies.toLocaleString()} Famil${createdFamilies === 1 ? 'y' : 'ies'}, reused ${reusedFamilies.toLocaleString()} existing, and assigned ${assignedModels.toLocaleString()} Model${assignedModels === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The proposed Families could not be created.')
    } finally {
      setBusy(false)
    }
  }

  if (!assist) return <>
    <PageHeader eyebrow="Staged inventory" title="Model + family assistant" description="Preparing concrete Model and family proposals." />
    <div className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</div>
  </>

  return <>
    <PageHeader
      eyebrow="Staged inventory"
      title="Model + family assistant"
      description="Review the proposed canonical Models, edit exceptions, create them in bulk, then accept or edit Family / series suggestions."
      actions={<Link href={`/devices/import/${batchId}/bulk`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to bulk resolver</Link>}
    />

    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">Prepared missing concrete Models</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Vendor and Device Type come from already-resolved import references. Model, Platform, and an existing Family suggestion are editable before creation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={busy || !modelDrafts.length} onClick={() => setModelDrafts((current) => current.map((draft) => ({ ...draft, include: true })))}>Select all</Button>
          <Button type="button" variant="ghost" disabled={busy || !selectedModels.length} onClick={() => setModelDrafts((current) => current.map((draft) => ({ ...draft, include: false })))}>Clear</Button>
          <Button type="button" variant="primary" disabled={busy || !selectedModels.length} onClick={() => void createPreparedModels()}>{busy ? 'Creating…' : `Create/link ${selectedModels.length.toLocaleString()} prepared Models`}</Button>
        </div>
      </div>
      {modelDrafts.length ? <div className="divide-y divide-[var(--border)]">{modelDrafts.map((draft) => {
        const familyOptions = assist.families.filter((family) => family.isActive && family.vendorId === draft.vendorTargetId)
          .map((family) => ({ id: family.id, label: family.name, keywords: [family.name, draft.vendorName, draft.vendorCode] }))
        return <div key={draft.id} className="grid gap-3 p-4 sm:p-5 xl:grid-cols-[34px_minmax(180px,.7fr)_minmax(180px,.7fr)_minmax(240px,1fr)_minmax(170px,.7fr)_minmax(220px,.8fr)] xl:items-end">
          <label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={busy} onChange={(event) => patchModel(draft.id, { include: event.target.checked })} aria-label={`Include ${draft.model}`} /></label>
          <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vendor</div><div className="mt-1 text-sm font-semibold">{draft.vendorName}</div><div className="mt-1 text-xs text-[var(--muted)]">{draft.vendorCode}</div></div>
          <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Device Type</div><div className="mt-1 text-sm font-semibold">{draft.deviceTypeName}</div><div className="mt-1 text-xs text-[var(--muted)]">{draft.deviceTypeCode}</div></div>
          <div><label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`model-name-${draft.id}`}>Concrete Model</label><TextInput id={`model-name-${draft.id}`} value={draft.model} disabled={busy} onChange={(event) => patchModel(draft.id, { model: event.target.value })} /><div className="mt-1 text-xs text-[var(--muted)]">Import: {draft.sourceValue}</div></div>
          <div><label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`model-platform-${draft.id}`}>Platform</label><TextInput id={`model-platform-${draft.id}`} value={draft.platform} disabled={busy} placeholder="Optional" onChange={(event) => patchModel(draft.id, { platform: event.target.value })} /></div>
          <FormField label="Existing Family" htmlFor={`model-family-create-${draft.id}`} description={draft.proposedNewFamilyName ? `No existing match; possible new Family: ${draft.proposedNewFamilyName}` : undefined}>
            <SearchableReferencePicker id={`model-family-create-${draft.id}`} value={draft.familyId} options={familyOptions} disabled={busy} placeholder={draft.suggestedFamilyName ?? 'Optional family…'} onChange={(value) => patchModel(draft.id, { familyId: value })} />
          </FormField>
        </div>
      })}</div> : <div className="px-4 py-8 text-sm text-[var(--muted)] sm:px-5">No unresolved Models are ready to create. Resolve Vendor and Device Type first, or all Models are already linked.</div>}
    </section>

    {familyDrafts.length ? <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div><h2 className="text-sm font-semibold">Suggested new Families / series</h2><p className="mt-1 text-xs text-[var(--muted)]">These are conservative series proposals derived from linked Model notation. Review or rename them before creating; existing Model family assignments are never overwritten.</p></div>
        <Button type="button" variant="primary" disabled={busy || !selectedNewFamilies.length} onClick={() => void createProposedFamilies()}>{busy ? 'Creating…' : `Create/assign ${selectedNewFamilies.length.toLocaleString()} proposed Families`}</Button>
      </div>
      <div className="divide-y divide-[var(--border)]">{familyDrafts.map((draft) => <div key={draft.key} className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[34px_minmax(180px,.6fr)_minmax(220px,.8fr)_minmax(300px,1.2fr)] lg:items-end">
        <label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={busy} onChange={(event) => patchNewFamily(draft.key, { include: event.target.checked })} aria-label={`Include Family ${draft.name}`} /></label>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vendor</div><div className="mt-1 text-sm font-semibold">{draft.vendorName}</div></div>
        <div><label className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]" htmlFor={`new-family-${draft.key}`}>Proposed Family</label><TextInput id={`new-family-${draft.key}`} value={draft.name} disabled={busy} onChange={(event) => patchNewFamily(draft.key, { name: event.target.value })} /></div>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Will assign</div><div className="mt-1 text-sm">{draft.modelNames.join(', ')}</div></div>
      </div>)}</div>
    </section> : null}

    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div><h2 className="text-sm font-semibold">Existing Family assignments</h2><p className="mt-1 text-xs text-[var(--muted)]">Existing assignments are shown; unassigned Models can use a safe existing-family suggestion or a searchable manual choice.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" disabled={busy || !familySuggestions.length} onClick={() => void assignFamilies(familySuggestions.map((model) => ({ modelId: model.id, familyId: model.suggestedFamilyId! })), 'Applied safe existing-Family suggestions')}>Apply {familySuggestions.length} suggested existing families</Button>
          <Button type="button" variant="primary" disabled={busy || !chosenFamilies.length} onClick={() => void assignFamilies(chosenFamilies, 'Applied reviewed family choices')}>Apply {chosenFamilies.length} chosen</Button>
        </div>
      </div>

      {assist.linkedModels.length ? <div className="divide-y divide-[var(--border)]">{assist.linkedModels.map((model) => {
        const options = assist.families.filter((family) => family.isActive && family.vendorId === model.vendorId)
          .map((family) => ({ id: family.id, label: family.name, keywords: [family.name, model.vendor.name, model.vendor.code] }))
        const selected = familyChoices[model.id] ?? ''
        return <div key={model.id} className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(300px,1fr)_minmax(300px,1fr)] lg:items-end">
          <div>
            <div className="font-mono text-sm font-semibold">{model.vendor.name} · {model.model}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">Type: {model.deviceType.name}{model.platform ? ` · platform ${model.platform}` : ''}</div>
            {model.sourceValues.length ? <div className="mt-1 text-xs text-[var(--muted)]">Import: {model.sourceValues.join(', ')}</div> : null}
            <div className="mt-2 text-xs">Current family: <strong>{model.family?.name ?? 'None'}</strong></div>
            {!model.familyId && model.suggestedFamilyId ? <div className="mt-1 text-xs text-[var(--accent-light)]">Suggested existing: <strong>{model.suggestedFamilyName}</strong></div> : null}
            {!model.familyId && !model.suggestedFamilyId && model.proposedNewFamilyName ? <div className="mt-1 text-xs text-[var(--accent-light)]">Suggested new: <strong>{model.proposedNewFamilyName}</strong></div> : null}
          </div>
          <FormField label="Family / series" htmlFor={`model-family-${model.id}`} description="Type a family/series name and press Enter when one result remains.">
            <SearchableReferencePicker id={`model-family-${model.id}`} value={selected} options={options} disabled={busy} placeholder={model.family?.name ?? 'Type family / series…'} onChange={(value) => setFamilyChoices((current) => ({ ...current, [model.id]: value }))} />
          </FormField>
        </div>
      })}</div> : <div className="px-4 py-8 text-sm text-[var(--muted)] sm:px-5">No linked concrete Models are available yet. Resolve or create Models first.</div>}
    </section>
  </>
}
