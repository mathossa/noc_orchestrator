'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/ui/filter-bar'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type {
  DeviceModelFieldErrors,
  DeviceModelFirmwareReference,
  DeviceModelRecord,
  DeviceModelReference,
} from '@/lib/device-models'
import type {
  DeviceModelFamilyFieldErrors,
  DeviceModelFamilyRecord,
  DeviceModelFamilyReference,
} from '@/lib/model-families'
import {
  commonCompatibleDesiredReleases,
  groupDeviceModels,
  type DeviceModelCatalogGroupBy,
} from '@/lib/model-bulk-firmware'

type ApiError = {
  error?: {
    message?: string
    fields?: DeviceModelFieldErrors | DeviceModelFamilyFieldErrors
  }
}

type ReferenceData = {
  vendors: DeviceModelReference[]
  deviceTypes: DeviceModelReference[]
  families: DeviceModelFamilyReference[]
  firmwareReleases: DeviceModelFirmwareReference[]
}

type FormState = {
  vendorId: string
  deviceTypeId: string
  familyId: string
  model: string
  platform: string
  notes: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

type FamilyFormState = {
  vendorId: string
  name: string
  notes: string
  isActive: boolean
}

const EMPTY_REFERENCES: ReferenceData = { vendors: [], deviceTypes: [], families: [], firmwareReleases: [] }

const initialForm: FormState = {
  vendorId: '',
  deviceTypeId: '',
  familyId: '',
  model: '',
  platform: '',
  notes: '',
  source: 'MANUAL',
  externalProvider: '',
  externalId: '',
  isActive: true,
}

const initialFamilyForm: FamilyFormState = {
  vendorId: '',
  name: '',
  notes: '',
  isActive: true,
}

function formForRecord(record: DeviceModelRecord): FormState {
  return {
    vendorId: record.vendorId,
    deviceTypeId: record.deviceTypeId,
    familyId: record.familyId ?? '',
    model: record.model,
    platform: record.platform ?? '',
    notes: record.notes ?? '',
    source: record.source,
    externalProvider: record.externalProvider ?? '',
    externalId: record.externalId ?? '',
    isActive: record.isActive,
  }
}

function familyFormForRecord(record: DeviceModelFamilyRecord): FamilyFormState {
  return {
    vendorId: record.vendorId,
    name: record.name,
    notes: record.notes ?? '',
    isActive: record.isActive,
  }
}

async function fetchModels() {
  const response = await fetch('/api/v1/models', { cache: 'no-store' })
  const payload = (await response.json()) as {
    data?: DeviceModelRecord[]
    references?: ReferenceData
  } & ApiError

  if (!response.ok) throw new Error(payload.error?.message ?? 'Device models could not be loaded.')
  return {
    records: payload.data ?? [],
    references: payload.references ?? EMPTY_REFERENCES,
  }
}

async function fetchFamilies() {
  const response = await fetch('/api/v1/model-families', { cache: 'no-store' })
  const payload = (await response.json()) as { data?: DeviceModelFamilyRecord[] } & ApiError
  if (!response.ok) throw new Error(payload.error?.message ?? 'Model families could not be loaded.')
  return payload.data ?? []
}

export function DeviceModelManager({ initialEditId = '' }: { initialEditId?: string }) {
  const [records, setRecords] = useState<DeviceModelRecord[]>([])
  const [references, setReferences] = useState<ReferenceData>(EMPTY_REFERENCES)
  const [families, setFamilies] = useState<DeviceModelFamilyRecord[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<DeviceModelFieldErrors>({})
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [deviceTypeFilter, setDeviceTypeFilter] = useState('')
  const [familyFilter, setFamilyFilter] = useState('')
  const [groupBy, setGroupBy] = useState<DeviceModelCatalogGroupBy>('none')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkReleaseId, setBulkReleaseId] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  const [familyForm, setFamilyForm] = useState<FamilyFormState>(initialFamilyForm)
  const [familyEditingId, setFamilyEditingId] = useState<string | null>(null)
  const [familySaving, setFamilySaving] = useState(false)
  const [familyFieldErrors, setFamilyFieldErrors] = useState<DeviceModelFamilyFieldErrors>({})

  useEffect(() => {
    let cancelled = false

    void Promise.all([fetchModels(), fetchFamilies()])
      .then(([result, familyRecords]) => {
        if (cancelled) return
        setRecords(result.records)
        setReferences(result.references)
        setFamilies(familyRecords)
        setError(null)

        if (initialEditId) {
          const initialEditRecord = result.records.find((record) => record.id === initialEditId)
          if (initialEditRecord) {
            setEditingId(initialEditRecord.id)
            setForm(formForRecord(initialEditRecord))
          }
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Device models could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [initialEditId])

  async function reloadModels() {
    try {
      const [result, familyRecords] = await Promise.all([fetchModels(), fetchFamilies()])
      setRecords(result.records)
      setReferences(result.references)
      setFamilies(familyRecords)
      setSelectedIds((current) => current.filter((id) => result.records.some((record) => record.id === id)))
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Device models could not be loaded.')
    }
  }

  function resetForm() {
    setForm(initialForm)
    setEditingId(null)
    setFieldErrors({})
  }

  function beginEdit(record: DeviceModelRecord) {
    setEditingId(record.id)
    setForm(formForRecord(record))
    setFieldErrors({})
    setError(null)
    setMessage(null)
  }

  function changeModelVendor(vendorId: string) {
    const selectedFamily = references.families.find((family) => family.id === form.familyId)
    setForm((current) => ({
      ...current,
      vendorId,
      familyId: selectedFamily?.vendorId === vendorId ? current.familyId : '',
    }))
  }

  async function saveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})

    try {
      const response = await fetch(editingId ? `/api/v1/models/${editingId}` : '/api/v1/models', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, familyId: form.familyId || null }),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors((payload.error?.fields ?? {}) as DeviceModelFieldErrors)
        throw new Error(payload.error?.message ?? 'Device model could not be saved.')
      }

      setMessage(editingId ? 'Device model updated.' : 'Device model created.')
      resetForm()
      await reloadModels()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Device model could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(record: DeviceModelRecord) {
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/models/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Device model could not be updated.')
      return
    }

    setMessage(record.isActive ? 'Device model archived.' : 'Device model reactivated.')
    if (editingId === record.id) resetForm()
    await reloadModels()
  }

  async function deleteModel(record: DeviceModelRecord) {
    if (!window.confirm(`Permanently delete “${record.vendor.name} ${record.model}”? Referenced models cannot be deleted.`)) {
      return
    }

    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/models/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Device model could not be deleted.')
      return
    }

    setMessage('Device model deleted.')
    if (editingId === record.id) resetForm()
    setSelectedIds((current) => current.filter((id) => id !== record.id))
    await reloadModels()
  }

  function resetFamilyForm() {
    setFamilyForm(initialFamilyForm)
    setFamilyEditingId(null)
    setFamilyFieldErrors({})
  }

  function beginFamilyEdit(record: DeviceModelFamilyRecord) {
    setFamilyEditingId(record.id)
    setFamilyForm(familyFormForRecord(record))
    setFamilyFieldErrors({})
    setError(null)
    setMessage(null)
  }

  async function saveFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFamilySaving(true)
    setError(null)
    setMessage(null)
    setFamilyFieldErrors({})
    try {
      const response = await fetch(
        familyEditingId ? `/api/v1/model-families/${familyEditingId}` : '/api/v1/model-families',
        {
          method: familyEditingId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(familyForm),
        },
      )
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFamilyFieldErrors((payload.error?.fields ?? {}) as DeviceModelFamilyFieldErrors)
        throw new Error(payload.error?.message ?? 'Model family could not be saved.')
      }
      setMessage(familyEditingId ? 'Model family updated.' : 'Model family created.')
      resetFamilyForm()
      await reloadModels()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Model family could not be saved.')
    } finally {
      setFamilySaving(false)
    }
  }

  async function toggleFamilyArchive(record: DeviceModelFamilyRecord) {
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/model-families/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Model family could not be updated.')
      return
    }
    setMessage(record.isActive ? 'Model family archived.' : 'Model family reactivated.')
    if (familyEditingId === record.id) resetFamilyForm()
    await reloadModels()
  }

  async function deleteFamily(record: DeviceModelFamilyRecord) {
    if (!window.confirm(`Permanently delete family / series “${record.vendor.name} ${record.name}”? Populated families cannot be deleted.`)) return
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/model-families/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Model family could not be deleted.')
      return
    }
    setMessage('Model family deleted.')
    if (familyEditingId === record.id) resetFamilyForm()
    if (familyFilter === record.id) setFamilyFilter('')
    await reloadModels()
  }

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-US')
    return records.filter((record) => {
      if (vendorFilter && record.vendorId !== vendorFilter) return false
      if (deviceTypeFilter && record.deviceTypeId !== deviceTypeFilter) return false
      if (familyFilter === '__none__' && record.familyId) return false
      if (familyFilter && familyFilter !== '__none__' && record.familyId !== familyFilter) return false
      if (!query) return true
      return [record.model, record.platform, record.vendor.name, record.deviceType.name, record.family?.name]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('en-US').includes(query))
    })
  }, [deviceTypeFilter, familyFilter, records, search, vendorFilter])

  const groups = useMemo(() => groupDeviceModels(filteredRecords, groupBy), [filteredRecords, groupBy])
  const selectedModels = useMemo(
    () => records.filter((record) => selectedIds.includes(record.id)),
    [records, selectedIds],
  )
  const commonReleases = useMemo(
    () => commonCompatibleDesiredReleases(selectedModels, references.firmwareReleases),
    [references.firmwareReleases, selectedModels],
  )
  const mixedVendors = new Set(selectedModels.map((model) => model.vendorId)).size > 1

  useEffect(() => {
    if (bulkReleaseId && !commonReleases.some((release) => release.id === bulkReleaseId)) {
      setBulkReleaseId('')
    }
  }, [bulkReleaseId, commonReleases])

  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function setSelection(ids: string[], selected: boolean) {
    setSelectedIds((current) => {
      const set = new Set(current)
      for (const id of ids) {
        if (selected) set.add(id)
        else set.delete(id)
      }
      return [...set]
    })
  }

  function selectFamilyVariants(family: DeviceModelFamilyRecord) {
    const modelIds = records.filter((record) => record.familyId === family.id).map((record) => record.id)
    setVendorFilter(family.vendorId)
    setFamilyFilter(family.id)
    setGroupBy('family')
    setSelection(modelIds, true)
    setMessage(`${modelIds.length} ${family.name} variant${modelIds.length === 1 ? '' : 's'} selected.`)
  }

  async function applyBulkDesired() {
    if (!bulkReleaseId || selectedIds.length === 0) return
    const release = commonReleases.find((item) => item.id === bulkReleaseId)
    if (!release) return
    if (!window.confirm(`Set exact desired firmware ${release.version} on ${selectedIds.length} selected model${selectedIds.length === 1 ? '' : 's'}?`)) return

    setBulkSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/v1/models/bulk-desired-firmware', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelIds: selectedIds, firmwareReleaseId: bulkReleaseId }),
      })
      const payload = (await response.json()) as { data?: { changed: number; unchanged: number } } & ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'Bulk desired firmware could not be applied.')
      const changed = payload.data?.changed ?? 0
      const unchanged = payload.data?.unchanged ?? 0
      setMessage(`Desired firmware applied to ${changed} model${changed === 1 ? '' : 's'}${unchanged ? `; ${unchanged} already matched` : ''}.`)
      setSelectedIds([])
      setBulkReleaseId('')
      await reloadModels()
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : 'Bulk desired firmware could not be applied.')
    } finally {
      setBulkSaving(false)
    }
  }

  async function clearBulkDesired() {
    if (selectedIds.length === 0) return
    if (!window.confirm(`Clear desired firmware on ${selectedIds.length} selected model${selectedIds.length === 1 ? '' : 's'}? Existing policy rows remain in history.`)) return

    setBulkSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/v1/models/bulk-desired-firmware', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelIds: selectedIds }),
      })
      const payload = (await response.json()) as { data?: { changed: number; unchanged: number } } & ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'Bulk desired firmware could not be cleared.')
      const changed = payload.data?.changed ?? 0
      const unchanged = payload.data?.unchanged ?? 0
      setMessage(`Desired firmware cleared on ${changed} model${changed === 1 ? '' : 's'}${unchanged ? `; ${unchanged} had no active policy` : ''}.`)
      setSelectedIds([])
      setBulkReleaseId('')
      await reloadModels()
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : 'Bulk desired firmware could not be cleared.')
    } finally {
      setBulkSaving(false)
    }
  }

  const activeVendorCount = references.vendors.filter((vendor) => vendor.isActive).length
  const activeTypeCount = references.deviceTypes.filter((deviceType) => deviceType.isActive).length
  const modelFamilies = references.families.filter((family) => family.vendorId === form.vendorId)

  return (
    <>
      <PageHeader
        eyebrow="Firmware catalog"
        title="Device models"
        description="Manage concrete hardware variants, group them into explicit vendor families / series, and apply exact desired firmware to compatible selections."
        actions={<Link href="/firmware" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Firmware catalog</Link>}
      />

      {message ? (
        <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div>
      ) : null}

      <details className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
          Model families / series <span className="ml-2 text-xs font-normal text-[var(--muted)]">{families.length} configured</span>
        </summary>
        <div className="grid gap-5 border-t border-[var(--border)] p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {families.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--border-strong)] px-4 py-6 text-sm text-[var(--muted)]">
                No families / series configured yet. Families group concrete variants explicitly; membership is never inferred from the model name.
              </div>
            ) : (
              <div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                    <tr><th className="px-3 py-2.5">Family / series</th><th className="px-3 py-2.5">Vendor</th><th className="px-3 py-2.5 text-right">Models</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {families.map((family) => (
                      <tr key={family.id} className={family.isActive ? '' : 'opacity-60'}>
                        <td className="px-3 py-2.5"><div className="font-semibold">{family.name}</div>{family.notes ? <div className="mt-0.5 max-w-md truncate text-xs text-[var(--muted)]">{family.notes}</div> : null}</td>
                        <td className="px-3 py-2.5 text-[var(--muted-strong)]">{family.vendor.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{family.modelCount}</td>
                        <td className="px-3 py-2.5 text-xs text-[var(--muted-strong)]">{family.isActive ? 'Active' : 'Archived'}</td>
                        <td className="px-3 py-2.5"><div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => selectFamilyVariants(family)}>Select variants</Button><Button variant="ghost" onClick={() => beginFamilyEdit(family)}>Edit</Button><Button variant="ghost" onClick={() => void toggleFamilyArchive(family)}>{family.isActive ? 'Archive' : 'Reactivate'}</Button><Button variant="danger" onClick={() => void deleteFamily(family)}>Delete</Button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <form onSubmit={(event) => void saveFamily(event)} className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <div><h3 className="text-sm font-semibold">{familyEditingId ? 'Edit family / series' : 'Add family / series'}</h3><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Vendor-scoped grouping only. A family does not inherit or auto-apply firmware.</p></div>
            <FormField label="Vendor" htmlFor="family-vendor" error={familyFieldErrors.vendorId}>
              <SelectInput id="family-vendor" value={familyForm.vendorId} onChange={(event) => setFamilyForm((current) => ({ ...current, vendorId: event.target.value }))} required>
                <option value="">Select vendor</option>
                {references.vendors.map((vendor) => <option key={vendor.id} value={vendor.id} disabled={!vendor.isActive && vendor.id !== familyForm.vendorId}>{vendor.name}{vendor.isActive ? '' : ' (archived)'}</option>)}
              </SelectInput>
            </FormField>
            <FormField label="Family / series" htmlFor="family-name" error={familyFieldErrors.name}><TextInput id="family-name" value={familyForm.name} onChange={(event) => setFamilyForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. 2530" required /></FormField>
            <FormField label="Notes" htmlFor="family-notes" error={familyFieldErrors.notes}><TextArea id="family-notes" value={familyForm.notes} onChange={(event) => setFamilyForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional family context" /></FormField>
            <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]"><input type="checkbox" checked={familyForm.isActive} onChange={(event) => setFamilyForm((current) => ({ ...current, isActive: event.target.checked }))} />Active family</label>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">{familyEditingId ? <Button type="button" variant="ghost" onClick={resetFamilyForm} disabled={familySaving}>Cancel</Button> : null}<Button type="submit" variant="primary" disabled={familySaving || activeVendorCount === 0}>{familySaving ? 'Saving…' : familyEditingId ? 'Save family' : 'Create family'}</Button></div>
          </form>
        </div>
      </details>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <FilterBar>
            <FilterSearch id="model-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, family, platform, vendor…" />
            <FilterSelect id="model-vendor-filter" label="Vendor" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)} options={[{ value: '', label: 'All vendors' }, ...references.vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))]} />
            <FilterSelect id="model-type-filter" label="Device type" value={deviceTypeFilter} onChange={(event) => setDeviceTypeFilter(event.target.value)} options={[{ value: '', label: 'All device types' }, ...references.deviceTypes.map((deviceType) => ({ value: deviceType.id, label: deviceType.name }))]} />
            <FilterSelect id="model-family-filter" label="Family / series" value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value)} options={[{ value: '', label: 'All families' }, { value: '__none__', label: 'No family / series' }, ...references.families.map((family) => ({ value: family.id, label: `${family.name} · ${references.vendors.find((vendor) => vendor.id === family.vendorId)?.name ?? 'Vendor'}` }))]} />
            <FilterSelect id="model-group-by" label="Group by" value={groupBy} onChange={(event) => setGroupBy(event.target.value as DeviceModelCatalogGroupBy)} options={[{ value: 'none', label: 'No grouping' }, { value: 'family', label: 'Family / series' }, { value: 'vendor', label: 'Vendor' }, { value: 'deviceType', label: 'Device type' }]} />
          </FilterBar>

          {selectedModels.length > 0 ? (
            <section className="rounded-lg border border-[var(--accent-muted)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-sm font-semibold">Bulk desired firmware · {selectedModels.length} selected</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">This explicitly changes each selected concrete model policy. Family membership itself never inherits firmware.</p></div>
                <Button variant="ghost" onClick={() => { setSelectedIds([]); setBulkReleaseId('') }}>Clear selection</Button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
                <FormField label="Exact desired release" htmlFor="bulk-desired-release" description={mixedVendors ? 'Mixed vendors cannot share a firmware target. Clear is still available.' : commonReleases.length === 0 ? 'No APPROVED/RECOMMENDED release is compatible with every selected model.' : 'Only releases compatible with every selected concrete model are offered.'}>
                  <SelectInput id="bulk-desired-release" value={bulkReleaseId} onChange={(event) => setBulkReleaseId(event.target.value)} disabled={mixedVendors || commonReleases.length === 0 || bulkSaving}>
                    <option value="">Select exact release</option>
                    {commonReleases.map((release) => <option key={release.id} value={release.id}>{release.version} · {release.platform} · {release.status}{release.firmwareTrain ? ` · ${release.firmwareTrain.name}` : ''}</option>)}
                  </SelectInput>
                </FormField>
                <Button variant="primary" onClick={() => void applyBulkDesired()} disabled={!bulkReleaseId || bulkSaving || mixedVendors}>{bulkSaving ? 'Saving…' : 'Apply desired'}</Button>
                <Button variant="ghost" onClick={() => void clearBulkDesired()} disabled={bulkSaving}>{bulkSaving ? 'Saving…' : 'Clear desired'}</Button>
              </div>
            </section>
          ) : null}

          <section className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <div><h2 className="text-sm font-semibold">Concrete models</h2><p className="mt-0.5 text-xs text-[var(--muted)]">Devices always reference these concrete models. Desired firmware shown here is the exact active model policy.</p></div>
              <span className="text-xs text-[var(--muted)]">{filteredRecords.length} shown / {records.length} total</span>
            </div>

            {loading ? (
              <LoadingState title="Loading device models" />
            ) : records.length === 0 ? (
              <EmptyState title="No device models configured" description="Create the first concrete model using the form. Vendors and device types must exist first." />
            ) : filteredRecords.length === 0 ? (
              <EmptyState title="No models match these filters" description="Change or clear the model filters to see other records." />
            ) : (
              <div className="space-y-4 p-3">
                {groups.map((group) => (
                  <div key={group.key}>
                    {group.label ? <div className="mb-2 flex items-center gap-2 px-1"><h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--accent-light)]">{group.label}</h3><span className="text-xs text-[var(--muted)]">{group.rows.length}</span>{group.familyId ? <button type="button" onClick={() => setSelection(group.rows.map((row) => row.id), true)} className="ml-auto text-xs font-semibold text-[var(--accent-light)] hover:underline">Select all variants</button> : null}</div> : null}
                    <ModelTable
                      records={group.rows}
                      editingId={editingId}
                      selectedIds={selectedIds}
                      onToggleSelection={toggleSelection}
                      onSetSelection={setSelection}
                      onEdit={beginEdit}
                      onToggleArchive={(record) => void toggleArchive(record)}
                      onDelete={(record) => void deleteModel(record)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="mb-4"><h2 className="text-sm font-semibold">{editingId ? 'Edit concrete model' : 'Add concrete model'}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Family / series is optional grouping. Platform remains the concrete firmware-compatibility field.</p></div>

          {activeVendorCount === 0 || activeTypeCount === 0 ? <div className="mb-4 rounded-md border border-[var(--warning)]/40 bg-[#2b2415] px-3 py-2 text-xs leading-5 text-[#efd18d]">You need at least one active vendor and one active device type before creating a model.</div> : null}

          {editingId ? <div className="mb-4 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Desired firmware</div><p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">Desired firmware remains an explicit policy separate from family and model metadata.</p><Link href={`/models/${editingId}#desired-firmware-policy`} className="mt-2 inline-flex text-sm font-semibold text-[var(--accent-light)] hover:underline">Configure desired firmware →</Link></div> : null}

          <form onSubmit={(event) => void saveModel(event)} className="space-y-4">
            <FormField label="Vendor" htmlFor="model-vendor" error={fieldErrors.vendorId}><SelectInput id="model-vendor" value={form.vendorId} onChange={(event) => changeModelVendor(event.target.value)} required><option value="">Select vendor</option>{references.vendors.map((vendor) => <option key={vendor.id} value={vendor.id} disabled={!vendor.isActive && vendor.id !== form.vendorId}>{vendor.name}{vendor.isActive ? '' : ' (archived)'}</option>)}</SelectInput></FormField>
            <FormField label="Family / series" htmlFor="model-family" description={form.vendorId ? 'Optional explicit grouping; only families from the selected vendor are shown.' : 'Select a vendor first.'} error={fieldErrors.familyId}><SelectInput id="model-family" value={form.familyId} onChange={(event) => setForm((current) => ({ ...current, familyId: event.target.value }))} disabled={!form.vendorId}><option value="">No family / series</option>{modelFamilies.map((family) => <option key={family.id} value={family.id} disabled={!family.isActive && family.id !== form.familyId}>{family.name}{family.isActive ? '' : ' (archived)'}</option>)}</SelectInput></FormField>
            <FormField label="Device type" htmlFor="model-device-type" error={fieldErrors.deviceTypeId}><SelectInput id="model-device-type" value={form.deviceTypeId} onChange={(event) => setForm((current) => ({ ...current, deviceTypeId: event.target.value }))} required><option value="">Select device type</option>{references.deviceTypes.map((deviceType) => <option key={deviceType.id} value={deviceType.id} disabled={!deviceType.isActive && deviceType.id !== form.deviceTypeId}>{deviceType.name}{deviceType.isActive ? '' : ' (archived)'}</option>)}</SelectInput></FormField>
            <FormField label="Concrete model" htmlFor="model-name" error={fieldErrors.model}><TextInput id="model-name" value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder="e.g. 2530-24G" required /></FormField>
            <FormField label="Platform / firmware compatibility" htmlFor="model-platform" error={fieldErrors.platform} description="Optional. Kept on the concrete model because variants in one marketing family may use different firmware."><TextInput id="model-platform" value={form.platform} onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))} placeholder="e.g. AOS-S" /></FormField>
            <FormField label="Notes" htmlFor="model-notes" error={fieldErrors.notes}><TextArea id="model-notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional firmware or model-specific notes" /></FormField>

            <details className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3" open={form.source !== 'MANUAL'}><summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-strong)]">Advanced / synchronization identity</summary><div className="mt-4 space-y-4"><FormField label="Source" htmlFor="model-source" error={fieldErrors.source}><SelectInput id="model-source" value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}><option value="MANUAL">Manual</option><option value="API">API</option><option value="IMPORT">Import</option></SelectInput></FormField><FormField label="External provider" htmlFor="model-external-provider" error={fieldErrors.externalProvider}><TextInput id="model-external-provider" value={form.externalProvider} onChange={(event) => setForm((current) => ({ ...current, externalProvider: event.target.value }))} placeholder="Optional source system" /></FormField><FormField label="External ID" htmlFor="model-external-id" error={fieldErrors.externalId}><TextInput id="model-external-id" value={form.externalId} onChange={(event) => setForm((current) => ({ ...current, externalId: event.target.value }))} placeholder="Stable ID in the source system" /></FormField></div></details>

            <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />Active model</label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">{editingId ? <Button type="button" variant="ghost" onClick={resetForm} disabled={saving}>Cancel</Button> : null}<Button type="submit" variant="primary" disabled={saving || activeVendorCount === 0 || activeTypeCount === 0}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create model'}</Button></div>
          </form>
        </section>
      </div>
    </>
  )
}

