'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import type { DeviceImportResolutionMap, DeviceImportUnresolvedReference } from '@/lib/device-import'

export type DeviceImportResolutionReferences = {
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
  families: Array<{ id: string; vendorId: string; name: string; isActive: boolean }>
}

type CreatedDeviceType = DeviceImportResolutionReferences['deviceTypes'][number]
type CreatedModel = DeviceImportResolutionReferences['models'][number]

type Props = {
  unresolved: DeviceImportUnresolvedReference[]
  references: DeviceImportResolutionReferences
  resolutions: DeviceImportResolutionMap
  onResolutionChange: (key: string, targetId: string) => void
  onDeviceTypeCreated: (record: CreatedDeviceType) => void
  onModelCreated: (record: CreatedModel) => void
  onRepreview: () => void
  disabled?: boolean
}

type CreateDraft = {
  name: string
  code: string
  vendorId: string
  deviceTypeId: string
  familyId: string
  model: string
  platform: string
}

type ApiError = { error?: { message?: string } }

function suggestedCode(value: string) {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'TYPE'
}

function initialDraft(item: DeviceImportUnresolvedReference, references: DeviceImportResolutionReferences): CreateDraft {
  const vendorId = item.vendorId ?? references.vendors.find((vendor) => vendor.isActive)?.id ?? ''
  return {
    name: item.sourceValue,
    code: suggestedCode(item.sourceValue),
    vendorId,
    deviceTypeId: references.deviceTypes.find((type) => type.isActive)?.id ?? '',
    familyId: '',
    model: item.sourceValue,
    platform: '',
  }
}

