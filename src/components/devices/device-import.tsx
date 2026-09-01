'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
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
  type DeviceImportResult,
} from '@/lib/device-import'
import type { DeviceReferenceData } from '@/lib/devices'
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
  limits: {
    maxFileBytes: number
    maxSheets: number
    maxRowsPerSheet: number
    maxColumnsPerSheet: number
    previewRows: number
  }
}

type InspectPayload = {
  data?: Inspection
  references?: Pick<DeviceReferenceData, 'customers' | 'sites'>
} & ApiError

type PreviewPayload = { data?: DeviceImportPreview } & ApiError
type CommitPayload = { data?: DeviceImportResult } & ApiError

const FIELD_LABELS: Record<DeviceImportField, string> = {
  customer: 'Customer',
  site: 'Site / location',
  name: 'Device name',
  hostname: 'Hostname',
  serialNumber: 'Serial number',
  vendor: 'Vendor',
  model: 'Concrete device model',
  deviceType: 'Device type',
  managementAddress: 'Management address',
  currentFirmware: 'Current firmware',
  contract: 'Contract context (validate only)',
  externalProvider: 'External provider',
  externalId: 'External / source ID',
  notes: 'Notes',
}

const ACTION_LABELS: Record<DeviceImportAction, string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  UNCHANGED: 'Unchanged',
  CONFLICT: 'Conflict',
  ERROR: 'Error',
}

