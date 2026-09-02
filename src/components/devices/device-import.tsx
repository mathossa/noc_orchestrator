'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import {
  DEVICE_IMPORT_FIELDS,
  headersFromRow,
  suggestColumnMapping,
  type DeviceImportField,
  type DeviceImportMapping,
  type DeviceImportProfileSettings,
} from '@/lib/device-import'
import { profileIdForRepeatedWorkbook } from '@/lib/device-import-reconciliation-memory'
import type { XlsxRow } from '@/lib/xlsx-reader'

type ApiError = { error?: { message?: string } }
type SheetInspection = {
  name: string
  rowCount: number
  columnCount: number
  previewRows: XlsxRow[]
  detectedHeaderRow: number
  headers: string[]
  suggestedMapping: DeviceImportMapping
}
type Inspection = {
  fileName: string
  fileSize: number
  sheets: SheetInspection[]
  limits: { maxFileBytes: number; maxSheets: number; maxRowsPerSheet?: number; maxColumnsPerSheet: number; previewRows: number }
}
type ReferenceContext = {
  customers: Array<{ id: string; code: string | null; name: string; isActive: boolean }>
  sites: Array<{ id: string; customerId: string; code: string | null; name: string; isActive: boolean }>
}
type ImportProfile = {
  id: string
  name: string
  externalProvider: string | null
  settings: DeviceImportProfileSettings
  isActive: boolean
  createdAt: string
  updatedAt: string
}
type BatchListItem = {
  id: string
  profileId: string | null
  profileName: string | null
  fileName: string
  sheetName: string
  status: string
  totalRows: number
  referenceCount: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}
type InspectPayload = { data?: Inspection; references?: ReferenceContext; profiles?: ImportProfile[] } & ApiError
type ProfilePayload = { data?: ImportProfile } & ApiError
type BatchPayload = { data?: { batch: { id: string } } } & ApiError

const EMPTY_REFERENCES: ReferenceContext = { customers: [], sites: [] }

const FIELD_LABELS: Record<DeviceImportField, string> = {
  organizationSite: 'Organization + site (split one column)',
  customer: 'Customer',
  site: 'Site / location',
  name: 'Device name',
  hostname: 'Hostname',
  serialNumber: 'Serial number',
  vendor: 'Vendor',
  model: 'Concrete device model',
  platform: 'Software Platform',
  deviceType: 'Device type',
  managementAddress: 'Management address',
  currentFirmware: 'Current firmware (generic)',
  firmwareVersion: 'Firmware Version (preferred)',
  softwareVersion: 'Software Version (fallback; extract version)',
  contract: 'Contract context (validate only)',
  externalProvider: 'External provider',
  externalId: 'External / source ID',
  notes: 'Notes',
}

const STATUS_LABELS: Record<string, string> = {
  STAGED: 'Needs resolution',
  READY: 'References resolved',
  PUBLISHED: 'Published',
  PARTIAL: 'Partially published',
}

