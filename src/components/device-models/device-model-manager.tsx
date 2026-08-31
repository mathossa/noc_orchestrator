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
  DeviceModelRecord,
  DeviceModelReference,
} from '@/lib/device-models'

type ApiError = {
  error?: {
    message?: string
    fields?: DeviceModelFieldErrors
  }
}

type ReferenceData = {
  vendors: DeviceModelReference[]
  deviceTypes: DeviceModelReference[]
}

type FormState = {
  vendorId: string
  deviceTypeId: string
  model: string
  platform: string
  notes: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

type GroupBy = 'none' | 'vendor' | 'deviceType'

const initialForm: FormState = {
  vendorId: '',
  deviceTypeId: '',
  model: '',
  platform: '',
  notes: '',
  source: 'MANUAL',
  externalProvider: '',
  externalId: '',
  isActive: true,
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
    references: payload.references ?? { vendors: [], deviceTypes: [] },
  }
}

export function DeviceModelManager() {
  const [records, setRecords] = useState<DeviceModelRecord[]>([])
  const [references, setReferences] = useState<ReferenceData>({ vendors: [], deviceTypes: [] })
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
  const [groupBy, setGroupBy] = useState<GroupBy>('none')

  useEffect(() => {
    let cancelled = false

    void fetchModels()
      .then((result) => {
        if (cancelled) return
        setRecords(result.records)
        setReferences(result.references)
        setError(null)
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
  }, [])

  async function reloadModels() {
    try {
      const result = await fetchModels()
      setRecords(result.records)
      setReferences(result.references)
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
    setForm({
      vendorId: record.vendorId,
      deviceTypeId: record.deviceTypeId,
      model: record.model,
      platform: record.platform ?? '',
      notes: record.notes ?? '',
      source: record.source,
      externalProvider: record.externalProvider ?? '',
      externalId: record.externalId ?? '',
      isActive: record.isActive,
    })
    setFieldErrors({})
    setError(null)
    setMessage(null)
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
        body: JSON.stringify(form),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
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
    await reloadModels()
  }

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-US')
    return records.filter((record) => {
      if (vendorFilter && record.vendorId !== vendorFilter) return false
      if (deviceTypeFilter && record.deviceTypeId !== deviceTypeFilter) return false
      if (!query) return true
      return [record.model, record.platform, record.vendor.name, record.deviceType.name]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('en-US').includes(query))
    })
  }, [deviceTypeFilter, records, search, vendorFilter])

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null as string | null, rows: filteredRecords }]

    const map = new Map<string, { label: string; rows: DeviceModelRecord[] }>()
    for (const record of filteredRecords) {
      const key = groupBy === 'vendor' ? record.vendorId : record.deviceTypeId
      const label = groupBy === 'vendor' ? record.vendor.name : record.deviceType.name
      const group = map.get(key)
      if (group) group.rows.push(record)
      else map.set(key, { label, rows: [record] })
    }

    return [...map.entries()]
      .map(([key, group]) => ({ key, ...group }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [filteredRecords, groupBy])

  const activeVendorCount = references.vendors.filter((vendor) => vendor.isActive).length
  const activeTypeCount = references.deviceTypes.filter((deviceType) => deviceType.isActive).length

  return (
    <>
      <PageHeader
        eyebrow="Firmware catalog"
        title="Device models"
        description="Manage vendor-specific hardware models that connect inventory, device type, firmware catalog, and desired-state policy."
      />

      {message ? (
        <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <FilterBar>
            <FilterSearch
              id="model-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Model, platform, vendor…"
            />
            <FilterSelect
              id="model-vendor-filter"
              label="Vendor"
              value={vendorFilter}
              onChange={(event) => setVendorFilter(event.target.value)}
              options={[
                { value: '', label: 'All vendors' },
                ...references.vendors.map((vendor) => ({ value: vendor.id, label: vendor.name })),
              ]}
            />
            <FilterSelect
              id="model-type-filter"
              label="Device type"
              value={deviceTypeFilter}
              onChange={(event) => setDeviceTypeFilter(event.target.value)}
              options={[
                { value: '', label: 'All device types' },
                ...references.deviceTypes.map((deviceType) => ({ value: deviceType.id, label: deviceType.name })),
              ]}
            />
            <FilterSelect
              id="model-group-by"
              label="Group by"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as GroupBy)}
              options={[
                { value: 'none', label: 'No grouping' },
                { value: 'vendor', label: 'Vendor' },
                { value: 'deviceType', label: 'Device type' },
              ]}
            />
          </FilterBar>

          <section className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Configured models</h2>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  Model identity is vendor-scoped. Archived models remain available for historical references.
                </p>
              </div>
              <span className="text-xs text-[var(--muted)]">
                {filteredRecords.length} shown / {records.length} total
              </span>
            </div>

            {loading ? (
              <LoadingState title="Loading device models" />
            ) : records.length === 0 ? (
              <EmptyState
                title="No device models configured"
                description="Create the first model using the form. Vendors and device types must exist first."
              />
            ) : filteredRecords.length === 0 ? (
              <EmptyState title="No models match these filters" description="Change or clear the model filters to see other records." />
            ) : (
              <div className="space-y-4 p-3">
                {groups.map((group) => (
                  <div key={group.key}>
                    {group.label ? (
                      <div className="mb-2 flex items-center gap-2 px-1">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--accent-light)]">
                          {group.label}
                        </h3>
                        <span className="text-xs text-[var(--muted)]">{group.rows.length}</span>
                      </div>
                    ) : null}
                    <ModelTable
                      records={group.rows}
                      editingId={editingId}
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
          <div className="mb-4">
            <h2 className="text-sm font-semibold">{editingId ? 'Edit device model' : 'Add device model'}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              The same model label may exist under different vendors, but not twice for one vendor after case/whitespace normalization.
            </p>
          </div>

          {activeVendorCount === 0 || activeTypeCount === 0 ? (
            <div className="mb-4 rounded-md border border-[var(--warning)]/40 bg-[#2b2415] px-3 py-2 text-xs leading-5 text-[#efd18d]">
              You need at least one active vendor and one active device type before creating a model.
            </div>
          ) : null}

          <form onSubmit={(event) => void saveModel(event)} className="space-y-4">
            <FormField label="Vendor" htmlFor="model-vendor" error={fieldErrors.vendorId}>
              <SelectInput
                id="model-vendor"
                value={form.vendorId}
                onChange={(event) => setForm((current) => ({ ...current, vendorId: event.target.value }))}
                required
              >
                <option value="">Select vendor</option>
                {references.vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id} disabled={!vendor.isActive && vendor.id !== form.vendorId}>
                    {vendor.name}{vendor.isActive ? '' : ' (archived)'}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField label="Device type" htmlFor="model-device-type" error={fieldErrors.deviceTypeId}>
              <SelectInput
                id="model-device-type"
                value={form.deviceTypeId}
                onChange={(event) => setForm((current) => ({ ...current, deviceTypeId: event.target.value }))}
                required
              >
                <option value="">Select device type</option>
                {references.deviceTypes.map((deviceType) => (
                  <option
                    key={deviceType.id}
                    value={deviceType.id}
                    disabled={!deviceType.isActive && deviceType.id !== form.deviceTypeId}
                  >
                    {deviceType.name}{deviceType.isActive ? '' : ' (archived)'}
                  </option>
                ))}
              </SelectInput>
            </FormField>

            <FormField label="Model" htmlFor="model-name" error={fieldErrors.model}>
              <TextInput
                id="model-name"
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                placeholder="e.g. C9300-24P"
                required
              />
            </FormField>

            <FormField
              label="Platform / firmware family"
              htmlFor="model-platform"
              error={fieldErrors.platform}
              description="Optional. Used later to connect compatible firmware releases without assuming vendor naming conventions."
            >
              <TextInput
                id="model-platform"
                value={form.platform}
                onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}
                placeholder="e.g. Catalyst 9300"
              />
            </FormField>

            <FormField label="Notes" htmlFor="model-notes" error={fieldErrors.notes}>
              <TextArea
                id="model-notes"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional firmware or model-specific notes"
              />
            </FormField>

            <details className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3" open={form.source !== 'MANUAL'}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-strong)]">
                Advanced / synchronization identity
              </summary>
              <div className="mt-4 space-y-4">
                <FormField label="Source" htmlFor="model-source" error={fieldErrors.source}>
                  <SelectInput
                    id="model-source"
                    value={form.source}
                    onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
                  >
                    <option value="MANUAL">Manual</option>
                    <option value="API">API</option>
                    <option value="IMPORT">Import</option>
                  </SelectInput>
                </FormField>
                <FormField label="External provider" htmlFor="model-external-provider" error={fieldErrors.externalProvider}>
                  <TextInput
                    id="model-external-provider"
                    value={form.externalProvider}
                    onChange={(event) => setForm((current) => ({ ...current, externalProvider: event.target.value }))}
                    placeholder="Optional source system"
                  />
                </FormField>
                <FormField label="External ID" htmlFor="model-external-id" error={fieldErrors.externalId}>
                  <TextInput
                    id="model-external-id"
                    value={form.externalId}
                    onChange={(event) => setForm((current) => ({ ...current, externalId: event.target.value }))}
                    placeholder="Stable ID in the source system"
                  />
                </FormField>
              </div>
            </details>

            <label className="flex items-center gap-2 text-sm text-[var(--muted-strong)]">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Active model
            </label>

            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
              {editingId ? (
                <Button variant="ghost" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                disabled={saving || activeVendorCount === 0 || activeTypeCount === 0}
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create model'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </>
  )
}

function ModelTable({
  records,
  editingId,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  records: DeviceModelRecord[]
  editingId: string | null
  onEdit: (record: DeviceModelRecord) => void
  onToggleArchive: (record: DeviceModelRecord) => void
  onDelete: (record: DeviceModelRecord) => void
}) {
  return (
    <div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="w-full min-w-[940px] text-left text-sm">
        <caption className="sr-only">Device model catalog</caption>
        <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Model</th>
            <th className="px-3 py-2.5 font-semibold">Vendor</th>
            <th className="px-3 py-2.5 font-semibold">Device type</th>
            <th className="px-3 py-2.5 font-semibold">Platform</th>
            <th className="px-3 py-2.5 text-right font-semibold">Devices</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {records.map((record) => (
            <tr
              key={record.id}
              className={`${record.isActive ? '' : 'opacity-60'} ${editingId === record.id ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-muted)]'}`}
            >
              <td className="px-3 py-2.5">
                <Link href={`/models/${record.id}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--accent-light)]">
                  {record.model}
                </Link>
                <div className="mt-0.5 text-xs text-[var(--muted)]">{record.source}</div>
              </td>
              <td className="px-3 py-2.5 text-[var(--muted-strong)]">{record.vendor.name}</td>
              <td className="px-3 py-2.5 text-[var(--muted-strong)]">{record.deviceType.name}</td>
              <td className="px-3 py-2.5 text-[var(--muted-strong)]">{record.platform ?? '—'}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted-strong)]">{record.deviceCount}</td>
              <td className="px-3 py-2.5">
                <span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--muted-strong)]">
                  {record.isActive ? 'Active' : 'Archived'}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex justify-end gap-1">
                  <Link
                    href={`/models/${record.id}`}
                    className="inline-flex h-9 items-center rounded-md border border-transparent px-3 text-sm font-semibold text-[var(--muted-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)]"
                  >
                    View
                  </Link>
                  <Button variant="ghost" onClick={() => onEdit(record)}>Edit</Button>
                  <Button variant="ghost" onClick={() => onToggleArchive(record)}>
                    {record.isActive ? 'Archive' : 'Reactivate'}
                  </Button>
                  <Button variant="danger" onClick={() => onDelete(record)}>Delete</Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
