'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  DeviceImportReferenceResolver,
  type DeviceImportResolutionReferences,
} from '@/components/devices/device-import-reference-resolver'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import {
  DEVICE_IMPORT_FIELDS,
  headersFromRow,
  suggestColumnMapping,
  type DeviceImportAction,
  type DeviceImportField,
  type DeviceImportMapping,
  type DeviceImportPreview,
  type DeviceImportProfileSettings,
  type DeviceImportResolutionMap,
  type DeviceImportResult,
} from '@/lib/device-import'
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
type ImportProfile = {
  id: string
  name: string
  externalProvider: string | null
  settings: DeviceImportProfileSettings
  isActive: boolean
  createdAt: string
  updatedAt: string
}
type LargeImportPreview = DeviceImportPreview & {
  totalRows?: number
  previewRowLimit?: number
  rowsTruncated?: boolean
}
type InspectPayload = { data?: Inspection; references?: DeviceImportResolutionReferences; profiles?: ImportProfile[] } & ApiError
type PreviewPayload = { data?: LargeImportPreview } & ApiError
type CommitPayload = { data?: DeviceImportResult } & ApiError
type ProfilePayload = { data?: ImportProfile } & ApiError

const EMPTY_REFERENCES: DeviceImportResolutionReferences = {
  customers: [],
  sites: [],
  vendors: [],
  deviceTypes: [],
  models: [],
  families: [],
  contracts: [],
  firmwareReleases: [],
}