export function DeviceImportWorkspace() {
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [references, setReferences] = useState<Pick<DeviceReferenceData, 'customers' | 'sites'>>({
    customers: [],
    sites: [],
  })
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState(1)
  const [mapping, setMapping] = useState<DeviceImportMapping>({})
  const [defaultCustomerId, setDefaultCustomerId] = useState('')
  const [defaultSiteId, setDefaultSiteId] = useState('')
  const [externalProvider, setExternalProvider] = useState('')
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null)
  const [selectedRows, setSelectedRows] = useState<number[]>([])
  const [filter, setFilter] = useState<'ALL' | DeviceImportAction>('ALL')
  const [result, setResult] = useState<DeviceImportResult | null>(null)
  const [busy, setBusy] = useState<'inspect' | 'preview' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentSheet = inspection?.sheets.find((sheet) => sheet.name === sheetName) ?? null
  const headerSourceRow = currentSheet?.previewRows.find((row) => row.rowNumber === headerRow)
  const headers = currentSheet ? headersFromRow(headerSourceRow, currentSheet.columnCount) : []
  const defaultSites = references.sites.filter((site) => site.customerId === defaultCustomerId)
  const visibleRows = preview?.rows.filter((row) => filter === 'ALL' || row.action === filter) ?? []
  const importableRows = preview?.rows.filter((row) => row.importable).map((row) => row.rowNumber) ?? []
  const allVisibleImportable = visibleRows.filter((row) => row.importable)
  const allVisibleSelected =
    allVisibleImportable.length > 0 && allVisibleImportable.every((row) => selectedRows.includes(row.rowNumber))

  const mappedFieldSet = useMemo(
    () => new Set(Object.values(mapping).filter((value): value is DeviceImportField => value !== 'ignore')),
    [mapping],
  )

  function resetAfterFile() {
    setInspection(null)
    setSheetName('')
    setHeaderRow(1)
    setMapping({})
    setPreview(null)
    setSelectedRows([])
    setResult(null)
    setError(null)
  }

  function chooseFile(next: File | null) {
    setFile(next)
    resetAfterFile()
  }

  function applySheet(sheet: SheetInspection) {
    setSheetName(sheet.name)
    setHeaderRow(sheet.detectedHeaderRow)
    setMapping(sheet.suggestedMapping)
    setPreview(null)
    setSelectedRows([])
    setResult(null)
  }

  function changeHeaderRow(nextRow: number) {
    if (!currentSheet) return
    const row = currentSheet.previewRows.find((candidate) => candidate.rowNumber === nextRow)
    const nextHeaders = headersFromRow(row, currentSheet.columnCount)
    setHeaderRow(nextRow)
    setMapping(suggestColumnMapping(nextHeaders))
    setPreview(null)
    setSelectedRows([])
    setResult(null)
  }

  function changeMapping(columnIndex: number, field: DeviceImportField | 'ignore') {
    setMapping((current) => ({ ...current, [String(columnIndex)]: field }))
    setPreview(null)
    setSelectedRows([])
    setResult(null)
  }

  async function inspectWorkbook() {
    if (!file) return
    setBusy('inspect')
    setError(null)
    setPreview(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/v1/device-import/xlsx/inspect', { method: 'POST', body: formData })
      const payload = (await response.json()) as InspectPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The XLSX workbook could not be inspected.')
      setInspection(payload.data)
      setReferences(payload.references ?? { customers: [], sites: [] })
      const firstUseful = payload.data.sheets.find((sheet) => sheet.rowCount > 0) ?? payload.data.sheets[0]
      if (firstUseful) applySheet(firstUseful)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The XLSX workbook could not be inspected.')
    } finally {
      setBusy(null)
    }
  }

  function options() {
    return {
      sheetName,
      headerRow,
      mapping,
      defaults: {
        customerId: defaultCustomerId || null,
        siteId: defaultSiteId || null,
        externalProvider: externalProvider.trim() || null,
      },
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

  async function commitImport() {
    if (!file || !preview || selectedRows.length === 0) return
    if (!window.confirm(`Import ${selectedRows.length} selected spreadsheet row${selectedRows.length === 1 ? '' : 's'}? The server will revalidate the workbook before writing.`)) return
    setBusy('commit')
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('options', JSON.stringify(options()))
      formData.append('selectedRows', JSON.stringify(selectedRows))
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
    setSelectedRows((current) =>
      current.includes(rowNumber) ? current.filter((row) => row !== rowNumber) : [...current, rowNumber],
    )
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

  return (
    <>
      <PageHeader
        eyebrow="Inventory import"
        title="Import devices from XLSX"
        description="Inspect, map and validate an existing spreadsheet before any device inventory is written. Unknown reference data is never created implicitly."
        actions={<Link href="/devices" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to devices</Link>}
      />

      {error ? <div className="mb-5 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <FormField label="1. XLSX workbook" htmlFor="device-import-file" description="The file stays in your browser and is resent for inspect, preview and confirmation. Maximum 8 MB.">
            <input
              id="device-import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--surface-raised)] file:px-3 file:py-1.5 file:text-sm file:font-semibold"
            />
          </FormField>
          <Button variant="primary" onClick={() => void inspectWorkbook()} disabled={!file || busy !== null}>
            {busy === 'inspect' ? 'Inspecting…' : 'Inspect workbook'}
          </Button>
        </div>
        {file ? <p className="mt-3 text-xs text-[var(--muted)]">Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB</p> : null}
      </section>

      {inspection && currentSheet ? (
        <div className="mt-5 space-y-5">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold">2. Worksheet and header</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Choose the useful worksheet and confirm which row contains the column headings.</p>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <FormField label="Worksheet" htmlFor="device-import-sheet">
                <SelectInput id="device-import-sheet" value={sheetName} onChange={(event) => {
                  const sheet = inspection.sheets.find((candidate) => candidate.name === event.target.value)
                  if (sheet) applySheet(sheet)
                }}>
                  {inspection.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.rowCount} rows · {sheet.columnCount} columns</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Header row" htmlFor="device-import-header" description={`Automatically detected row ${currentSheet.detectedHeaderRow}.`}>
                <SelectInput id="device-import-header" value={String(headerRow)} onChange={(event) => changeHeaderRow(Number(event.target.value))}>
                  {currentSheet.previewRows.map((row) => <option key={row.rowNumber} value={row.rowNumber}>Row {row.rowNumber}: {row.values.filter(Boolean).slice(0, 4).join(' · ') || '(blank)'}</option>)}
                </SelectInput>
              </FormField>
            </div>
            <div className="border-t border-[var(--border)] px-4 py-3 sm:px-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Workbook sample</div>
              <div className="noc-scrollbar overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="min-w-full text-left text-xs">
                  <tbody className="divide-y divide-[var(--border)]">
                    {currentSheet.previewRows.slice(0, 10).map((row) => (
                      <tr key={row.rowNumber} className={row.rowNumber === headerRow ? 'bg-[var(--accent-soft)]' : ''}>
                        <th className="sticky left-0 bg-[var(--surface-raised)] px-2 py-1.5 font-semibold text-[var(--muted)]">{row.rowNumber}</th>
                        {Array.from({ length: currentSheet.columnCount }, (_unused, index) => <td key={index} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1.5 text-[var(--muted-strong)]">{row.values[index] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold">3. Column mapping</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Automatic suggestions are based on common English/Dutch inventory headings. Every destination field can be mapped only once.</p>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">
              {headers.map((header, index) => (
                <FormField key={`${header}-${index}`} label={`${header} · ${index + 1}`} htmlFor={`device-import-map-${index}`}>
                  <SelectInput id={`device-import-map-${index}`} value={mapping[String(index)] ?? 'ignore'} onChange={(event) => changeMapping(index, event.target.value as DeviceImportField | 'ignore')}>
                    <option value="ignore">Ignore column</option>
                    {DEVICE_IMPORT_FIELDS.map((field) => <option key={field} value={field} disabled={mappedFieldSet.has(field) && mapping[String(index)] !== field}>{FIELD_LABELS[field]}</option>)}
                  </SelectInput>
                </FormField>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold">4. File-level defaults</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Use these when the workbook belongs to one customer/site or when external IDs share one source system.</p>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-3 sm:p-5">
              <FormField label="Default customer" htmlFor="device-import-customer" description={mappedFieldSet.has('customer') ? 'Used only when the mapped customer cell is blank.' : 'Required for new devices when Customer is not mapped.'}>
                <SelectInput id="device-import-customer" value={defaultCustomerId} onChange={(event) => {
                  setDefaultCustomerId(event.target.value)
                  if (!references.sites.some((site) => site.id === defaultSiteId && site.customerId === event.target.value)) setDefaultSiteId('')
                  setPreview(null)
                  setResult(null)
                }}>
                  <option value="">No default customer</option>
                  {references.customers.map((customer) => <option key={customer.id} value={customer.id} disabled={!customer.isActive}>{customer.name}{customer.code ? ` (${customer.code})` : ''}{customer.isActive ? '' : ' · archived'}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Default site" htmlFor="device-import-site" description="Optional. A site can never be assigned across customers.">
                <SelectInput id="device-import-site" value={defaultSiteId} onChange={(event) => { setDefaultSiteId(event.target.value); setPreview(null); setResult(null) }} disabled={!defaultCustomerId}>
                  <option value="">No default site</option>
                  {defaultSites.map((site) => <option key={site.id} value={site.id} disabled={!site.isActive}>{site.name}{site.code ? ` (${site.code})` : ''}{site.isActive ? '' : ' · archived'}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Default external provider" htmlFor="device-import-provider" description="Optional but recommended when mapping External ID for deterministic updates.">
                <TextInput id="device-import-provider" value={externalProvider} onChange={(event) => { setExternalProvider(event.target.value); setPreview(null); setResult(null) }} placeholder="e.g. CMDB export" />
              </FormField>
            </div>
            <div className="flex justify-end border-t border-[var(--border)] px-4 py-3 sm:px-5">
              <Button variant="primary" onClick={() => void previewImport()} disabled={busy !== null}>
                {busy === 'preview' ? 'Validating…' : 'Validate and preview'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {preview ? (
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold">5. Import preview</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Nothing has been written yet. Error/conflict rows are never selected for import.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <PreviewCount label="Create" value={preview.counts.create} />
              <PreviewCount label="Update" value={preview.counts.update} />
              <PreviewCount label="Unchanged" value={preview.counts.unchanged} />
              <PreviewCount label="Conflict" value={preview.counts.conflict} />
              <PreviewCount label="Error" value={preview.counts.error} />
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
            <FormField label="Show" htmlFor="device-import-filter">
              <SelectInput id="device-import-filter" value={filter} onChange={(event) => setFilter(event.target.value as 'ALL' | DeviceImportAction)}>
                <option value="ALL">All preview rows</option>
                {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectInput>
            </FormField>
            <div className="text-sm text-[var(--muted-strong)]">{selectedRows.length} of {importableRows.length} importable rows selected</div>
          </div>
          <div className="noc-scrollbar overflow-x-auto">
            <table className="w-full min-w-[1250px] text-left text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  <th className="w-12 px-3 py-2.5"><input type="checkbox" aria-label="Select visible importable rows" checked={allVisibleSelected} onChange={(event) => toggleVisibleRows(event.target.checked)} disabled={allVisibleImportable.length === 0} /></th>
                  <th className="px-3 py-2.5">Row</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">Identity</th><th className="px-3 py-2.5">Customer / site</th><th className="px-3 py-2.5">Model</th><th className="px-3 py-2.5">Current firmware</th><th className="px-3 py-2.5">Changes / validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {visibleRows.map((row) => (
                  <tr key={row.rowNumber} className={row.action === 'ERROR' || row.action === 'CONFLICT' ? 'bg-[#2a1b1b]/35' : ''}>
                    <td className="px-3 py-3"><input type="checkbox" checked={selectedRows.includes(row.rowNumber)} onChange={() => toggleRow(row.rowNumber)} disabled={!row.importable} aria-label={`Import spreadsheet row ${row.rowNumber}`} /></td>
                    <td className="px-3 py-3 tabular-nums text-[var(--muted)]">{row.rowNumber}</td>
                    <td className="px-3 py-3"><span className="rounded border border-[var(--border-strong)] px-2 py-1 text-xs font-semibold">{ACTION_LABELS[row.action]}</span></td>
                    <td className="px-3 py-3"><div className="font-semibold text-[var(--foreground)]">{row.identity}</div>{row.existingDeviceId ? <Link href={`/devices/${row.existingDeviceId}`} className="mt-1 inline-flex text-xs text-[var(--accent-light)] hover:underline">Existing device</Link> : null}</td>
                    <td className="px-3 py-3 text-[var(--muted-strong)]"><div>{row.customer ?? '—'}</div><div className="mt-1 text-xs text-[var(--muted)]">{row.site ?? 'No site'}</div></td>
                    <td className="px-3 py-3 text-[var(--muted-strong)]">{row.model ?? '—'}</td>
                    <td className="px-3 py-3 font-mono text-[var(--muted-strong)]">{row.currentFirmware ?? 'Unknown'}</td>
                    <td className="px-3 py-3">
                      {row.issues.length > 0 ? <div className="space-y-1">{row.issues.map((issue, index) => <div key={`${issue.message}-${index}`} className={issue.level === 'error' ? 'text-xs text-red-300' : 'text-xs text-amber-200'}>{issue.message}</div>)}</div> : null}
                      {row.changes.length > 0 ? <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-[var(--accent-light)]">{row.changes.length} change{row.changes.length === 1 ? '' : 's'}</summary><div className="mt-2 space-y-1 text-xs text-[var(--muted)]">{row.changes.map((change) => <div key={change.field}><strong className="text-[var(--muted-strong)]">{change.label}:</strong> {change.before ?? '—'} → {change.after ?? '—'}</div>)}</div></details> : row.issues.length === 0 ? <span className="text-xs text-[var(--muted)]">No inventory changes</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-5">
            <p className="max-w-3xl text-xs leading-5 text-[var(--muted)]">Import updates inventory/current-firmware fields only. Desired firmware policy, lifecycle decisions, planning and existing audit history are not imported or replaced.</p>
            <Button variant="primary" onClick={() => void commitImport()} disabled={selectedRows.length === 0 || busy !== null}>
              {busy === 'commit' ? 'Importing…' : `Import ${selectedRows.length} selected`}
            </Button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="mt-5 rounded-lg border border-[#285f48] bg-[#142b22] p-5">
          <h2 className="text-sm font-semibold text-[#c8f3da]">Import completed</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <ResultStat label="Created" value={result.created} /><ResultStat label="Updated" value={result.updated} /><ResultStat label="Skipped" value={result.skipped} /><ResultStat label="Failed / excluded" value={result.failed} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><Link href="/devices?source=IMPORT" className="rounded-md border border-[#4a8b6c] bg-[#1b382c] px-3 py-2 text-sm font-semibold text-[#c8f3da] hover:bg-[#234535]">View imported devices</Link><Button variant="ghost" onClick={() => { setPreview(null); setResult(null); setSelectedRows([]) }}>Prepare another preview</Button></div>
        </section>
      ) : null}
    </>
  )
}

function PreviewCount({ label, value }: { label: string; value: number }) {
  return <span className="rounded border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1"><strong>{value}</strong> {label}</span>
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-[#285f48] bg-[#10271e] p-3"><div className="text-xs uppercase tracking-[0.08em] text-[#7fb99a]">{label}</div><div className="mt-1 text-2xl font-semibold text-[#d7f7e4]">{value}</div></div>
}