export function DeviceImportWorkspace() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [references, setReferences] = useState<ReferenceContext>(EMPTY_REFERENCES)
  const [profiles, setProfiles] = useState<ImportProfile[]>([])
  const [batches, setBatches] = useState<BatchListItem[]>([])
  const [batchesLoaded, setBatchesLoaded] = useState(false)
  const autoProfileAttempted = useRef(false)
  const [profileId, setProfileId] = useState('')
  const [profileName, setProfileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<DeviceImportMapping>({})
  const [defaultCustomerId, setDefaultCustomerId] = useState('')
  const [defaultSiteId, setDefaultSiteId] = useState('')
  const [externalProvider, setExternalProvider] = useState('')
  const [organizationSiteDelimiter, setOrganizationSiteDelimiter] = useState(' - ')
  const [busy, setBusy] = useState<'inspect' | 'stage' | 'profile' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/v1/device-import/batches')
      .then(async (response) => {
        const payload = (await response.json()) as { data?: BatchListItem[] }
        if (!cancelled && response.ok) setBatches(payload.data ?? [])
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setBatchesLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const currentSheet = inspection?.sheets.find((sheet) => sheet.name === sheetName) ?? null
  const headerSourceRow = currentSheet?.previewRows.find((row) => row.rowNumber === headerRow)
  const headers = currentSheet ? headersFromRow(headerSourceRow, currentSheet.columnCount) : []
  const defaultSites = references.sites.filter((site) => site.customerId === defaultCustomerId)
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null
  const mappedFieldSet = useMemo(
    () => new Set(Object.values(mapping).filter((value): value is DeviceImportField => value !== 'ignore')),
    [mapping],
  )

  function resetAfterFile() {
    setInspection(null)
    setReferences(EMPTY_REFERENCES)
    setProfiles([])
    autoProfileAttempted.current = false
    setProfileId('')
    setProfileName('')
    setSheetName('')
    setHeaderRow(1)
    setMapping({})
    setDefaultCustomerId('')
    setDefaultSiteId('')
    setExternalProvider('')
    setOrganizationSiteDelimiter(' - ')
    setError(null)
    setNotice(null)
  }

  function chooseFile(next: File | null) {
    setFile(next)
    resetAfterFile()
  }

  function applySheet(sheet: SheetInspection) {
    setSheetName(sheet.name)
    setHeaderRow(sheet.detectedHeaderRow)
    setMapping(sheet.suggestedMapping)
  }

  const applyProfile = useCallback((nextId: string) => {
    setProfileId(nextId)
    if (!nextId) return
    const profile = profiles.find((candidate) => candidate.id === nextId)
    if (!profile || !inspection) return
    const settings = profile.settings
    setProfileName(profile.name)
    setExternalProvider(profile.externalProvider ?? settings.defaults.externalProvider ?? '')
    setDefaultCustomerId(settings.defaults.customerId ?? '')
    setDefaultSiteId(settings.defaults.siteId ?? '')
    setOrganizationSiteDelimiter(settings.organizationSiteDelimiter || ' - ')
    const sheet = inspection.sheets.find((candidate) => candidate.name === settings.sheetName)
    if (sheet) {
      setSheetName(sheet.name)
      setHeaderRow(settings.headerRow)
      setMapping(settings.mapping)
      setNotice(`Loaded ${profile.name}. Previously remembered entity links will be applied automatically after staging.`)
    } else {
      setNotice(`Profile “${profile.name}” expects worksheet “${settings.sheetName}”. Choose the matching worksheet and update the profile if the export changed.`)
    }
  }, [inspection, profiles])

  useEffect(() => {
    if (!inspection || !batchesLoaded || autoProfileAttempted.current || !profiles.length) return
    autoProfileAttempted.current = true
    if (profileId) return
    const repeatedProfileId = profileIdForRepeatedWorkbook(
      inspection.fileName,
      inspection.sheets.map((sheet) => sheet.name),
      batches,
      profiles,
    )
    if (!repeatedProfileId) return
    const profile = profiles.find((candidate) => candidate.id === repeatedProfileId)
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      applyProfile(repeatedProfileId)
      setNotice(`Automatically loaded ${profile?.name ?? 'the previous import profile'} because the latest batch with this workbook filename used it.`)
    })
    return () => { cancelled = true }
  }, [applyProfile, batches, batchesLoaded, inspection, profileId, profiles])

  function changeHeaderRow(nextRow: number) {
    if (!currentSheet) return
    const row = currentSheet.previewRows.find((candidate) => candidate.rowNumber === nextRow)
    setHeaderRow(nextRow)
    setMapping(suggestColumnMapping(headersFromRow(row, currentSheet.columnCount)))
  }

  function changeMapping(columnIndex: number, field: DeviceImportField | 'ignore') {
    setMapping((current) => ({ ...current, [String(columnIndex)]: field }))
  }

  function options() {
    return {
      profileId: profileId || null,
      sheetName,
      headerRow,
      mapping,
      defaults: {
        customerId: defaultCustomerId || null,
        siteId: defaultSiteId || null,
        externalProvider: externalProvider.trim() || null,
      },
      organizationSiteDelimiter,
      resolutions: {},
    }
  }

  function profileSettings(): DeviceImportProfileSettings {
    const current = options()
    return {
      sheetName: current.sheetName,
      headerRow: current.headerRow,
      mapping: current.mapping,
      defaults: current.defaults,
      organizationSiteDelimiter: current.organizationSiteDelimiter,
    }
  }

  async function inspectWorkbook() {
    if (!file) return
    setBusy('inspect')
    setError(null)
    setNotice(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/v1/device-import/xlsx/inspect', { method: 'POST', body: formData })
      const payload = (await response.json()) as InspectPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The XLSX workbook could not be inspected.')
      setInspection(payload.data)
      setReferences(payload.references ?? EMPTY_REFERENCES)
      setProfiles(payload.profiles ?? [])
      const firstUseful = payload.data.sheets.find((sheet) => sheet.rowCount > 0) ?? payload.data.sheets[0]
      if (firstUseful) applySheet(firstUseful)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The XLSX workbook could not be inspected.')
    } finally {
      setBusy(null)
    }
  }

  async function saveProfile() {
    if (!profileName.trim()) {
      setError('Enter a profile name such as AUVIK EXPORT.')
      return
    }
    setBusy('profile')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/v1/device-import/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: profileId || null,
          name: profileName.trim(),
          externalProvider: externalProvider.trim() || null,
          settings: profileSettings(),
          isActive: true,
        }),
      })
      const payload = (await response.json()) as ProfilePayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The import profile could not be saved.')
      setProfiles((current) => [...current.filter((profile) => profile.id !== payload.data!.id), payload.data!].sort((a, b) => a.name.localeCompare(b.name)))
      setProfileId(payload.data.id)
      setProfileName(payload.data.name)
      setNotice(`Import profile “${payload.data.name}” saved. Column mappings and remembered entity links will be reused next time.`)
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : 'The import profile could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  async function stageImport() {
    if (!file || !currentSheet) return
    setBusy('stage')
    setError(null)
    setNotice(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('options', JSON.stringify(options()))
      const response = await fetch('/api/v1/device-import/batches', { method: 'POST', body: formData })
      const payload = (await response.json()) as BatchPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The workbook could not be staged.')
      router.push(`/devices/import/${payload.data.batch.id}`)
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : 'The workbook could not be staged.')
    } finally {
      setBusy(null)
    }
  }

  return <>
    <PageHeader
      eyebrow="Inventory import"
      title="Import inbox"
      description="Stage external inventory first. Resolve unique customers, sites, vendors, types, models and firmware in quarantine; publish devices only after the batch is clean."
      actions={<Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to devices</Link>}
    />

    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#4e4a2a] bg-[#282416] px-4 py-3 text-sm text-amber-100">{notice}</div> : null}

    <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <div><h2 className="text-sm font-semibold">Staged imports</h2><p className="mt-1 text-xs text-[var(--muted)]">Unpublished batches stay here until their unique entities are linked and the devices are accepted.</p></div>
        <span className="text-xs text-[var(--muted)]">{batches.filter((batch) => batch.status !== 'PUBLISHED').length} active</span>
      </div>
      {batches.length ? <div className="divide-y divide-[var(--border)]">{batches.map((batch) => <Link key={batch.id} href={`/devices/import/${batch.id}`} className="grid gap-2 px-4 py-3 hover:bg-[var(--surface-raised)] sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] sm:items-center sm:px-5">
        <div><div className="font-semibold">{batch.fileName}</div><div className="mt-1 text-xs text-[var(--muted)]">{batch.profileName ?? 'No saved profile'} · {batch.sheetName}</div></div>
        <div className="text-sm text-[var(--muted-strong)]">{batch.totalRows.toLocaleString()} staged rows · {batch.referenceCount} unique references</div>
        <span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs font-semibold">{STATUS_LABELS[batch.status] ?? batch.status}</span>
        <span className="text-xs text-[var(--muted)]">{new Date(batch.updatedAt).toLocaleString()}</span>
      </Link>)}</div> : <div className="px-4 py-6 text-sm text-[var(--muted)] sm:px-5">No staged imports yet.</div>}
    </section>

    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <FormField label="1. XLSX workbook" htmlFor="device-import-file" description="Uploading only inspects the workbook. Nothing becomes normal inventory at this stage.">
          <input id="device-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--surface-raised)] file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
        </FormField>
        <Button variant="primary" onClick={() => void inspectWorkbook()} disabled={!file || busy !== null}>{busy === 'inspect' ? 'Inspecting…' : 'Inspect workbook'}</Button>
      </div>
      {file ? <p className="mt-3 text-xs text-[var(--muted)]">Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB</p> : null}
    </section>

    {inspection && currentSheet ? <div className="mt-5 space-y-5">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">2. Worksheet and header</h2><p className="mt-1 text-xs text-[var(--muted)]">Only a small sample is loaded into the browser.</p></div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <FormField label="Worksheet" htmlFor="device-import-sheet"><SelectInput id="device-import-sheet" value={sheetName} onChange={(event) => { const sheet = inspection.sheets.find((candidate) => candidate.name === event.target.value); if (sheet) applySheet(sheet) }}>{inspection.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.rowCount.toLocaleString()} rows · {sheet.columnCount} columns</option>)}</SelectInput></FormField>
          <FormField label="Header row" htmlFor="device-import-header"><SelectInput id="device-import-header" value={String(headerRow)} onChange={(event) => changeHeaderRow(Number(event.target.value))}>{currentSheet.previewRows.map((row) => <option key={row.rowNumber} value={row.rowNumber}>Row {row.rowNumber}: {row.values.filter(Boolean).slice(0, 4).join(' · ') || '(blank)'}</option>)}</SelectInput></FormField>
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 sm:px-5"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Workbook sample</div><div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]"><table className="min-w-full text-left text-xs"><tbody className="divide-y divide-[var(--border)]">{currentSheet.previewRows.slice(0, 10).map((row) => <tr key={row.rowNumber} className={row.rowNumber === headerRow ? 'bg-[var(--accent-soft)]' : ''}><th className="sticky left-0 bg-[var(--surface-raised)] px-2 py-1.5">{row.rowNumber}</th>{Array.from({ length: currentSheet.columnCount }, (_unused, index) => <td key={index} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1.5 text-[var(--muted-strong)]">{row.values[index] ?? ''}</td>)}</tr>)}</tbody></table></div></div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">3. Column mapping</h2><p className="mt-1 text-xs text-[var(--muted)]">For Auvik, map Organization Name to Organization + site. Firmware Version is preferred over Software Version.</p></div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">{headers.map((header, index) => <FormField key={`${header}-${index}`} label={`${header} · ${index + 1}`} htmlFor={`device-import-map-${index}`}><SelectInput id={`device-import-map-${index}`} value={mapping[String(index)] ?? 'ignore'} onChange={(event) => changeMapping(index, event.target.value as DeviceImportField | 'ignore')}><option value="ignore">Ignore column</option>{DEVICE_IMPORT_FIELDS.map((field) => <option key={field} value={field} disabled={mappedFieldSet.has(field) && mapping[String(index)] !== field}>{FIELD_LABELS[field]}</option>)}</SelectInput></FormField>)}</div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">4. Export profile and defaults</h2><p className="mt-1 text-xs text-[var(--muted)]">The profile is the memory layer: recurring Auvik names you explicitly remember will auto-link next time.</p></div>
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4 sm:p-5">
          <FormField label="Import profile" htmlFor="device-import-profile"><SelectInput id="device-import-profile" value={profileId} onChange={(event) => applyProfile(event.target.value)}><option value="">No saved profile</option>{profiles.filter((profile) => profile.isActive).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</SelectInput></FormField>
          <FormField label="Profile name" htmlFor="device-import-profile-name" description="e.g. AUVIK EXPORT"><TextInput id="device-import-profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} /></FormField>
          <FormField label="Default external provider" htmlFor="device-import-provider" description="Usually Auvik, CMDB, etc."><TextInput id="device-import-provider" value={externalProvider} onChange={(event) => setExternalProvider(event.target.value)} placeholder="Auvik" /></FormField>
          <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => void saveProfile()} disabled={busy !== null}>{busy === 'profile' ? 'Saving…' : selectedProfile ? 'Update profile' : 'Save profile'}</Button></div>
          <FormField label="Default customer" htmlFor="device-import-customer"><SelectInput id="device-import-customer" value={defaultCustomerId} onChange={(event) => { setDefaultCustomerId(event.target.value); if (!references.sites.some((site) => site.id === defaultSiteId && site.customerId === event.target.value)) setDefaultSiteId('') }}><option value="">No default customer</option>{references.customers.map((customer) => <option key={customer.id} value={customer.id} disabled={!customer.isActive}>{customer.name}{customer.code ? ` (${customer.code})` : ''}</option>)}</SelectInput></FormField>
          <FormField label="Default site" htmlFor="device-import-site"><SelectInput id="device-import-site" value={defaultSiteId} onChange={(event) => setDefaultSiteId(event.target.value)} disabled={!defaultCustomerId}><option value="">No default site</option>{defaultSites.map((site) => <option key={site.id} value={site.id} disabled={!site.isActive}>{site.name}{site.code ? ` (${site.code})` : ''}</option>)}</SelectInput></FormField>
          {mappedFieldSet.has('organizationSite') ? <FormField label="Organization/site delimiter" htmlFor="device-import-org-delimiter" description="Split uses the last occurrence."><TextInput id="device-import-org-delimiter" value={organizationSiteDelimiter} onChange={(event) => setOrganizationSiteDelimiter(event.target.value)} /></FormField> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-5">
          <p className="max-w-3xl text-xs text-[var(--muted)]">Staging stores raw/mapped rows and unique reference values only. Devices are not globally visible until the staged batch is explicitly published.</p>
          <Button variant="primary" onClick={() => void stageImport()} disabled={busy !== null}>{busy === 'stage' ? 'Staging workbook…' : `Stage ${currentSheet.rowCount.toLocaleString()} rows`}</Button>
        </div>
      </section>
    </div> : null}
  </>
}