const FIELD_LABELS: Record<DeviceImportField, string> = {
  organizationSite: 'Organization + site (split one column)',
  customer: 'Customer',
  site: 'Site / location',
  name: 'Device name',
  hostname: 'Hostname',
  serialNumber: 'Serial number',
  vendor: 'Vendor',
  model: 'Concrete device model',
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

const ACTION_LABELS: Record<DeviceImportAction, string> = {
  CREATE: 'Create', UPDATE: 'Update', UNCHANGED: 'Unchanged', CONFLICT: 'Conflict', ERROR: 'Error',
}

export function DeviceImportWorkspace() {
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [references, setReferences] = useState<DeviceImportResolutionReferences>(EMPTY_REFERENCES)
  const [profiles, setProfiles] = useState<ImportProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [profileName, setProfileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<DeviceImportMapping>({})
  const [defaultCustomerId, setDefaultCustomerId] = useState('')
  const [defaultSiteId, setDefaultSiteId] = useState('')
  const [externalProvider, setExternalProvider] = useState('')
  const [organizationSiteDelimiter, setOrganizationSiteDelimiter] = useState(' - ')
  const [resolutions, setResolutions] = useState<DeviceImportResolutionMap>({})
  const [preview, setPreview] = useState<LargeImportPreview | null>(null)
  const [selectedRows, setSelectedRows] = useState<number[]>([])
  const [filter, setFilter] = useState<'ALL' | DeviceImportAction>('ALL')
  const [result, setResult] = useState<DeviceImportResult | null>(null)
  const [busy, setBusy] = useState<'inspect' | 'preview' | 'commit' | 'profile' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const currentSheet = inspection?.sheets.find((sheet) => sheet.name === sheetName) ?? null
  const headerSourceRow = currentSheet?.previewRows.find((row) => row.rowNumber === headerRow)
  const headers = currentSheet ? headersFromRow(headerSourceRow, currentSheet.columnCount) : []
  const defaultSites = references.sites.filter((site) => site.customerId === defaultCustomerId)
  const visibleRows = preview?.rows.filter((row) => filter === 'ALL' || row.action === filter) ?? []
  const shownImportableRows = preview?.rows.filter((row) => row.importable).map((row) => row.rowNumber) ?? []
  const allVisibleImportable = visibleRows.filter((row) => row.importable)
  const allVisibleSelected = allVisibleImportable.length > 0 && allVisibleImportable.every((row) => selectedRows.includes(row.rowNumber))
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null
  const totalValidatedRows = preview?.totalRows ?? (preview ? preview.counts.create + preview.counts.update + preview.counts.unchanged + preview.counts.conflict + preview.counts.error : 0)
  const allValidCount = preview?.counts.importable ?? 0

  const mappedFieldSet = useMemo(
    () => new Set(Object.values(mapping).filter((value): value is DeviceImportField => value !== 'ignore')),
    [mapping],
  )

  function invalidatePreview() {
    setPreview(null)
    setSelectedRows([])
    setResult(null)
  }

  function resetAfterFile() {
    setInspection(null)
    setReferences(EMPTY_REFERENCES)
    setProfiles([])
    setProfileId('')
    setProfileName('')
    setSheetName('')
    setHeaderRow(1)
    setMapping({})
    setResolutions({})
    setPreview(null)
    setSelectedRows([])
    setResult(null)
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
    setResolutions({})
    invalidatePreview()
  }

  function applyProfile(nextId: string) {
    setProfileId(nextId)
    setResolutions({})
    invalidatePreview()
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
    } else {
      setNotice(`Profile “${profile.name}” expects worksheet “${settings.sheetName}”. Choose the matching sheet and update the profile if this export changed.`)
    }
  }

  function changeHeaderRow(nextRow: number) {
    if (!currentSheet) return
    const row = currentSheet.previewRows.find((candidate) => candidate.rowNumber === nextRow)
    setHeaderRow(nextRow)
    setMapping(suggestColumnMapping(headersFromRow(row, currentSheet.columnCount)))
    setResolutions({})
    invalidatePreview()
  }

  function changeMapping(columnIndex: number, field: DeviceImportField | 'ignore') {
    setMapping((current) => ({ ...current, [String(columnIndex)]: field }))
    setResolutions({})
    invalidatePreview()
  }

  async function inspectPayload() {
    if (!file) return null
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/v1/device-import/xlsx/inspect', { method: 'POST', body: formData })
    const payload = (await response.json()) as InspectPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The XLSX workbook could not be inspected.')
    return payload
  }

  async function inspectWorkbook() {
    if (!file) return
    setBusy('inspect')
    setError(null)
    setNotice(null)
    invalidatePreview()
    try {
      const payload = await inspectPayload()
      if (!payload?.data) return
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

  async function refreshReferenceContext() {
    try {
      const payload = await inspectPayload()
      if (!payload) return
      setReferences(payload.references ?? EMPTY_REFERENCES)
      setProfiles(payload.profiles ?? [])
    } catch {
      // The selected resolution remains valid server-side; the next preview will refresh everything.
    }
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
      resolutions,
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
      setNotice(`Import profile “${payload.data.name}” saved. Column mappings and future remembered reference choices can now be reused.`)
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : 'The import profile could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  async function previewImport() {
    if (!file || !currentSheet) return
    setBusy('preview')
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('options', JSON.stringify(options()))
      const response = await fetch('/api/v1/device-import/xlsx/preview', { method: 'POST', body: formData })
      const payload = (await response.json()) as PreviewPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The import preview could not be created.')
      setPreview(payload.data)
      setSelectedRows(payload.data.rows.filter((row) => row.importable).map((row) => row.rowNumber))
      setFilter('ALL')
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'The import preview could not be created.')
    } finally {
      setBusy(null)
    }
  }

  async function commitImport(allValid: boolean) {
    if (!file || !preview) return
    if (!allValid && selectedRows.length === 0) return
    const requestedCount = allValid ? allValidCount : selectedRows.length
    const scope = allValid ? 'all valid CREATE/UPDATE rows' : `${selectedRows.length} selected preview row${selectedRows.length === 1 ? '' : 's'}`
    if (!window.confirm(`Import ${scope} (${requestedCount})? The server will revalidate the entire workbook before writing.`)) return
    setBusy('commit')
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('options', JSON.stringify(options()))
      formData.append('selectedRows', JSON.stringify(allValid ? { mode: 'ALL_IMPORTABLE' } : selectedRows))
      const response = await fetch('/api/v1/device-import/xlsx/commit', { method: 'POST', body: formData })
      const payload = (await response.json()) as CommitPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The selected rows could not be imported.')
      setResult(payload.data)
      setSelectedRows([])
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : 'The selected rows could not be imported.')
    } finally {
      setBusy(null)
    }
  }

  function toggleRow(rowNumber: number) {
    setSelectedRows((current) => current.includes(rowNumber) ? current.filter((row) => row !== rowNumber) : [...current, rowNumber])
  }

  function toggleVisibleRows(selected: boolean) {
    const visible = new Set(allVisibleImportable.map((row) => row.rowNumber))
    setSelectedRows((current) => {
      const next = new Set(current)
      for (const rowNumber of visible) {
        if (selected) next.add(rowNumber)
        else next.delete(rowNumber)
      }
      return [...next]
    })
  }

  return <>
    <PageHeader eyebrow="Inventory import" title="Import devices from XLSX" description="Use a saved export profile or map a new workbook. Reference decisions can be linked once, remembered per export profile, or deliberately created during import." actions={<Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to devices</Link>} />
    {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-5 rounded-md border border-[#4e4a2a] bg-[#282416] px-4 py-3 text-sm text-amber-100">{notice}</div> : null}

    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><FormField label="1. XLSX workbook" htmlFor="device-import-file" description="Inspection reads only a bounded worksheet sample. Full validation happens when you request a preview/import."><input id="device-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--surface-raised)] file:px-3 file:py-1.5 file:text-sm file:font-semibold" /></FormField><Button variant="primary" onClick={() => void inspectWorkbook()} disabled={!file || busy !== null}>{busy === 'inspect' ? 'Inspecting…' : 'Inspect workbook'}</Button></div>
      {file ? <p className="mt-3 text-xs text-[var(--muted)]">Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB</p> : null}
    </section>

    {inspection && currentSheet ? <div className="mt-5 space-y-5">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">2. Worksheet and header</h2><p className="mt-1 text-xs text-[var(--muted)]">A saved profile restores these choices automatically.</p></div><div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5"><FormField label="Worksheet" htmlFor="device-import-sheet"><SelectInput id="device-import-sheet" value={sheetName} onChange={(event) => { const sheet = inspection.sheets.find((candidate) => candidate.name === event.target.value); if (sheet) applySheet(sheet) }}>{inspection.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.rowCount} rows · {sheet.columnCount} columns</option>)}</SelectInput></FormField><FormField label="Header row" htmlFor="device-import-header"><SelectInput id="device-import-header" value={String(headerRow)} onChange={(event) => changeHeaderRow(Number(event.target.value))}>{currentSheet.previewRows.map((row) => <option key={row.rowNumber} value={row.rowNumber}>Row {row.rowNumber}: {row.values.filter(Boolean).slice(0, 4).join(' · ') || '(blank)'}</option>)}</SelectInput></FormField></div><div className="border-t border-[var(--border)] px-4 py-3 sm:px-5"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Workbook sample</div><div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]"><table className="min-w-full text-left text-xs"><tbody className="divide-y divide-[var(--border)]">{currentSheet.previewRows.slice(0, 10).map((row) => <tr key={row.rowNumber} className={row.rowNumber === headerRow ? 'bg-[var(--accent-soft)]' : ''}><th className="sticky left-0 bg-[var(--surface-raised)] px-2 py-1.5">{row.rowNumber}</th>{Array.from({ length: currentSheet.columnCount }, (_unused, index) => <td key={index} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1.5 text-[var(--muted-strong)]">{row.values[index] ?? ''}</td>)}</tr>)}</tbody></table></div></div></section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">3. Column mapping</h2><p className="mt-1 text-xs text-[var(--muted)]">For Auvik, map Organization Name to Organization + site. Firmware Version is preferred over Software Version when both are present.</p></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">{headers.map((header, index) => <FormField key={`${header}-${index}`} label={`${header} · ${index + 1}`} htmlFor={`device-import-map-${index}`}><SelectInput id={`device-import-map-${index}`} value={mapping[String(index)] ?? 'ignore'} onChange={(event) => changeMapping(index, event.target.value as DeviceImportField | 'ignore')}><option value="ignore">Ignore column</option>{DEVICE_IMPORT_FIELDS.map((field) => <option key={field} value={field} disabled={mappedFieldSet.has(field) && mapping[String(index)] !== field}>{FIELD_LABELS[field]}</option>)}</SelectInput></FormField>)}</div></section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">4. Export profile and defaults</h2><p className="mt-1 text-xs text-[var(--muted)]">Profiles remember the export layout and scope future “always match” decisions to that exporter.</p></div><div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4 sm:p-5">
        <FormField label="Import profile" htmlFor="device-import-profile"><SelectInput id="device-import-profile" value={profileId} onChange={(event) => applyProfile(event.target.value)}><option value="">No saved profile</option>{profiles.filter((profile) => profile.isActive).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</SelectInput></FormField>
        <FormField label="Profile name" htmlFor="device-import-profile-name" description="e.g. AUVIK EXPORT"><TextInput id="device-import-profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} /></FormField>
        <FormField label="Default external provider" htmlFor="device-import-provider" description="Usually the source system name, e.g. Auvik."><TextInput id="device-import-provider" value={externalProvider} onChange={(event) => { setExternalProvider(event.target.value); invalidatePreview() }} placeholder="Auvik" /></FormField>
        <div className="flex items-end"><Button type="button" variant="ghost" onClick={() => void saveProfile()} disabled={busy !== null}>{busy === 'profile' ? 'Saving…' : selectedProfile ? 'Update profile' : 'Save profile'}</Button></div>
        <FormField label="Default customer" htmlFor="device-import-customer"><SelectInput id="device-import-customer" value={defaultCustomerId} onChange={(event) => { setDefaultCustomerId(event.target.value); if (!references.sites.some((site) => site.id === defaultSiteId && site.customerId === event.target.value)) setDefaultSiteId(''); invalidatePreview() }}><option value="">No default customer</option>{references.customers.map((customer) => <option key={customer.id} value={customer.id} disabled={!customer.isActive}>{customer.name}{customer.code ? ` (${customer.code})` : ''}</option>)}</SelectInput></FormField>
        <FormField label="Default site" htmlFor="device-import-site"><SelectInput id="device-import-site" value={defaultSiteId} onChange={(event) => { setDefaultSiteId(event.target.value); invalidatePreview() }} disabled={!defaultCustomerId}><option value="">No default site</option>{defaultSites.map((site) => <option key={site.id} value={site.id} disabled={!site.isActive}>{site.name}{site.code ? ` (${site.code})` : ''}</option>)}</SelectInput></FormField>
        {mappedFieldSet.has('organizationSite') ? <FormField label="Organization/site delimiter" htmlFor="device-import-org-delimiter" description="For values like Organization - Site. Split uses the last occurrence."><TextInput id="device-import-org-delimiter" value={organizationSiteDelimiter} onChange={(event) => { setOrganizationSiteDelimiter(event.target.value); invalidatePreview() }} /></FormField> : null}
      </div><div className="flex justify-end border-t border-[var(--border)] px-4 py-3 sm:px-5"><Button variant="primary" onClick={() => void previewImport()} disabled={busy !== null}>{busy === 'preview' ? 'Validating…' : 'Validate and preview'}</Button></div></section>
    </div> : null}

    {preview ? <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5"><div><h2 className="text-sm font-semibold">5. Import preview</h2><p className="mt-1 text-xs text-[var(--muted)]">All {totalValidatedRows.toLocaleString()} rows were validated server-side. The browser only receives a bounded review sample.</p></div><div className="flex flex-wrap gap-2 text-xs"><PreviewCount label="Create" value={preview.counts.create} /><PreviewCount label="Update" value={preview.counts.update} /><PreviewCount label="Unchanged" value={preview.counts.unchanged} /><PreviewCount label="Conflict" value={preview.counts.conflict} /><PreviewCount label="Error" value={preview.counts.error} /></div></div>
      {preview.rowsTruncated ? <div className="border-b border-[#4e4a2a] bg-[#282416] px-4 py-3 text-xs text-amber-100 sm:px-5">Showing {preview.rows.length.toLocaleString()} of {totalValidatedRows.toLocaleString()} validated rows. Counts and unresolved-reference aggregation cover the full workbook. Use <strong>Import all valid rows</strong> to import beyond this sample without loading every row into the browser.</div> : null}
      <DeviceImportReferenceResolver unresolved={preview.unresolvedReferences} references={references} resolutions={resolutions} profileId={profileId || null} profileName={selectedProfile?.name ?? (profileId ? profileName : null)} onResolutionChange={(key, targetId) => setResolutions((current) => ({ ...current, [key]: targetId }))} onReferenceCreated={() => void refreshReferenceContext()} onRepreview={() => void previewImport()} disabled={busy !== null} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5"><FormField label="Show sample rows" htmlFor="device-import-filter"><SelectInput id="device-import-filter" value={filter} onChange={(event) => setFilter(event.target.value as 'ALL' | DeviceImportAction)}><option value="ALL">All sampled rows</option>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput></FormField><div className="text-sm text-[var(--muted-strong)]">{selectedRows.length} of {shownImportableRows.length} shown importable rows selected · {allValidCount.toLocaleString()} valid in full workbook</div></div>
      <div className="noc-scrollbar overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]"><tr><th className="w-12 px-3 py-2.5"><input type="checkbox" aria-label="Select visible importable rows" checked={allVisibleSelected} onChange={(event) => toggleVisibleRows(event.target.checked)} disabled={!allVisibleImportable.length} /></th><th className="px-3 py-2.5">Row</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">Identity</th><th className="px-3 py-2.5">Customer / site</th><th className="px-3 py-2.5">Model</th><th className="px-3 py-2.5">Current firmware</th><th className="px-3 py-2.5">Changes / validation</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{visibleRows.map((row) => <tr key={row.rowNumber} className={row.action === 'ERROR' || row.action === 'CONFLICT' ? 'bg-[#2a1b1b]/35' : ''}><td className="px-3 py-3"><input type="checkbox" checked={selectedRows.includes(row.rowNumber)} onChange={() => toggleRow(row.rowNumber)} disabled={!row.importable} aria-label={`Import spreadsheet row ${row.rowNumber}`} /></td><td className="px-3 py-3 tabular-nums text-[var(--muted)]">{row.rowNumber}</td><td className="px-3 py-3"><span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs font-semibold">{ACTION_LABELS[row.action]}</span></td><td className="px-3 py-3"><div className="font-semibold">{row.identity}</div>{row.existingDeviceId ? <Link href={`/devices/${row.existingDeviceId}`} className="mt-1 inline-flex text-xs text-[var(--accent-light)] hover:underline">Existing device</Link> : null}</td><td className="px-3 py-3"><div>{row.customer ?? '—'}</div><div className="mt-1 text-xs text-[var(--muted)]">{row.site ?? 'No site'}</div></td><td className="px-3 py-3">{row.model ?? '—'}</td><td className="px-3 py-3 font-mono">{row.currentFirmware ?? 'Unknown'}</td><td className="px-3 py-3">{row.issues.length ? <div className="space-y-1">{row.issues.map((issue, index) => <div key={`${issue.message}-${index}`} className={issue.level === 'error' ? 'text-xs text-red-300' : 'text-xs text-amber-200'}>{issue.message}</div>)}</div> : null}{row.changes.length ? <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-[var(--accent-light)]">{row.changes.length} changes</summary><div className="mt-2 space-y-1 text-xs text-[var(--muted)]">{row.changes.map((change) => <div key={change.field}><strong>{change.label}:</strong> {change.before ?? '—'} → {change.after ?? '—'}</div>)}</div></details> : null}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-5"><p className="max-w-2xl text-xs text-[var(--muted)]">Import changes inventory/current firmware only. Desired firmware and lifecycle/planning state remain NOC Orchestrator-owned.</p><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => void commitImport(false)} disabled={!selectedRows.length || busy !== null}>{busy === 'commit' ? 'Importing…' : `Import ${selectedRows.length} selected sample rows`}</Button><Button variant="primary" onClick={() => void commitImport(true)} disabled={!allValidCount || busy !== null}>{busy === 'commit' ? 'Importing…' : `Import all ${allValidCount.toLocaleString()} valid rows`}</Button></div></div>
    </section> : null}

    {result ? <section className="mt-5 rounded-lg border border-[#285f48] bg-[#142b22] p-5"><h2 className="text-sm font-semibold text-[#c8f3da]">Import completed</h2><div className="mt-4 grid gap-3 sm:grid-cols-4"><ResultStat label="Created" value={result.created} /><ResultStat label="Updated" value={result.updated} /><ResultStat label="Skipped" value={result.skipped} /><ResultStat label="Failed / excluded" value={result.failed} /></div><div className="mt-4"><Link href="/devices?source=IMPORT" className="rounded-md border border-[#4a8b6c] bg-[#1b382c] px-3 py-2 text-sm font-semibold text-[#c8f3da]">View imported devices</Link></div></section> : null}
  </>
}

function PreviewCount({ label, value }: { label: string; value: number }) {
  return <span className="rounded border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1"><strong>{value}</strong> {label}</span>
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-[#285f48] bg-[#10271e] p-3"><div className="text-xs uppercase tracking-[0.08em] text-[#7fb99a]">{label}</div><div className="mt-1 text-2xl font-semibold text-[#d7f7e5]">{value}</div></div>
}
