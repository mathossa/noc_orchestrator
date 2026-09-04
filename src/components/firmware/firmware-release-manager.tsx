'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextArea, TextInput } from '@/components/ui/form-controls'
import { EmptyState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  firmwareCatalogStates,
  firmwarePolicyEligibilities,
  firmwareVariantEquivalenceModes,
  type FirmwareReleaseFieldErrors,
  type FirmwareReleaseRecord,
  type FirmwareReleaseReference,
  type FirmwareReleaseTrainReference,
} from '@/lib/firmware-releases'

type ApiError = { error?: { message?: string; fields?: FirmwareReleaseFieldErrors } }
type CatalogPayload = {
  data?: FirmwareReleaseRecord[]
  meta?: { vendors?: FirmwareReleaseReference[]; trains?: FirmwareReleaseTrainReference[] }
} & ApiError

type FormState = {
  vendorId: string
  firmwareTrainId: string
  platform: string
  version: string
  logicalVersion: string
  variant: string
  imageCode: string
  catalogState: string
  policyEligibility: string
  variantEquivalence: string
  filename: string
  sha256: string
  fileSizeBytes: string
  releaseNotesUrl: string
  releasedAt: string
  notes: string
  source: string
  externalProvider: string
  externalId: string
  isActive: boolean
}

const initialForm: FormState = {
  vendorId: '',
  firmwareTrainId: '',
  platform: '',
  version: '',
  logicalVersion: '',
  variant: '',
  imageCode: '',
  catalogState: 'VERIFIED',
  policyEligibility: 'NOT_EVALUATED',
  variantEquivalence: 'EXACT_ONLY',
  filename: '',
  sha256: '',
  fileSizeBytes: '',
  releaseNotesUrl: '',
  releasedAt: '',
  notes: '',
  source: 'MANUAL',
  externalProvider: '',
  externalId: '',
  isActive: true,
}

