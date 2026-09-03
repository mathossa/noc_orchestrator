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

type Props = {
  unresolved: DeviceImportUnresolvedReference[]
  references: DeviceImportResolutionReferences
  resolutions: DeviceImportResolutionMap
  profileId: string | null
  profileName: string | null
  onResolutionChange: (key: string, targetId: string) => void
  onReferenceCreated: (kind: DeviceImportUnresolvedReference['kind'], record: unknown) => void
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
  version: string
}

type ApiError = { error?: { message?: string } }

function suggestedCode(value: string) {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'IMPORT'
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
    platform: item.platform ?? '',
    version: item.sourceValue,
  }
}

function samePlatform(a: string, b: string) {
  return a.normalize('NFKC').trim().toLowerCase() === b.normalize('NFKC').trim().toLowerCase()
}

export function DeviceImportReferenceResolver({
  unresolved,
  references,
  resolutions,
  profileId,
  profileName,
  onResolutionChange,
  onReferenceCreated,
  onRepreview,
  disabled = false,
}: Props) {
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [createKey, setCreateKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, CreateDraft>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const activeDeviceTypes = useMemo(() => references.deviceTypes.filter((record) => record.isActive), [references.deviceTypes])
  const resolvedCount = unresolved.filter((item) => Boolean(resolutions[item.key])).length

  function choiceOptions(item: DeviceImportUnresolvedReference) {
    if (item.kind === 'CUSTOMER') return references.customers.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name}${r.code ? ` (${r.code})` : ''}` }))
    if (item.kind === 'SITE') return references.sites.filter((r) => r.isActive && r.customerId === item.customerId).map((r) => ({ id: r.id, label: `${r.name}${r.code ? ` (${r.code})` : ''}` }))
    if (item.kind === 'VENDOR') return references.vendors.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
    if (item.kind === 'DEVICE_TYPE') return activeDeviceTypes.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
    if (item.kind === 'DEVICE_MODEL') return references.models.filter((r) => r.isActive && (!item.vendorId || r.vendorId === item.vendorId)).map((r) => ({ id: r.id, label: `${r.vendor.name} · ${r.model} · ${r.deviceType.name}` }))
    if (item.kind === 'CONTRACT_TYPE') return references.contracts.filter((r) => r.isActive).map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
    return references.firmwareReleases
      .filter((r) => r.isActive && (!item.vendorId || r.vendorId === item.vendorId) && (!item.platform || samePlatform(r.platform, item.platform)))
      .map((r) => ({ id: r.id, label: `${r.vendor.name} · ${r.platform} · ${r.version} · ${r.status}` }))
  }

  function openCreate(item: DeviceImportUnresolvedReference) {
    setCreateKey((current) => current === item.key ? null : item.key)
    setDrafts((current) => current[item.key] ? current : { ...current, [item.key]: initialDraft(item, references) })
    setError(null)
    setMessage(null)
  }

  function updateDraft(key: string, patch: Partial<CreateDraft>) {
    const item = unresolved.find((candidate) => candidate.key === key)
    if (!item) return
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? initialDraft(item, references)), ...patch } }))
  }

  async function remember(item: DeviceImportUnresolvedReference, targetId: string) {
    const response = await fetch('/api/v1/device-import/reference-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: item.kind, sourceValue: item.sourceValue, contextKey: item.contextKey, targetId, profileId }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) throw new Error(payload.error?.message ?? 'The import match could not be remembered.')
  }

  async function applyExisting(item: DeviceImportUnresolvedReference, always: boolean) {
    const targetId = choices[item.key] ?? resolutions[item.key]
    if (!targetId) return
    setBusyKey(item.key)
    setError(null)
    setMessage(null)
    try {
      if (always) await remember(item, targetId)
      onResolutionChange(item.key, targetId)
      setMessage(always
        ? `“${item.sourceValue}” will now use this match for ${profileName ?? 'future XLSX imports'}.`
        : `“${item.sourceValue}” will use this record for this import only.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The import reference could not be resolved.')
    } finally {
      setBusyKey(null)
    }
  }

  async function postJson<T>(url: string, body: unknown, fallback: string) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = (await response.json()) as { data?: T } & ApiError
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? fallback)
    return payload.data
  }

  async function createReference(item: DeviceImportUnresolvedReference, always: boolean) {
    const draft = drafts[item.key] ?? initialDraft(item, references)
    setBusyKey(item.key)
    setError(null)
    setMessage(null)
    try {
      let record: { id: string }
      if (item.kind === 'CUSTOMER') {
        record = await postJson('/api/v1/customers', { name: draft.name, code: draft.code || null, source: 'IMPORT', isActive: true }, 'The customer could not be created.')
      } else if (item.kind === 'SITE') {
        if (!item.customerId) throw new Error('Resolve the customer before creating this site.')
        record = await postJson(`/api/v1/customers/${item.customerId}/sites`, { name: draft.name, code: draft.code || null, source: 'IMPORT', isActive: true }, 'The site could not be created.')
      } else if (item.kind === 'VENDOR') {
        record = await postJson('/api/v1/reference-data/vendors', { code: draft.code, name: draft.name, isActive: true }, 'The vendor could not be created.')
      } else if (item.kind === 'DEVICE_TYPE') {
        record = await postJson('/api/v1/reference-data/device-types', { code: draft.code, name: draft.name, isActive: true }, 'The device type could not be created.')
      } else if (item.kind === 'DEVICE_MODEL') {
        record = await postJson('/api/v1/models', {
          vendorId: draft.vendorId,
          deviceTypeId: draft.deviceTypeId,
          familyId: draft.familyId || null,
          model: draft.model,
          platform: draft.platform || null,
          source: 'IMPORT',
          notes: `Created while resolving XLSX import value “${item.sourceValue}”.`,
        }, 'The device model could not be created.')
      } else if (item.kind === 'CONTRACT_TYPE') {
        record = await postJson('/api/v1/reference-data/contract-types', { code: draft.code, name: draft.name, firmwareManagementEnabled: true, isActive: true }, 'The contract type could not be created.')
      } else {
        record = await postJson('/api/v1/firmware-releases', {
          vendorId: draft.vendorId,
          platform: draft.platform,
          version: draft.version,
          status: 'AVAILABLE',
          source: 'IMPORT',
          notes: `Created while resolving XLSX import value “${item.sourceValue}”.`,
          isActive: true,
        }, 'The firmware release could not be created.')
      }

      onReferenceCreated(item.kind, record)
      onResolutionChange(item.key, record.id)
      if (always) await remember(item, record.id)
      setCreateKey(null)
      setMessage(always
        ? `Created and remembered “${item.sourceValue}” for ${profileName ?? 'future XLSX imports'}.`
        : `Created a new record for “${item.sourceValue}” and selected it for this import.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The reference record could not be created.')
    } finally {
      setBusyKey(null)
    }
  }

  function createFields(item: DeviceImportUnresolvedReference, draft: CreateDraft) {
    if (item.kind === 'DEVICE_MODEL') {
      const families = references.families.filter((family) => family.isActive && family.vendorId === draft.vendorId)
      return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FormField label="Vendor" htmlFor={`create-vendor-${item.key}`}><SelectInput id={`create-vendor-${item.key}`} value={draft.vendorId} onChange={(event) => updateDraft(item.key, { vendorId: event.target.value, familyId: '' })}><option value="">Select vendor</option>{references.vendors.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
        <FormField label="Device type" htmlFor={`create-type-${item.key}`}><SelectInput id={`create-type-${item.key}`} value={draft.deviceTypeId} onChange={(event) => updateDraft(item.key, { deviceTypeId: event.target.value })}><option value="">Select type</option>{activeDeviceTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
        <FormField label="Family / series" htmlFor={`create-family-${item.key}`}><SelectInput id={`create-family-${item.key}`} value={draft.familyId} onChange={(event) => updateDraft(item.key, { familyId: event.target.value })}><option value="">No family</option>{families.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
        <FormField label="Platform" htmlFor={`create-platform-${item.key}`}><TextInput id={`create-platform-${item.key}`} value={draft.platform} onChange={(event) => updateDraft(item.key, { platform: event.target.value })} /></FormField>
        <div className="md:col-span-2 xl:col-span-4"><FormField label="Concrete model name" htmlFor={`create-model-${item.key}`} description="Defaults to the exact spreadsheet notation."><TextInput id={`create-model-${item.key}`} value={draft.model} onChange={(event) => updateDraft(item.key, { model: event.target.value })} /></FormField></div>
      </div>
    }
    if (item.kind === 'FIRMWARE_RELEASE') return <div className="grid gap-3 md:grid-cols-3">
      <FormField label="Vendor" htmlFor={`create-fw-vendor-${item.key}`}><SelectInput id={`create-fw-vendor-${item.key}`} value={draft.vendorId} onChange={(event) => updateDraft(item.key, { vendorId: event.target.value })}><option value="">Select vendor</option>{references.vendors.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectInput></FormField>
      <FormField label="Platform" htmlFor={`create-fw-platform-${item.key}`}><TextInput id={`create-fw-platform-${item.key}`} value={draft.platform} onChange={(event) => updateDraft(item.key, { platform: event.target.value })} /></FormField>
      <FormField label="Version" htmlFor={`create-fw-version-${item.key}`}><TextInput id={`create-fw-version-${item.key}`} value={draft.version} onChange={(event) => updateDraft(item.key, { version: event.target.value })} /></FormField>
    </div>
    if (item.kind === 'SITE') return <div className="grid gap-3 md:grid-cols-2"><FormField label="Site name" htmlFor={`create-name-${item.key}`} description={item.customerName ? `Under ${item.customerName}` : undefined}><TextInput id={`create-name-${item.key}`} value={draft.name} onChange={(event) => updateDraft(item.key, { name: event.target.value })} /></FormField><FormField label="Site code" htmlFor={`create-code-${item.key}`}><TextInput id={`create-code-${item.key}`} value={draft.code} onChange={(event) => updateDraft(item.key, { code: event.target.value })} /></FormField></div>
    return <div className="grid gap-3 md:grid-cols-2"><FormField label={`${item.kind === 'CUSTOMER' ? 'Customer' : item.kind === 'VENDOR' ? 'Vendor' : item.kind === 'CONTRACT_TYPE' ? 'Contract type' : 'Device type'} name`} htmlFor={`create-name-${item.key}`}><TextInput id={`create-name-${item.key}`} value={draft.name} onChange={(event) => updateDraft(item.key, { name: event.target.value })} /></FormField><FormField label="Code" htmlFor={`create-code-${item.key}`}><TextInput id={`create-code-${item.key}`} value={draft.code} onChange={(event) => updateDraft(item.key, { code: event.target.value })} /></FormField></div>
  }

  if (!unresolved.length) return null

  return <section className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5"><div><h3 className="text-sm font-semibold">Resolve spreadsheet reference values</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">Link unknown reference values, remember them for the selected export profile, or create the missing record here. One decision applies to every listed row using the same value.</p></div><div className="text-xs text-[var(--muted-strong)]">{resolvedCount} of {unresolved.length} values resolved for this preview</div></div>
    {error ? <div className="mx-4 mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-3 py-2 text-sm text-[#f0b0b0] sm:mx-5">{error}</div> : null}
    {message ? <div className="mx-4 mt-4 rounded-md border border-[#285f48] bg-[#142b22] px-3 py-2 text-sm text-[#a9e8c6] sm:mx-5">{message}</div> : null}
    <div className="divide-y divide-[var(--border)]">{unresolved.map((item) => {
      const options = choiceOptions(item)
      const selected = choices[item.key] ?? resolutions[item.key] ?? ''
      const draft = drafts[item.key] ?? initialDraft(item, references)
      return <div key={item.key} className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-light)]">{item.kind.replaceAll('_', ' ')}</div><div className="mt-1 font-mono text-sm font-semibold">{item.sourceValue}</div><div className="mt-1 text-xs text-[var(--muted)]">Rows {item.rowNumbers.join(', ')}{item.customerName ? ` · Customer: ${item.customerName}` : ''}{item.vendorName ? ` · Vendor: ${item.vendorName}` : ''}{item.platform ? ` · Platform: ${item.platform}` : ''}</div></div>{resolutions[item.key] ? <span className="rounded border border-[#285f48] bg-[#142b22] px-2 py-1 text-xs font-semibold text-[#a9e8c6]">Resolution selected</span> : null}</div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end"><FormField label="Link to existing" htmlFor={`resolve-${item.key}`}><SelectInput id={`resolve-${item.key}`} value={selected} onChange={(event) => setChoices((current) => ({ ...current, [item.key]: event.target.value }))}><option value="">Choose configured record</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</SelectInput></FormField><Button type="button" variant="ghost" disabled={!selected || busyKey === item.key || disabled} onClick={() => void applyExisting(item, false)}>Use once</Button><Button type="button" variant="ghost" disabled={!selected || busyKey === item.key || disabled} onClick={() => void applyExisting(item, true)}>{profileName ? `Always for ${profileName}` : 'Always match'}</Button><Button type="button" variant="primary" disabled={busyKey === item.key || disabled} onClick={() => openCreate(item)}>{createKey === item.key ? 'Close create' : 'Create new'}</Button></div>
        {createKey === item.key ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">{createFields(item, draft)}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={busyKey === item.key || disabled} onClick={() => void createReference(item, false)}>Create + use once</Button><Button type="button" variant="primary" disabled={busyKey === item.key || disabled} onClick={() => void createReference(item, true)}>Create + remember</Button></div></div> : null}
      </div>
    })}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-5"><p className="text-xs text-[var(--muted)]">Re-run validation after resolving values. Site choices are always scoped to their resolved customer.</p><Button type="button" variant="primary" onClick={onRepreview} disabled={disabled}>Re-run preview with resolutions</Button></div>
  </section>
}