function ModelTable({
  records,
  editingId,
  selectedIds,
  onToggleSelection,
  onSetSelection,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  records: DeviceModelRecord[]
  editingId: string | null
  selectedIds: string[]
  onToggleSelection: (id: string) => void
  onSetSelection: (ids: string[], selected: boolean) => void
  onEdit: (record: DeviceModelRecord) => void
  onToggleArchive: (record: DeviceModelRecord) => void
  onDelete: (record: DeviceModelRecord) => void
}) {
  const ids = records.map((record) => record.id)
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id))

  return (
    <div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="w-full min-w-[1220px] text-left text-sm">
        <caption className="sr-only">Concrete device model catalog</caption>
        <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
          <tr>
            <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all models in this table" checked={allSelected} onChange={(event) => onSetSelection(ids, event.target.checked)} /></th>
            <th className="px-3 py-2.5 font-semibold">Model</th>
            <th className="px-3 py-2.5 font-semibold">Family / series</th>
            <th className="px-3 py-2.5 font-semibold">Vendor / type</th>
            <th className="px-3 py-2.5 font-semibold">Platform</th>
            <th className="px-3 py-2.5 font-semibold">Desired firmware</th>
            <th className="px-3 py-2.5 text-right font-semibold">Devices</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {records.map((record) => (
            <tr key={record.id} className={`${record.isActive ? '' : 'opacity-60'} ${editingId === record.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-muted)]'}`}>
              <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Select ${record.model}`} checked={selectedIds.includes(record.id)} onChange={() => onToggleSelection(record.id)} /></td>
              <td className="px-3 py-2.5"><Link href={`/models/${record.id}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)]">{record.model}</Link><div className="mt-0.5 text-xs text-[var(--muted)]">{record.source}</div></td>
              <td className="px-3 py-2.5 text-[var(--muted-strong)]">{record.family?.name ?? '—'}</td>
              <td className="px-3 py-2.5"><div className="text-[var(--muted-strong)]">{record.vendor.name}</div><div className="mt-0.5 text-xs text-[var(--muted)]">{record.deviceType.name}</div></td>
              <td className="px-3 py-2.5 text-[var(--muted-strong)]">{record.platform ?? '—'}</td>
              <td className="px-3 py-2.5">{record.desiredFirmwareRelease ? <Link href={`/firmware/${record.desiredFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{record.desiredFirmwareRelease.version}<span className="ml-2 font-sans text-xs font-normal text-[var(--muted)]">{record.desiredFirmwareRelease.status}</span></Link> : <span className="text-xs text-[var(--muted)]">No policy</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums"><Link href={`/devices?model=${encodeURIComponent(record.id)}`} className="font-semibold text-[var(--accent-light)] hover:underline">{record.deviceCount}</Link></td>
              <td className="px-3 py-2.5"><span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--muted-strong)]">{record.isActive ? 'Active' : 'Archived'}</span></td>
              <td className="px-3 py-2.5"><div className="flex justify-end gap-1"><Link href={`/models/${record.id}`} className="inline-flex h-9 items-center rounded-md border border-transparent px-3 text-sm font-semibold text-[var(--muted-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)]">View</Link><Link href={`/models/${record.id}#desired-firmware-policy`} className="inline-flex h-9 items-center rounded-md border border-transparent px-3 text-sm font-semibold text-[var(--muted-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)]">Desired</Link><Button variant="ghost" onClick={() => onEdit(record)}>Edit</Button><Button variant="ghost" onClick={() => onToggleArchive(record)}>{record.isActive ? 'Archive' : 'Reactivate'}</Button><Button variant="danger" onClick={() => onDelete(record)}>Delete</Button></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