function formatBytes(value: string | null) {
  if (!value) return '—'
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return `${value} bytes`
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

function dateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : ''
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function FirmwareReleaseManager() {
  const [records, setRecords] = useState<FirmwareReleaseRecord[]>([])
  const [vendors, setVendors] = useState<FirmwareReleaseReference[]>([])
  const [trains, setTrains] = useState<FirmwareReleaseTrainReference[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FirmwareReleaseFieldErrors>({})
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [trainFilter, setTrainFilter] = useState('')
  const [catalogStateFilter, setCatalogStateFilter] = useState('')
  const [eligibilityFilter, setEligibilityFilter] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('active')

  async function fetchCatalog() {
    const response = await fetch('/api/v1/firmware-releases', { cache: 'no-store' })
    const payload = (await response.json()) as CatalogPayload
    if (!response.ok) throw new Error(payload.error?.message ?? 'Firmware catalog could not be loaded.')
    return { records: payload.data ?? [], vendors: payload.meta?.vendors ?? [], trains: payload.meta?.trains ?? [] }
  }

  useEffect(() => {
    let cancelled = false
    void fetchCatalog()
      .then((payload) => {
        if (cancelled) return
        setRecords(payload.records)
        setVendors(payload.vendors)
        setTrains(payload.trains)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Firmware catalog could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    const payload = await fetchCatalog()
    setRecords(payload.records)
    setVendors(payload.vendors)
    setTrains(payload.trains)
  }

  function resetForm() {
    setForm(initialForm)
    setEditingId(null)
    setFieldErrors({})
  }

  function beginEdit(record: FirmwareReleaseRecord) {
    setEditingId(record.id)
    setForm({
      vendorId: record.vendorId,
      firmwareTrainId: record.firmwareTrainId ?? '',
      platform: record.platform,
      version: record.version,
      logicalVersion: record.logicalVersion,
      variant: record.variant ?? '',
      imageCode: record.imageCode ?? '',
      catalogState: record.catalogState,
      policyEligibility: record.policyEligibility,
      variantEquivalence: record.variantEquivalence,
      filename: record.filename ?? '',
      sha256: record.sha256 ?? '',
      fileSizeBytes: record.fileSizeBytes ?? '',
      releaseNotesUrl: record.releaseNotesUrl ?? '',
      releasedAt: dateInputValue(record.releasedAt),
      notes: record.notes ?? '',
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    setFieldErrors({})
    try {
      const response = await fetch(editingId ? `/api/v1/firmware-releases/${editingId}` : '/api/v1/firmware-releases', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json()) as ApiError
      if (!response.ok) {
        setFieldErrors(payload.error?.fields ?? {})
        throw new Error(payload.error?.message ?? 'Firmware release could not be saved.')
      }
      setMessage(editingId ? 'Firmware release updated.' : 'Firmware release added to the catalog.')
      resetForm()
      await reload()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Firmware release could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(record: FirmwareReleaseRecord) {
    setError(null)
    setMessage(null)
    const response = await fetch(`/api/v1/firmware-releases/${record.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !record.isActive }),
    })
    const payload = (await response.json()) as ApiError
    if (!response.ok) {
      setError(payload.error?.message ?? 'Firmware release could not be updated.')
      return
    }
    setMessage(record.isActive ? 'Firmware release archived.' : 'Firmware release reactivated.')
    await reload()
  }

  async function remove(record: FirmwareReleaseRecord) {
    if (!window.confirm(`Permanently delete ${record.vendor.name} ${record.platform} ${record.version}? Referenced releases cannot be deleted.`)) return
    const response = await fetch(`/api/v1/firmware-releases/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = (await response.json()) as ApiError
      setError(payload.error?.message ?? 'Firmware release could not be deleted.')
      return
    }
    setMessage('Firmware release deleted.')
    if (editingId === record.id) resetForm()
    await reload()
  }

  const trainOptions = useMemo(
    () => trains.filter((train) => train.vendorId === form.vendorId && normalized(train.platform) === normalized(form.platform)),
    [trains, form.vendorId, form.platform],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('en-US')
    return records.filter((record) => {
      if (vendorFilter && record.vendorId !== vendorFilter) return false
      if (trainFilter === 'none' && record.firmwareTrainId) return false
      if (trainFilter && trainFilter !== 'none' && record.firmwareTrainId !== trainFilter) return false
      if (catalogStateFilter && record.catalogState !== catalogStateFilter) return false
      if (eligibilityFilter && record.policyEligibility !== eligibilityFilter) return false
      if (archiveFilter === 'active' && !record.isActive) return false
      if (archiveFilter === 'archived' && record.isActive) return false
      if (!needle) return true
      return [
        record.vendor.name,
        record.platform,
        record.firmwareTrain?.name ?? '',
        record.version,
        record.logicalVersion,
        record.variant ?? '',
        record.imageCode ?? '',
        record.filename ?? '',
      ].join(' ').toLocaleLowerCase('en-US').includes(needle)
    })
  }, [records, search, vendorFilter, trainFilter, catalogStateFilter, eligibilityFilter, archiveFilter])

  return (
    <>
      <PageHeader
        eyebrow="Firmware catalog"
        title="Firmware releases"
        description="Keep exact vendor builds intact while grouping equivalent release identities. Catalog verification and policy eligibility are independent decisions."
        actions={
          <Link href="/firmware/trains" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">
            Manage release trains
          </Link>
        }
      />

      <div className="mb-4 rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-light)]">
        Observed or verified firmware does not become desired automatically. Set policy eligibility explicitly to Allowed or Preferred before policy can select it.
      </div>
      {message ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]" role="status">{message}</div> : null}
      {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <form onSubmit={save} className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{editingId ? 'Edit firmware release' : 'Add firmware release'}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Exact version is immutable evidence. Leave logical release, variant, or image code empty to use the deterministic parser where supported.</p>
          </div>
          {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>Cancel edit</Button> : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Vendor" htmlFor="firmware-vendor" error={fieldErrors.vendorId}>
            <SelectInput id="firmware-vendor" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value, firmwareTrainId: '' })} required>
              <option value="">Select vendor</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.isActive ? '' : ' (archived)'}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Platform / family" htmlFor="firmware-platform" error={fieldErrors.platform}>
            <TextInput id="firmware-platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value, firmwareTrainId: '' })} placeholder="AOS-S" required />
          </FormField>
          <FormField label="Release train" htmlFor="firmware-train" error={fieldErrors.firmwareTrainId} description="Explicit membership only; never inferred from version.">
            <SelectInput id="firmware-train" value={form.firmwareTrainId} onChange={(e) => setForm({ ...form, firmwareTrainId: e.target.value })}>
              <option value="">No train</option>
              {trainOptions.map((train) => <option key={train.id} value={train.id}>{train.name}{train.isActive ? '' : ' (archived)'}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Exact vendor version" htmlFor="firmware-version" error={fieldErrors.version}>
            <TextInput id="firmware-version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="WC.16.11.0002" required />
          </FormField>

          <FormField label="Logical / base release" htmlFor="firmware-logical" error={fieldErrors.logicalVersion} description="Optional override; exact version is never changed.">
            <TextInput id="firmware-logical" value={form.logicalVersion} onChange={(e) => setForm({ ...form, logicalVersion: e.target.value })} placeholder="16.11.0002" />
          </FormField>
          <FormField label="Variant / rebuild" htmlFor="firmware-variant" error={fieldErrors.variant}>
            <TextInput id="firmware-variant" value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} placeholder="a" />
          </FormField>
          <FormField label="Image code" htmlFor="firmware-image" error={fieldErrors.imageCode} description="For example WC, YA, YB.">
            <TextInput id="firmware-image" value={form.imageCode} onChange={(e) => setForm({ ...form, imageCode: e.target.value })} placeholder="WC" />
          </FormField>
          <FormField label="Variant equivalence" htmlFor="firmware-equivalence" error={fieldErrors.variantEquivalence}>
            <SelectInput id="firmware-equivalence" value={form.variantEquivalence} onChange={(e) => setForm({ ...form, variantEquivalence: e.target.value })}>
              {firmwareVariantEquivalenceModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </SelectInput>
          </FormField>

          <FormField label="Catalog state" htmlFor="firmware-catalog-state" error={fieldErrors.catalogState}>
            <SelectInput
              id="firmware-catalog-state"
              value={form.catalogState}
              onChange={(e) => {
                const catalogState = e.target.value
                setForm({
                  ...form,
                  catalogState,
                  policyEligibility: catalogState === 'BLOCKED' || catalogState === 'WITHDRAWN' ? 'DISALLOWED' : form.policyEligibility,
                })
              }}
            >
              {firmwareCatalogStates.map((state) => <option key={state} value={state}>{state}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Policy eligibility" htmlFor="firmware-policy-eligibility" error={fieldErrors.policyEligibility} description="Observed/verified does not imply allowed.">
            <SelectInput
              id="firmware-policy-eligibility"
              value={form.policyEligibility}
              disabled={form.catalogState === 'BLOCKED' || form.catalogState === 'WITHDRAWN'}
              onChange={(e) => setForm({ ...form, policyEligibility: e.target.value })}
            >
              {firmwarePolicyEligibilities.map((state) => <option key={state} value={state}>{state}</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Filename" htmlFor="firmware-filename" error={fieldErrors.filename}>
            <TextInput id="firmware-filename" value={form.filename} onChange={(e) => setForm({ ...form, filename: e.target.value })} />
          </FormField>
          <FormField label="Release date" htmlFor="firmware-date" error={fieldErrors.releasedAt}>
            <TextInput id="firmware-date" type="date" value={form.releasedAt} onChange={(e) => setForm({ ...form, releasedAt: e.target.value })} />
          </FormField>

          <FormField label="File size (bytes)" htmlFor="firmware-size" error={fieldErrors.fileSizeBytes}>
            <TextInput id="firmware-size" inputMode="numeric" value={form.fileSizeBytes} onChange={(e) => setForm({ ...form, fileSizeBytes: e.target.value })} />
          </FormField>
          <FormField label="Release notes URL" htmlFor="firmware-release-notes" error={fieldErrors.releaseNotesUrl}>
            <TextInput id="firmware-release-notes" type="url" value={form.releaseNotesUrl} onChange={(e) => setForm({ ...form, releaseNotesUrl: e.target.value })} />
          </FormField>
          <FormField label="SHA256" htmlFor="firmware-sha" error={fieldErrors.sha256}>
            <TextInput id="firmware-sha" className="font-mono text-xs" value={form.sha256} onChange={(e) => setForm({ ...form, sha256: e.target.value })} />
          </FormField>
          <FormField label="Source" htmlFor="firmware-source" error={fieldErrors.source}>
            <SelectInput id="firmware-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="MANUAL">MANUAL</option><option value="API">API</option><option value="IMPORT">IMPORT</option>
            </SelectInput>
          </FormField>
          <FormField label="External provider" htmlFor="firmware-provider" error={fieldErrors.externalProvider}>
            <TextInput id="firmware-provider" value={form.externalProvider} onChange={(e) => setForm({ ...form, externalProvider: e.target.value })} placeholder="Optional" />
          </FormField>
          <FormField label="External ID" htmlFor="firmware-external-id" error={fieldErrors.externalId}>
            <TextInput id="firmware-external-id" value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} placeholder="Optional" />
          </FormField>
          <div className="md:col-span-2 xl:col-span-4">
            <FormField label="Notes" htmlFor="firmware-notes" error={fieldErrors.notes}>
              <TextArea id="firmware-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FormField>
          </div>
        </div>
        <div className="mt-4 flex justify-end"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save release' : 'Add release'}</Button></div>
      </form>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-2 xl:grid-cols-6">
          <TextInput aria-label="Search firmware releases" type="search" placeholder="Search exact/base release, image, vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectInput aria-label="Filter by vendor" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}><option value="">All vendors</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</SelectInput>
          <SelectInput aria-label="Filter by train" value={trainFilter} onChange={(e) => setTrainFilter(e.target.value)}><option value="">All trains</option><option value="none">No train</option>{trains.map((train) => <option key={train.id} value={train.id}>{train.name} · {train.platform}</option>)}</SelectInput>
          <SelectInput aria-label="Filter by catalog state" value={catalogStateFilter} onChange={(e) => setCatalogStateFilter(e.target.value)}><option value="">All catalog states</option>{firmwareCatalogStates.map((state) => <option key={state}>{state}</option>)}</SelectInput>
          <SelectInput aria-label="Filter by policy eligibility" value={eligibilityFilter} onChange={(e) => setEligibilityFilter(e.target.value)}><option value="">All policy eligibility</option>{firmwarePolicyEligibilities.map((state) => <option key={state}>{state}</option>)}</SelectInput>
          <SelectInput aria-label="Filter by archive state" value={archiveFilter} onChange={(e) => setArchiveFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></SelectInput>
        </div>

        {loading ? <LoadingState title="Loading firmware catalog" /> : filtered.length === 0 ? <EmptyState title="No firmware releases match" description="Adjust filters or add a release to the catalog." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr><th className="px-4 py-3">Exact release</th><th className="px-4 py-3">Logical group</th><th className="px-4 py-3">Vendor / platform</th><th className="px-4 py-3">Train</th><th className="px-4 py-3">Catalog</th><th className="px-4 py-3">Policy</th><th className="px-4 py-3">File</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((record) => (
                  <tr key={record.id} className={record.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3"><Link className="font-semibold text-[var(--accent-light)] hover:underline" href={`/firmware/${record.id}`}>{record.version}</Link><div className="mt-1 text-xs text-[var(--muted)]">{record.imageCode ? `Image ${record.imageCode}` : record.variant ? `Variant ${record.variant}` : 'Exact release'}</div></td>
                    <td className="px-4 py-3"><div className="font-mono text-xs">{record.logicalVersion}</div><div className="mt-1 text-xs text-[var(--muted)]">{record.variantEquivalence}</div></td>
                    <td className="px-4 py-3"><div>{record.vendor.name}</div><div className="mt-1 font-mono text-xs text-[var(--muted-strong)]">{record.platform}</div></td>
                    <td className="px-4 py-3">{record.firmwareTrain ? <Link href={`/firmware/trains/${record.firmwareTrain.id}`} className="text-[var(--accent-light)] hover:underline">{record.firmwareTrain.name}</Link> : <span className="text-[var(--muted)]">—</span>}</td>
                    <td className="px-4 py-3"><span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs">{record.catalogState}</span>{record.isActive ? null : <div className="mt-2 text-xs text-[var(--muted)]">Archived record</div>}</td>
                    <td className="px-4 py-3"><span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs">{record.policyEligibility}</span></td>
                    <td className="px-4 py-3 text-xs text-[var(--muted-strong)]">{record.filename ?? '—'}<div className="mt-1 text-[var(--muted)]">{formatBytes(record.fileSizeBytes)}</div></td>
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
