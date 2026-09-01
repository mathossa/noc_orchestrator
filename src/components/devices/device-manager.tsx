'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { DeviceFilterBar } from '@/components/devices/device-filter-bar'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { TechnicalStatusBadge, WorkflowStatusBadge } from '@/components/ui/status-badge'
import type { DeviceQueryMeta, DeviceQueryRecord } from '@/lib/device-query'
import type {
  DeviceFieldErrors,
  DeviceFirmwareReference,
  DeviceModelReference,
  DeviceRecord,
  DeviceReferenceData,
} from '@/lib/devices'

type ApiError = { error?: { message?: string; fields?: DeviceFieldErrors } }
type Payload = { data?: DeviceQueryRecord[]; meta?: DeviceQueryMeta } & ApiError

type FormState = {
  customerId: string
  siteId: string
  deviceModelId: string
  name: string
  hostname: string
  serialNumber: string
  managementAddress: string
  notes: string
  currentFirmwareReleaseId: string
  currentFirmwareObservedAt: string
  currentFirmwareSource: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

const EMPTY_REFERENCES: DeviceReferenceData = { customers: [], sites: [], models: [], firmwareReleases: [] }

function emptyForm(customerId = '', siteId = ''): FormState {
  return {
    customerId,
    siteId,
    deviceModelId: '',
    name: '',
    hostname: '',
    serialNumber: '',
    managementAddress: '',
    notes: '',
    currentFirmwareReleaseId: '',
    currentFirmwareObservedAt: '',
    currentFirmwareSource: 'MANUAL',
    source: 'MANUAL',
    externalProvider: '',
    externalId: '',
    isActive: true,
  }
}

function normalizePlatform(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function releaseMatchesModel(release: DeviceFirmwareReference, model: DeviceModelReference | undefined) {
  if (!model || release.vendorId !== model.vendor.id) return false
  return !model.platform || normalizePlatform(release.platform) === normalizePlatform(model.platform)
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function DeviceManager({
  initialCustomerId = '',
  initialSiteId = '',
}: {
  initialCustomerId?: string
  initialSiteId?: string
  initialModelId?: string
}) {
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const [records, setRecords] = useState<DeviceQueryRecord[]>([])
  const [references, setReferences] = useState<DeviceReferenceData>(EMPTY_REFERENCES)
  const [meta, setMeta] = useState<DeviceQueryMeta | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm(initialCustomerId, initialSiteId))
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<DeviceFieldErrors>({})

  const applyPayload = useCallback((payload: Payload) => {
    setRecords(payload.data ?? [])
    setMeta(payload.meta ?? null)
    setReferences(payload.meta ?? EMPTY_REFERENCES)
  }, [])

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/devices${queryString ? `?${queryString}` : ''}`, { cache: 'no-store' })
    const payload = (await response.json()) as Payload
    if (!response.ok) throw new Error(payload.error?.message ?? 'Devices could not be loaded.')
    return payload
  }, [queryString])

  useEffect(() => {
    let cancelled = false
    void load()
      .then((payload) => {
        if (!cancelled) applyPayload(payload)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Devices could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyPayload, load])

  const reload = useCallback(async () => applyPayload(await load()), [applyPayload, load])

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm(initialCustomerId, initialSiteId))
    setFieldErrors({})
    setError(null)
  }

  function closeForm() {
    resetForm()
    setFormOpen(false)
  }

  function beginAdd() {
    resetForm()
    setMessage(null)
    setFormOpen(true)
  }

  function beginEdit(record: DeviceRecord) {
    setEditingId(record.id)
    setFormOpen(true)
    setForm({
      customerId: record.customerId,
      siteId: record.siteId ?? '',
      deviceModelId: record.deviceModelId,
      name: record.name,
      hostname: record.hostname ?? '',
      serialNumber: record.serialNumber ?? '',
      managementAddress: record.managementAddress ?? '',
      notes: record.notes ?? '',
      currentFirmwareReleaseId: record.currentFirmwareReleaseId ?? '',
      currentFirmwareObservedAt: toLocalDateTimeInput(record.currentFirmwareObservedAt),
      currentFirmwareSource: record.currentFirmwareSource,
      source: record.source,
      externalProvider: record.externalProvider ?? '',
      externalId: record.externalId ?? '',
      isActive: record.isActive,
    })
    setFieldErrors({})
    setError(null)
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function changeCustomer(customerId: string) {
    const siteStillMatches = references.sites.some((site) => site.id === form.siteId && site.customerId === customerId)
    setForm({ ...form, customerId, siteId: siteStillMatches ? form.siteId : '' })
  }

  function changeModel(deviceModelId: string) {
    const model = references.models.find((item) => item.id === deviceModelId)
    const selectedRelease = references.firmwareReleases.find((item) => item.id === form.currentFirmwareReleaseId)
    const keepRelease = selectedRelease ? releaseMatchesModel(selectedRelease, model) : true
    setForm({
      ...form,
      deviceModelId,
      currentFirmwareReleaseId: keepRelease ? form.currentFirmwareReleaseId : '',
      currentFirmwareObservedAt: keepRelease ? form.currentFirmwareObservedAt : '',
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})

    try {
      const observedAt = form.currentFirmwareObservedAt
        ? new Date(form.currentFirmwareObservedAt).toISOString()
        : null
      const response = await fetch(editingId ? `/api/v1/devices/${editingId}` : '/api/v1/devices', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          siteId: form.siteId || null,
          currentFirmwareReleaseId: form.currentFirmwareReleaseId || null,
          currentFirmwareObservedAt: observedAt,
        }),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'Device could not be saved.')
      }
      setMessage(editingId ? 'Device updated.' : 'Device created.')
      resetForm()
      setFormOpen(false)
      await reload()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Device could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(record: DeviceRecord) {
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/devices/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Device could not be updated.')
      return
    }
    setMessage(record.isActive ? 'Device archived.' : 'Device reactivated.')
    await reload()
  }

  async function remove(record: DeviceRecord) {
    if (!window.confirm(`Permanently delete device ${record.name}? Devices with lifecycle, policy, or audit history cannot be deleted.`)) return
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/devices/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Device could not be deleted.')
      return
    }
    if (editingId === record.id) closeForm()
    setMessage('Device deleted.')
    await reload()
  }

  const selectedModel = references.models.find((model) => model.id === form.deviceModelId)
  const selectedCustomer = references.customers.find((customer) => customer.id === form.customerId)
  const selectedSite = references.sites.find((site) => site.id === form.siteId)
  const effectiveFormContract = selectedSite?.contractType ?? selectedCustomer?.contractType ?? null
  const effectiveFormContractSource = selectedSite?.contractType
    ? 'Site override'
    : selectedCustomer?.contractType
      ? 'Customer default'
      : 'No contract'
  const formSites = references.sites.filter((site) => site.customerId === form.customerId)
  const formReleases = references.firmwareReleases.filter((release) => releaseMatchesModel(release, selectedModel))

  const pageGroups = useMemo(() => {
    if (!meta || meta.query.groupBy === 'none') return [{ key: 'all', label: null as string | null, records }]
    const groups = new Map<string, { key: string; label: string | null; records: DeviceQueryRecord[] }>()
    for (const record of records) {
      const key = record.groupKey ?? 'none'
      const current = groups.get(key)
      if (current) current.records.push(record)
      else groups.set(key, { key, label: record.groupLabel, records: [record] })
    }
    return [...groups.values()]
  }, [meta, records])

  function pageHref(page: number) {
    const params = new URLSearchParams(queryString)
    if (page <= 1) params.delete('page')
    else params.set('page', String(page))
    const serialized = params.toString()
    return serialized ? `/devices?${serialized}` : '/devices'
  }

  return (
    <>
      <PageHeader
        eyebrow="Recorded inventory"
        title="Devices"
        description="Filter and group recorded inventory across customer, site, vendor, model, type, effective contract, firmware state, workflow, and provenance."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/firmware" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Firmware catalog</Link>
            <Button type="button" variant="primary" onClick={formOpen ? closeForm : beginAdd}>{formOpen ? 'Close device form' : 'Add device'}</Button>
          </div>
        }
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <section className="mb-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <button
          type="button"
          aria-expanded={formOpen}
          onClick={formOpen ? closeForm : beginAdd}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-raised)] sm:px-5"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--accent-light)]">Manual inventory</span>
            <span className="mt-1 block text-sm font-semibold text-[var(--foreground)]">{editingId ? 'Edit device' : 'Add device'}</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
              {formOpen
                ? 'Customer, model, firmware and synchronization fields are isolated from the inventory workspace below.'
                : 'Expand only when you need to add a manually recorded device; inventory browsing stays the primary workspace.'}
            </span>
          </span>
          <span className="shrink-0 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-strong)]">
            {formOpen ? 'Collapse' : 'Expand'}
          </span>
        </button>

        {formOpen ? (
          <form onSubmit={save} className="border-t border-[var(--border)] p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{editingId ? 'Edit device record' : 'New manual device'}</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Manual devices need only a customer, model, and device name. Site, management address, current firmware, and integration identity can remain unknown.</p>
              </div>
              <Button type="button" variant="ghost" onClick={closeForm}>{editingId ? 'Cancel edit' : 'Cancel'}</Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FormField label="Customer" htmlFor="device-customer" error={fieldErrors.customerId}>
                <SelectInput id="device-customer" value={form.customerId} onChange={(event) => changeCustomer(event.target.value)} required>
                  <option value="">Select customer</option>
                  {references.customers.map((customer) => <option key={customer.id} value={customer.id} disabled={!customer.isActive && customer.id !== form.customerId}>{customer.name}{customer.isActive ? '' : ' (archived)'}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Site" htmlFor="device-site" description="Optional; only sites belonging to the selected customer are shown." error={fieldErrors.siteId}>
                <SelectInput id="device-site" value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })} disabled={!form.customerId}>
                  <option value="">No site / unassigned</option>
                  {formSites.map((site) => <option key={site.id} value={site.id} disabled={!site.isActive && site.id !== form.siteId}>{site.name}{site.code ? ` (${site.code})` : ''}{site.contractType ? ` · ${site.contractType.name}` : ''}{site.isActive ? '' : ' — archived'}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Effective contract" htmlFor="device-effective-contract" description={effectiveFormContractSource}>
                <div id="device-effective-contract" className="flex min-h-10 items-center rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--muted-strong)]">
                  {effectiveFormContract?.name ?? 'No contract assigned'}
                </div>
              </FormField>
              <FormField label="Device model" htmlFor="device-model" error={fieldErrors.deviceModelId}>
                <SelectInput id="device-model" value={form.deviceModelId} onChange={(event) => changeModel(event.target.value)} required>
                  <option value="">Select model</option>
                  {references.models.map((model) => <option key={model.id} value={model.id} disabled={!model.isActive && model.id !== form.deviceModelId}>{model.vendor.name} · {model.model} · {model.deviceType.name}{model.isActive ? '' : ' (archived)'}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Device name" htmlFor="device-name" description="Customer-scoped inventory name." error={fieldErrors.name}>
                <TextInput id="device-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="HQ-SW-01" required />
              </FormField>
              <FormField label="Hostname" htmlFor="device-hostname" error={fieldErrors.hostname}>
                <TextInput id="device-hostname" value={form.hostname} onChange={(event) => setForm({ ...form, hostname: event.target.value })} placeholder="hq-sw-01.example.local" />
              </FormField>
              <FormField label="Management address" htmlFor="device-management" description="Recorded address only; reachability is not tested." error={fieldErrors.managementAddress}>
                <TextInput id="device-management" value={form.managementAddress} onChange={(event) => setForm({ ...form, managementAddress: event.target.value })} placeholder="10.10.10.10" />
              </FormField>
              <FormField label="Serial number" htmlFor="device-serial" error={fieldErrors.serialNumber}>
                <TextInput id="device-serial" value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} />
              </FormField>
              <FormField label="Current firmware" htmlFor="device-current-firmware" description={form.deviceModelId ? 'Only catalog releases compatible with the selected model are shown.' : 'Select a model first.'} error={fieldErrors.currentFirmwareReleaseId}>
                <SelectInput id="device-current-firmware" value={form.currentFirmwareReleaseId} onChange={(event) => setForm({ ...form, currentFirmwareReleaseId: event.target.value, currentFirmwareObservedAt: event.target.value ? form.currentFirmwareObservedAt : '' })} disabled={!form.deviceModelId}>
                  <option value="">Unknown / not recorded</option>
                  {formReleases.map((release) => <option key={release.id} value={release.id}>{release.version}{release.firmwareTrain ? ` · ${release.firmwareTrain.name}` : ''} · {release.status}{release.isActive ? '' : ' · archived'}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Firmware source" htmlFor="device-firmware-source" error={fieldErrors.currentFirmwareSource}>
                <SelectInput id="device-firmware-source" value={form.currentFirmwareSource} onChange={(event) => setForm({ ...form, currentFirmwareSource: event.target.value })} disabled={!form.currentFirmwareReleaseId}>
                  <option value="MANUAL">Manual</option><option value="API">API</option><option value="IMPORT">Import</option>
                </SelectInput>
              </FormField>
              <FormField label="Observed / reported at" htmlFor="device-firmware-observed" description="Optional timestamp for the recorded firmware state." error={fieldErrors.currentFirmwareObservedAt}>
                <TextInput id="device-firmware-observed" type="datetime-local" value={form.currentFirmwareObservedAt} onChange={(event) => setForm({ ...form, currentFirmwareObservedAt: event.target.value })} disabled={!form.currentFirmwareReleaseId} />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Notes" htmlFor="device-notes" error={fieldErrors.notes}>
                  <TextArea id="device-notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Firmware-lifecycle relevant inventory notes…" />
                </FormField>
              </div>
            </div>

            <details className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
              <summary className="cursor-pointer text-sm font-semibold">Advanced / synchronization</summary>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <FormField label="Inventory source" htmlFor="device-source" error={fieldErrors.source}>
                  <SelectInput id="device-source" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}><option value="MANUAL">MANUAL</option><option value="API">API</option><option value="IMPORT">IMPORT</option></SelectInput>
                </FormField>
                <FormField label="External provider" htmlFor="device-provider" error={fieldErrors.externalProvider}>
                  <TextInput id="device-provider" value={form.externalProvider} onChange={(event) => setForm({ ...form, externalProvider: event.target.value })} placeholder="Optional" />
                </FormField>
                <FormField label="External ID" htmlFor="device-external-id" error={fieldErrors.externalId}>
                  <TextInput id="device-external-id" value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} placeholder="Optional" />
                </FormField>
              </div>
            </details>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save device' : 'Add device'}</Button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Device inventory</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Browse, filter and group recorded devices. Manual entry is kept separate above so the inventory remains the primary workspace.</p>
        </div>
        {meta ? <DeviceFilterBar meta={meta} /> : null}

        {meta ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
            <span>{meta.pagination.total} matching device{meta.pagination.total === 1 ? '' : 's'} · {meta.pagination.inventoryTotal} total inventory records</span>
            {meta.query.groupBy !== 'none' ? <span>{meta.groups.length} group{meta.groups.length === 1 ? '' : 's'} across the full filtered result</span> : null}
          </div>
        ) : null}

        {loading ? (
          <LoadingState title="Loading devices" description="Applying backend inventory filters and firmware state resolution…" />
        ) : meta?.pagination.inventoryTotal === 0 ? (
          <EmptyState title="No devices yet" description="Add a manual device to start the inventory." />
        ) : records.length === 0 ? (
          <EmptyState title="No devices match" description="The inventory contains devices, but none match the current URL-backed filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1540px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr><th className="px-4 py-3">Device</th><th className="px-4 py-3">Customer / site</th><th className="px-4 py-3">Model / type</th><th className="px-4 py-3">Current</th><th className="px-4 py-3">Desired</th><th className="px-4 py-3">Technical</th><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">Contract</th><th className="px-4 py-3">Source</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pageGroups.map((group) => (
                  <Fragment key={group.key}>
                    {group.label ? <tr className="bg-[var(--surface-raised)]"><td colSpan={10} className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted-strong)]">{group.label} · {meta?.groups.find((item) => item.key === group.key)?.count ?? group.records.length} matching</td></tr> : null}
                    {group.records.map((record) => (
                      <tr key={record.id} className={record.isActive ? '' : 'opacity-60'}>
                        <td className="px-4 py-3"><Link href={`/devices/${record.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{record.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.hostname ?? record.managementAddress ?? 'No hostname/address'}</div></td>
                        <td className="px-4 py-3"><Link href={`/customers/${record.customer.id}`} className="font-medium hover:text-[var(--accent-light)]">{record.customer.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.site ? record.site.name : 'No site'}</div></td>
                        <td className="px-4 py-3"><div>{record.deviceModel.vendor.name} · {record.deviceModel.model}</div><div className="mt-1 text-xs text-[var(--muted)]">{record.deviceModel.deviceType.name}{record.deviceModel.platform ? ` · ${record.deviceModel.platform}` : ''}</div></td>
                        <td className="px-4 py-3">{record.currentFirmwareRelease ? <><Link href={`/firmware/${record.currentFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{record.currentFirmwareRelease.version}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.currentFirmwareSource}{record.currentFirmwareObservedAt ? ` · ${new Date(record.currentFirmwareObservedAt).toLocaleDateString()}` : ' · age unknown'}</div></> : <span className="text-[var(--muted)]">Unknown</span>}</td>
                        <td className="px-4 py-3">{record.desiredFirmwareRelease ? <Link href={`/firmware/${record.desiredFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{record.desiredFirmwareRelease.version}</Link> : <span className="text-[var(--muted)]">No policy</span>}</td>
                        <td className="px-4 py-3"><TechnicalStatusBadge state={record.technicalState} /></td>
                        <td className="px-4 py-3">{record.lifecycle ? <WorkflowStatusBadge state={record.lifecycle.state} /> : <span className="text-xs text-[var(--muted)]">No decision</span>}</td>
                        <td className="px-4 py-3"><div>{record.effectiveContractType?.name ?? '—'}</div><div className="mt-1 text-xs text-[var(--muted)]">{record.contractSource === 'SITE' ? 'Site override' : record.contractSource === 'CUSTOMER' ? 'Customer default' : 'No contract'}</div></td>
                        <td className="px-4 py-3 text-xs">{record.source}<div className="mt-1 text-[var(--muted)]">{record.isActive ? 'Active' : 'Archived'}</div></td>
                        <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => beginEdit(record)}>Edit</Button><Button variant="ghost" onClick={() => void toggleArchive(record)}>{record.isActive ? 'Archive' : 'Reactivate'}</Button><Button variant="danger" onClick={() => void remove(record)}>Delete</Button></div></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.pagination.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-sm">
            <div className="text-xs text-[var(--muted)]">Page {meta.pagination.page} of {meta.pagination.totalPages} · up to {meta.pagination.pageSize} records per page</div>
            <div className="flex gap-2">
              <Link href={pageHref(Math.max(1, meta.pagination.page - 1))} aria-disabled={meta.pagination.page <= 1} className={`rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold ${meta.pagination.page <= 1 ? 'pointer-events-none opacity-40' : 'hover:bg-[var(--surface-raised)]'}`}>Previous</Link>
              <Link href={pageHref(Math.min(meta.pagination.totalPages, meta.pagination.page + 1))} aria-disabled={meta.pagination.page >= meta.pagination.totalPages} className={`rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold ${meta.pagination.page >= meta.pagination.totalPages ? 'pointer-events-none opacity-40' : 'hover:bg-[var(--surface-raised)]'}`}>Next</Link>
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
