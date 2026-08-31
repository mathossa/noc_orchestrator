'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import type {
  DeviceFieldErrors,
  DeviceFirmwareReference,
  DeviceModelReference,
  DeviceRecord,
  DeviceReferenceData,
} from '@/lib/devices'

type ApiError = { error?: { message?: string; fields?: DeviceFieldErrors } }
type Payload = { data?: DeviceRecord[]; meta?: DeviceReferenceData } & ApiError

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
}) {
  const [records, setRecords] = useState<DeviceRecord[]>([])
  const [references, setReferences] = useState<DeviceReferenceData>({ customers: [], sites: [], models: [], firmwareReleases: [] })
  const [form, setForm] = useState<FormState>(() => emptyForm(initialCustomerId, initialSiteId))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<DeviceFieldErrors>({})
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState(initialCustomerId)
  const [siteFilter, setSiteFilter] = useState(initialSiteId)
  const [modelFilter, setModelFilter] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('active')

  const applyPayload = useCallback((payload: Payload) => {
    setRecords(payload.data ?? [])
    setReferences(payload.meta ?? { customers: [], sites: [], models: [], firmwareReleases: [] })
  }, [])

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/devices', { cache: 'no-store' })
    const payload = (await response.json()) as Payload
    if (!response.ok) throw new Error(payload.error?.message ?? 'Devices could not be loaded.')
    return payload
  }, [])

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

  function beginEdit(record: DeviceRecord) {
    setEditingId(record.id)
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
    if (editingId === record.id) resetForm()
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
  const filterSites = references.sites.filter((site) => !customerFilter || site.customerId === customerFilter)

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return records.filter((record) => {
      if (archiveFilter === 'active' && !record.isActive) return false
      if (archiveFilter === 'archived' && record.isActive) return false
      if (customerFilter && record.customerId !== customerFilter) return false
      if (siteFilter && record.siteId !== siteFilter) return false
      if (modelFilter && record.deviceModelId !== modelFilter) return false
      if (!needle) return true
      return [
        record.name,
        record.hostname ?? '',
        record.serialNumber ?? '',
        record.managementAddress ?? '',
        record.customer.name,
        record.site?.name ?? '',
        record.deviceModel.vendor.name,
        record.deviceModel.model,
        record.currentFirmwareRelease?.version ?? '',
        record.effectiveContractType?.name ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase('en-US')
        .includes(needle)
    })
  }, [records, search, archiveFilter, customerFilter, siteFilter, modelFilter])

  return (
    <>
      <PageHeader
        eyebrow="Recorded inventory"
        title="Devices"
        description="Manual device inventory and recorded firmware state. No live SSH, SNMP, API polling, or generic monitoring is performed here."
        actions={<Link href="/firmware" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Firmware catalog</Link>}
      />

      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <form onSubmit={save} className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{editingId ? 'Edit device' : 'Add device'}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Manual devices need only a customer, model, and device name. Site, management address, current firmware, and integration identity can remain unknown.</p>
          </div>
          {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>Cancel edit</Button> : null}
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

        <div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save device' : 'Add device'}</Button></div>
      </form>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-2 xl:grid-cols-5">
          <TextInput type="search" aria-label="Search devices" placeholder="Name, hostname, serial, address, firmware…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <SelectInput aria-label="Filter devices by customer" value={customerFilter} onChange={(event) => { const customerId = event.target.value; setCustomerFilter(customerId); if (siteFilter && !references.sites.some((site) => site.id === siteFilter && site.customerId === customerId)) setSiteFilter('') }}><option value="">All customers</option>{references.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by site" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">All sites</option>{filterSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by model" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}><option value="">All models</option>{references.models.map((model) => <option key={model.id} value={model.id}>{model.vendor.name} · {model.model}</option>)}</SelectInput>
          <SelectInput aria-label="Filter devices by archive state" value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></SelectInput>
        </div>

        {loading ? <LoadingState title="Loading devices" description="Reading recorded inventory and firmware state…" /> : filteredRecords.length === 0 ? <EmptyState title="No devices match" description="Add a manual device or adjust the current filters." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr><th className="px-4 py-3">Device</th><th className="px-4 py-3">Customer / site</th><th className="px-4 py-3">Model / type</th><th className="px-4 py-3">Current firmware</th><th className="px-4 py-3">Contract</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">State</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className={record.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3"><Link href={`/devices/${record.id}`} className="font-semibold text-[var(--accent-light)] hover:underline">{record.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.hostname ?? record.managementAddress ?? 'No hostname/address'}</div></td>
                    <td className="px-4 py-3"><Link href={`/customers/${record.customer.id}`} className="font-medium hover:text-[var(--accent-light)]">{record.customer.name}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.site ? record.site.name : 'No site'}</div></td>
                    <td className="px-4 py-3"><div>{record.deviceModel.vendor.name} · {record.deviceModel.model}</div><div className="mt-1 text-xs text-[var(--muted)]">{record.deviceModel.deviceType.name}{record.deviceModel.platform ? ` · ${record.deviceModel.platform}` : ''}</div></td>
                    <td className="px-4 py-3">{record.currentFirmwareRelease ? <><Link href={`/firmware/${record.currentFirmwareRelease.id}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">{record.currentFirmwareRelease.version}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.currentFirmwareSource}{record.currentFirmwareObservedAt ? ` · ${new Date(record.currentFirmwareObservedAt).toLocaleDateString()}` : ' · age unknown'}</div></> : <span className="text-[var(--muted)]">Unknown</span>}</td>
                    <td className="px-4 py-3"><div>{record.effectiveContractType?.name ?? '—'}</div><div className="mt-1 text-xs text-[var(--muted)]">{record.contractSource === 'SITE' ? 'Site override' : record.contractSource === 'CUSTOMER' ? 'Customer default' : 'No contract'}</div></td>
                    <td className="px-4 py-3 text-xs">{record.source}</td>
                    <td className="px-4 py-3 text-xs">{record.isActive ? 'Active' : 'Archived'}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => beginEdit(record)}>Edit</Button><Button variant="ghost" onClick={() => void toggleArchive(record)}>{record.isActive ? 'Archive' : 'Reactivate'}</Button><Button variant="danger" onClick={() => void remove(record)}>Delete</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
