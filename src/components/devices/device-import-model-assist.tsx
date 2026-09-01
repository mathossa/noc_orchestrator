'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SearchableReferencePicker } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'

const ACTION_BATCH_SIZE = 250

type ApiError = { error?: { message?: string } }

type Family = { id: string; vendorId: string; name: string; isActive: boolean }
type ReadyModel = {
  id: string
  sourceValue: string
  vendorTargetId: string
  deviceTypeTargetId: string
  platform: string | null
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
}
type Assist = { readyToCreate: ReadyModel[]; linkedModels: LinkedModel[]; families: Family[] }
type AssistPayload = { data?: Assist } & ApiError
type CreatePayload = { data?: { created: number; linkedExisting: number } } & ApiError
type FamilyPayload = { data?: { updated: number; assist: Assist } } & ApiError

export function DeviceImportModelAssist({ batchId }: { batchId: string }) {
  const [assist, setAssist] = useState<Assist | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/models/assist`)
      .then(async (response) => {
        const payload = await response.json() as AssistPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Model assistant could not be loaded.')
        return payload.data
      })
      .then(
        (data) => { if (!cancelled) setAssist(data) },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The Model assistant could not be loaded.') },
      )
    return () => { cancelled = true }
  }, [batchId])

  async function reloadAssist() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Model assistant could not be refreshed.')
    setAssist(payload.data)
    return payload.data
  }

  const familySuggestions = useMemo(() => assist?.linkedModels.filter((model) => !model.familyId && model.suggestedFamilyId) ?? [], [assist])
  const chosenFamilies = useMemo(() => assist?.linkedModels.flatMap((model) => {
    const familyId = choices[model.id] ?? ''
    return familyId && familyId !== model.familyId ? [{ modelId: model.id, familyId }] : []
  }) ?? [], [assist, choices])
  const suggestionBatch = familySuggestions.slice(0, ACTION_BATCH_SIZE)
  const chosenBatch = chosenFamilies.slice(0, ACTION_BATCH_SIZE)

  async function createReadyModels() {
    if (!assist?.readyToCreate.length) return
    const models = assist.readyToCreate.slice(0, ACTION_BATCH_SIZE)
    const countText = assist.readyToCreate.length > models.length ? `${models.length} of ${assist.readyToCreate.length}` : String(models.length)
    if (!window.confirm(`Create ${countText} missing concrete Model${models.length === 1 ? '' : 's'} using the imported model notation and already-resolved Vendor/Device Type?`)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CREATE_MODELS', referenceIds: models.map((model) => model.id) }),
      })
      const payload = await response.json() as CreatePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The missing Models could not be created.')
      const next = await reloadAssist()
      const remaining = next.readyToCreate.length
      setNotice(`Created ${payload.data.created} Model${payload.data.created === 1 ? '' : 's'} and linked ${payload.data.linkedExisting} already-existing match${payload.data.linkedExisting === 1 ? '' : 'es'}.${remaining ? ` ${remaining} ready Model${remaining === 1 ? '' : 's'} remain.` : ''}`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The missing Models could not be created.')
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
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/models/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ASSIGN_FAMILIES', items }),
      })
      const payload = await response.json() as FamilyPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Model families could not be updated.')
      setAssist(payload.data.assist)
      setChoices({})
      setNotice(`${description}: updated ${payload.data.updated} Model family assignment${payload.data.updated === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The Model families could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  function useFamilySuggestions() {
    setChoices((current) => {
      const next = { ...current }
      for (const model of familySuggestions) if (model.suggestedFamilyId) next[model.id] = model.suggestedFamilyId
      return next
    })
  }

  if (!assist) return <>
    <PageHeader eyebrow="Staged inventory" title="Model assistant" description="Loading concrete Model and family actions." />
    <div className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</div>
  </>

  return <>
    <PageHeader
      eyebrow="Staged inventory"
      title="Model assistant"
      description="Create obvious missing concrete Models in bulk, then review and apply family / series assignments with as few clicks as possible."
      actions={<Link href={`/devices/import/${batchId}/bulk`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to bulk resolver</Link>}
    />

    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Missing concrete Models</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Only Models whose Vendor and Device Type are already resolved are eligible. Imported model notation is preserved exactly.</p>
        </div>
        <Button type="button" variant="primary" disabled={busy || !assist.readyToCreate.length} onClick={() => void createReadyModels()}>
          {assist.readyToCreate.length > ACTION_BATCH_SIZE ? `Create next ${ACTION_BATCH_SIZE} of ${assist.readyToCreate.length} Models` : `Create all ${assist.readyToCreate.length} ready Models`}
        </Button>
      </div>
    </section>

    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">Model families / series</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Existing assignments are preserved unless you explicitly choose another family. Suggestions only appear when an existing family/series is clearly present in the model notation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={busy || !familySuggestions.length} onClick={useFamilySuggestions}>Review {familySuggestions.length} family suggestions</Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !suggestionBatch.length}
            onClick={() => void assignFamilies(suggestionBatch.map((model) => ({ modelId: model.id, familyId: model.suggestedFamilyId! })), 'Applied safe family suggestions')}
          >
            {familySuggestions.length > ACTION_BATCH_SIZE ? `Apply next ${ACTION_BATCH_SIZE} of ${familySuggestions.length} suggestions` : `Apply ${familySuggestions.length} suggested families`}
          </Button>
          <Button type="button" variant="primary" disabled={busy || !chosenBatch.length} onClick={() => void assignFamilies(chosenBatch, 'Applied reviewed family choices')}>
            {chosenFamilies.length > ACTION_BATCH_SIZE ? `Apply next ${ACTION_BATCH_SIZE} of ${chosenFamilies.length} chosen` : `Apply ${chosenFamilies.length} chosen`}
          </Button>
        </div>
      </div>

      {assist.linkedModels.length ? <div className="divide-y divide-[var(--border)]">{assist.linkedModels.map((model) => {
        const options = assist.families
          .filter((family) => family.isActive && family.vendorId === model.vendorId)
          .map((family) => ({ id: family.id, label: family.name, keywords: [family.name, model.vendor.name, model.vendor.code] }))
        const selected = choices[model.id] ?? ''
        return <div key={model.id} className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(260px,1fr)_minmax(300px,1fr)] lg:items-end">
          <div>
            <div className="font-mono text-sm font-semibold">{model.vendor.name} · {model.model}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">{model.deviceType.name}{model.platform ? ` · platform ${model.platform}` : ''}</div>
            {model.sourceValues.length ? <div className="mt-1 text-xs text-[var(--muted)]">Import: {model.sourceValues.join(', ')}</div> : null}
            <div className="mt-2 text-xs">Current family: <strong>{model.family?.name ?? 'None'}</strong></div>
            {!model.familyId && model.suggestedFamilyId ? <div className="mt-1 text-xs text-[var(--accent-light)]">Suggested: <strong>{model.suggestedFamilyName}</strong></div> : null}
          </div>
          <FormField label="Family / series" htmlFor={`model-family-${model.id}`} description="Type a family/series name and press Enter when one result remains.">
            <SearchableReferencePicker
              id={`model-family-${model.id}`}
              value={selected}
              options={options}
              disabled={busy}
              placeholder={model.family?.name ?? 'Type family / series…'}
              onChange={(value) => setChoices((current) => ({ ...current, [model.id]: value }))}
            />
          </FormField>
        </div>
      })}</div> : <div className="px-4 py-8 text-sm text-[var(--muted)] sm:px-5">No linked concrete Models are available yet. Resolve or create Models first.</div>}
    </section>
  </>
}