export function DeviceImportReferenceResolver({
  unresolved,
  references,
  resolutions,
  onResolutionChange,
  onDeviceTypeCreated,
  onModelCreated,
  onRepreview,
  disabled = false,
}: Props) {
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [createKey, setCreateKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, CreateDraft>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const unresolvedCount = unresolved.length
  const resolvedCount = unresolved.filter((item) => Boolean(resolutions[item.key])).length

  const activeDeviceTypes = useMemo(() => references.deviceTypes.filter((record) => record.isActive), [references.deviceTypes])

  function choiceOptions(item: DeviceImportUnresolvedReference) {
    if (item.kind === 'DEVICE_TYPE') return activeDeviceTypes.map((record) => ({ id: record.id, label: `${record.name} (${record.code})` }))
    return references.models
      .filter((record) => record.isActive && (!item.vendorId || record.vendorId === item.vendorId))
      .map((record) => ({ id: record.id, label: `${record.vendor.name} · ${record.model} · ${record.deviceType.name}` }))
  }

  function openCreate(item: DeviceImportUnresolvedReference) {
    setCreateKey((current) => current === item.key ? null : item.key)
    setDrafts((current) => current[item.key] ? current : { ...current, [item.key]: initialDraft(item, references) })
    setError(null)
    setMessage(null)
  }

  function updateDraft(key: string, patch: Partial<CreateDraft>) {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? initialDraft(unresolved.find((item) => item.key === key)!, references)), ...patch } }))
  }

  async function remember(item: DeviceImportUnresolvedReference, targetId: string) {
    const response = await fetch('/api/v1/device-import/reference-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: item.kind,
        sourceValue: item.sourceValue,
        contextKey: item.contextKey,
        targetId,
      }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) throw new Error(payload.error?.message ?? 'The import match could not be remembered.')
  }

  async function useExisting(item: DeviceImportUnresolvedReference, always: boolean) {
    const targetId = choices[item.key] ?? resolutions[item.key]
    if (!targetId) return
    setBusyKey(item.key)
    setError(null)
    setMessage(null)
    try {
      if (always) await remember(item, targetId)
      onResolutionChange(item.key, targetId)
      setMessage(always ? `“${item.sourceValue}” will now match this record on future imports.` : `“${item.sourceValue}” will use this record for this import only.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The import reference could not be resolved.')
    } finally {
      setBusyKey(null)
    }
  }

  async function createReference(item: DeviceImportUnresolvedReference, always: boolean) {
    const draft = drafts[item.key] ?? initialDraft(item, references)
    setBusyKey(item.key)
    setError(null)
    setMessage(null)
    try {
      if (item.kind === 'DEVICE_TYPE') {
        const response = await fetch('/api/v1/reference-data/device-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: draft.code, name: draft.name, isActive: true }),
        })
        const payload = (await response.json()) as { data?: CreatedDeviceType } & ApiError
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The device type could not be created.')
        onDeviceTypeCreated(payload.data)
        onResolutionChange(item.key, payload.data.id)
        if (always) await remember(item, payload.data.id)
      } else {
        const response = await fetch('/api/v1/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vendorId: draft.vendorId,
            deviceTypeId: draft.deviceTypeId,
            familyId: draft.familyId || null,
            model: draft.model,
            platform: draft.platform || null,
            source: 'IMPORT',
            notes: `Created while resolving XLSX import value “${item.sourceValue}”.`,
          }),
        })
        const payload = (await response.json()) as { data?: CreatedModel } & ApiError
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The device model could not be created.')
        onModelCreated(payload.data)
        onResolutionChange(item.key, payload.data.id)
        if (always) await remember(item, payload.data.id)
      }
      setCreateKey(null)
      setMessage(always ? `Created and remembered “${item.sourceValue}” for future imports.` : `Created a new record for “${item.sourceValue}” and selected it for this import.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The reference record could not be created.')
    } finally {
      setBusyKey(null)
    }
  }

  if (unresolvedCount === 0) return null

  return (
    <section className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div>
          <h3 className="text-sm font-semibold">Resolve spreadsheet reference values</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Link an unknown value to an existing record for this import, remember that match for future imports, or create the missing reference here. One decision applies to every listed row using the same value.
          </p>
        </div>
        <div className="text-xs text-[var(--muted-strong)]">{resolvedCount} of {unresolvedCount} values resolved for this preview</div>
      </div>

      {error ? <div className="mx-4 mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-3 py-2 text-sm text-[#f0b0b0] sm:mx-5">{error}</div> : null}
      {message ? <div className="mx-4 mt-4 rounded-md border border-[#285f48] bg-[#142b22] px-3 py-2 text-sm text-[#a9e8c6] sm:mx-5">{message}</div> : null}

      <div className="divide-y divide-[var(--border)]">
        {unresolved.map((item) => {
          const options = choiceOptions(item)
          const selected = choices[item.key] ?? resolutions[item.key] ?? ''
          const draft = drafts[item.key] ?? initialDraft(item, references)
          const families = references.families.filter((family) => family.isActive && family.vendorId === draft.vendorId)
          return (
            <div key={item.key} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-light)]">{item.kind === 'DEVICE_TYPE' ? 'Device type' : 'Concrete device model'}</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-[var(--foreground)]">{item.sourceValue}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">Rows {item.rowNumbers.join(', ')}{item.vendorName ? ` · Vendor: ${item.vendorName}` : ''}</div>
                </div>
                {resolutions[item.key] ? <span className="rounded border border-[#285f48] bg-[#142b22] px-2 py-1 text-xs font-semibold text-[#a9e8c6]">Resolution selected</span> : null}
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
                <FormField label="Link to existing" htmlFor={`resolve-${item.key}`}>
                  <SelectInput id={`resolve-${item.key}`} value={selected} onChange={(event) => setChoices((current) => ({ ...current, [item.key]: event.target.value }))}>
                    <option value="">Choose configured {item.kind === 'DEVICE_TYPE' ? 'device type' : 'model'}</option>
                    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </SelectInput>
                </FormField>
                <Button type="button" variant="ghost" disabled={!selected || busyKey === item.key || disabled} onClick={() => void useExisting(item, false)}>Use once</Button>
                <Button type="button" variant="ghost" disabled={!selected || busyKey === item.key || disabled} onClick={() => void useExisting(item, true)}>Always match</Button>
                <Button type="button" variant="primary" disabled={busyKey === item.key || disabled} onClick={() => openCreate(item)}>{createKey === item.key ? 'Close create' : 'Create new'}</Button>
              </div>

              {createKey === item.key ? (
                <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                  {item.kind === 'DEVICE_TYPE' ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <FormField label="Type name" htmlFor={`create-type-name-${item.key}`}>
                        <TextInput id={`create-type-name-${item.key}`} value={draft.name} onChange={(event) => updateDraft(item.key, { name: event.target.value })} />
                      </FormField>
                      <FormField label="Type code" htmlFor={`create-type-code-${item.key}`}>
                        <TextInput id={`create-type-code-${item.key}`} value={draft.code} onChange={(event) => updateDraft(item.key, { code: event.target.value })} />
                      </FormField>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <FormField label="Vendor" htmlFor={`create-model-vendor-${item.key}`}>
                        <SelectInput id={`create-model-vendor-${item.key}`} value={draft.vendorId} onChange={(event) => updateDraft(item.key, { vendorId: event.target.value, familyId: '' })}>
                          <option value="">Select vendor</option>
                          {references.vendors.filter((vendor) => vendor.isActive).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                        </SelectInput>
                      </FormField>
                      <FormField label="Device type" htmlFor={`create-model-type-${item.key}`}>
                        <SelectInput id={`create-model-type-${item.key}`} value={draft.deviceTypeId} onChange={(event) => updateDraft(item.key, { deviceTypeId: event.target.value })}>
                          <option value="">Select device type</option>
                          {activeDeviceTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                        </SelectInput>
                      </FormField>
                      <FormField label="Family / series" htmlFor={`create-model-family-${item.key}`} description="Optional; no firmware inheritance is implied.">
                        <SelectInput id={`create-model-family-${item.key}`} value={draft.familyId} onChange={(event) => updateDraft(item.key, { familyId: event.target.value })} disabled={!draft.vendorId}>
                          <option value="">No family / unassigned</option>
                          {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
                        </SelectInput>
                      </FormField>
                      <FormField label="Platform" htmlFor={`create-model-platform-${item.key}`} description="Optional firmware compatibility platform.">
                        <TextInput id={`create-model-platform-${item.key}`} value={draft.platform} onChange={(event) => updateDraft(item.key, { platform: event.target.value })} />
                      </FormField>
                      <div className="md:col-span-2 xl:col-span-4">
                        <FormField label="Concrete model name" htmlFor={`create-model-name-${item.key}`} description="Defaults to the exact spreadsheet notation; vendor prefixes are not stripped automatically.">
                          <TextInput id={`create-model-name-${item.key}`} value={draft.model} onChange={(event) => updateDraft(item.key, { model: event.target.value })} />
                        </FormField>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="ghost" disabled={busyKey === item.key || disabled} onClick={() => void createReference(item, false)}>Create + use once</Button>
                    <Button type="button" variant="primary" disabled={busyKey === item.key || disabled} onClick={() => void createReference(item, true)}>Create + always match</Button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-5">
        <p className="text-xs text-[var(--muted)]">Re-run validation after making resolutions. Saved aliases are applied automatically on future XLSX previews.</p>
        <Button type="button" variant="primary" onClick={onRepreview} disabled={disabled}>Re-run preview with resolutions</Button>
      </div>
    </section>
  )
}
