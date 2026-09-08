'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ImporterV2ColumnMapping } from '@/lib/importer-v2-source-profiles'

const FIELD_OPTIONS = [
  ['customer', 'Customer / organization'],
  ['businessUnit', 'Business unit / subdomain'],
  ['site', 'Site / location'],
  ['deviceName', 'Device name'],
  ['hostname', 'Hostname'],
  ['sourceId', 'Source / external ID'],
  ['serialNumber', 'Serial number'],
  ['macAddress', 'MAC address'],
  ['vendor', 'Vendor'],
  ['productFamily', 'Product family'],
  ['softwarePlatform', 'Software platform'],
  ['model', 'Concrete model'],
  ['deviceType', 'Device type'],
  ['managementAddress', 'Management address'],
  ['currentFirmware', 'Current firmware (generic)'],
  ['firmwareVersion', 'Firmware Version'],
  ['softwareVersion', 'Software Version'],
  ['notes', 'Notes'],
] as const

type PreviewRow = { rowNumber: number; values: string[] }
type Recognition = {
  action: 'CONFIRM_PROFILE' | 'CHOOSE_PROFILE' | 'CREATE_PROFILE'
  suggestedProfileId: string | null
  candidates: Array<{
    profileId: string
    profileName: string
    profileVersion: string
    score: number
    match: string
    reasons: string[]
    warnings: string[]
  }>
}
type SheetInspection = {
  name: string
  rowCount: number
  columnCount: number
  previewRows: PreviewRow[]
  detectedHeaderRow: number
  headers: string[]
  suggestedMappings: ImporterV2ColumnMapping[]
  recognition: Recognition
}
type SourceProfile = {
  id: string
  name: string
  version: string
  sheetName: string
  headerRow: number
  columnMappings: ImporterV2ColumnMapping[]
  hierarchyTemplate: { delimiter: string }
}
type Inspection = {
  fileName: string
  fileSize: number
  limits: { maxFileBytes: number; previewRows: number }
  sheets: SheetInspection[]
  profiles: SourceProfile[]
}
type ApiPayload<T> = { data?: T; error?: { message?: string } }

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function ImporterV2Upload() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [provider, setProvider] = useState('Auvik')
  const [sourceAdapterId, setSourceAdapterId] = useState('xlsx')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState(1)
  const [mappings, setMappings] = useState<ImporterV2ColumnMapping[]>([])
  const [profileId, setProfileId] = useState('')
  const [profileName, setProfileName] = useState('Auvik XLSX')
  const [hierarchyDelimiter, setHierarchyDelimiter] = useState(' - ')
  const [profileConfirmed, setProfileConfirmed] = useState(false)
  const [busy, setBusy] = useState<'inspect' | 'stage' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedSheet = inspection?.sheets.find((sheet) => sheet.name === sheetName) ?? null
  const headerSource = selectedSheet?.previewRows.find((row) => row.rowNumber === headerRow)
  const currentHeaders = selectedSheet
    ? Array.from({ length: selectedSheet.columnCount }, (_unused, index) => headerSource?.values[index]?.trim() || selectedSheet.headers[index] || `Column ${index + 1}`)
    : []

  function resetInspection() {
    setInspection(null)
    setSheetName('')
    setHeaderRow(1)
    setMappings([])
    setProfileId('')
    setProfileConfirmed(false)
    setError(null)
  }

  function chooseFile(next: File | null) {
    setFile(next)
    resetInspection()
  }

  function applySheet(sheet: SheetInspection, profiles?: SourceProfile[]) {
    setSheetName(sheet.name)
    setHeaderRow(sheet.detectedHeaderRow)
    setMappings(sheet.suggestedMappings)
    const suggested = sheet.recognition.suggestedProfileId
    setProfileId(suggested ?? '')
    const profile = profiles?.find((candidate) => candidate.id === suggested)
    setHierarchyDelimiter(profile?.hierarchyTemplate.delimiter ?? ' - ')
    setProfileConfirmed(false)
  }

  function applyProfile(nextId: string) {
    setProfileId(nextId)
    setProfileConfirmed(false)
    if (!inspection || !nextId) return
    const profile = inspection.profiles.find((candidate) => candidate.id === nextId)
    if (!profile) return
    const profileSheet = inspection.sheets.find((sheet) => sheet.name === profile.sheetName)
    if (profileSheet) {
      setSheetName(profileSheet.name)
      setHeaderRow(profile.headerRow)
      setMappings(profile.columnMappings)
    }
    setHierarchyDelimiter(profile.hierarchyTemplate.delimiter)
  }

  function changeMapping(columnIndex: number, targetField: string) {
    setProfileConfirmed(false)
    setMappings((current) => {
      const withoutColumn = current.filter((mapping) => mapping.columnIndex !== columnIndex)
      if (!targetField) return withoutColumn
      const withoutDuplicateTarget = withoutColumn.filter((mapping) => mapping.targetField !== targetField)
      return [
        ...withoutDuplicateTarget,
        {
          columnIndex,
          sourceHeader: currentHeaders[columnIndex] ?? `Column ${columnIndex + 1}`,
          targetField: targetField as ImporterV2ColumnMapping['targetField'],
        },
      ].sort((left, right) => left.columnIndex - right.columnIndex)
    })
  }

  async function inspect() {
    if (!file) return
    setBusy('inspect')
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('provider', provider.trim())
      formData.append('sourceAdapterId', sourceAdapterId.trim())
      const response = await fetch('/api/v1/device-import-v2/xlsx/inspect', { method: 'POST', body: formData })
      const payload = (await response.json()) as ApiPayload<Inspection>
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The workbook could not be inspected.')
      setInspection(payload.data)
      const first = payload.data.sheets.find((sheet) => sheet.rowCount > 0) ?? payload.data.sheets[0]
      if (first) applySheet(first, payload.data.profiles)
    } catch (inspectError) {
      setError(inspectError instanceof Error ? inspectError.message : 'The workbook could not be inspected.')
    } finally {
      setBusy(null)
    }
  }

  async function stage() {
    if (!file || !selectedSheet || !profileConfirmed) return
    setBusy('stage')
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append(
        'config',
        JSON.stringify({
          provider: provider.trim(),
          sourceAdapterId: sourceAdapterId.trim(),
          sheetName: selectedSheet.name,
          headerRow,
          columnMappings: mappings,
          profileId: profileId || null,
          profileName: profileId ? null : profileName.trim(),
          confirmProfile: true,
          hierarchyDelimiter,
        }),
      )
      const response = await fetch('/api/v1/device-import-v2/batches', { method: 'POST', body: formData })
      const payload = (await response.json()) as ApiPayload<{ batch: { id: string } }>
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The workbook could not be staged.')
      router.push(`/devices/import/${payload.data.batch.id}`)
      router.refresh()
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : 'The workbook could not be staged.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--accent-light)]">New import</div>
        <h2 className="mt-1 text-base font-semibold text-[var(--foreground)]">Upload XLSX inventory</h2>
        <p className="mt-1 max-w-4xl text-sm text-[var(--muted)]">
          Upload and staging stay in quarantine. No Customer, Site, model, firmware release, or Device is created until the final publication step.
        </p>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {error ? (
          <div role="alert" className="rounded-md border border-[#8f4747] bg-[#512b2b] px-3 py-2 text-sm text-[#ffd7d7]">{error}</div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.5fr)_minmax(180px,0.7fr)_minmax(180px,0.7fr)_auto] lg:items-end">
          <label className="block text-sm font-medium text-[var(--foreground)]">
            XLSX workbook
            <input
              id="importer-v2-xlsx-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-1.5 file:font-semibold file:text-[var(--accent-light)]"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Provider
            <input
              value={provider}
              onChange={(event) => { setProvider(event.target.value); resetInspection() }}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
              placeholder="Auvik"
            />
          </label>
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Source adapter
            <input
              value={sourceAdapterId}
              onChange={(event) => { setSourceAdapterId(event.target.value); resetInspection() }}
              className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
              placeholder="xlsx"
            />
          </label>
          <Button onClick={() => void inspect()} disabled={!file || !provider.trim() || !sourceAdapterId.trim() || busy !== null}>
            {busy === 'inspect' ? 'Inspecting…' : 'Inspect workbook'}
          </Button>
        </div>

        {file ? (
          <div className="text-xs text-[var(--muted)]">Selected: {file.name} · {fileSize(file.size)} · maximum 8 MB</div>
        ) : null}

        {inspection && selectedSheet ? (
          <div className="space-y-4 border-t border-[var(--border)] pt-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Worksheet
                <select
                  value={sheetName}
                  onChange={(event) => {
                    const sheet = inspection.sheets.find((candidate) => candidate.name === event.target.value)
                    if (sheet) applySheet(sheet, inspection.profiles)
                  }}
                  className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                >
                  {inspection.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} ({sheet.rowCount.toLocaleString()} rows)</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Header row
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, selectedSheet.rowCount)}
                  value={headerRow}
                  onChange={(event) => { setHeaderRow(Math.max(1, Number.parseInt(event.target.value, 10) || 1)); setProfileConfirmed(false) }}
                  className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Source profile
                <select
                  value={profileId}
                  onChange={(event) => applyProfile(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                >
                  <option value="">Create new profile</option>
                  {inspection.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>)}
                </select>
              </label>
              {profileId ? (
                <label className="block text-sm font-medium text-[var(--foreground)]">
                  Hierarchy delimiter
                  <input
                    value={hierarchyDelimiter}
                    onChange={(event) => { setHierarchyDelimiter(event.target.value); setProfileConfirmed(false) }}
                    className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                  />
                </label>
              ) : (
                <label className="block text-sm font-medium text-[var(--foreground)]">
                  New profile name
                  <input
                    value={profileName}
                    onChange={(event) => { setProfileName(event.target.value); setProfileConfirmed(false) }}
                    className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                    placeholder="Auvik XLSX"
                  />
                </label>
              )}
            </div>

            {!profileId ? (
              <label className="block max-w-sm text-sm font-medium text-[var(--foreground)]">
                Hierarchy delimiter
                <input
                  value={hierarchyDelimiter}
                  onChange={(event) => { setHierarchyDelimiter(event.target.value); setProfileConfirmed(false) }}
                  className="mt-1 block w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                />
              </label>
            ) : null}

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--muted-strong)]">
              {profileId
                ? 'Existing source profile selected. Confirm it below before staging; current worksheet/mapping choices are treated as explicit overrides for this batch.'
                : 'No matching profile selected. A reusable source profile will be created when this batch is staged.'}
              {' '}If Business unit and Site are not mapped separately, the Customer/Organization column is parsed as Customer → Business unit → Site using the delimiter above.
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Column mapping</h3>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">Only mapped columns enter the evaluator. Raw source cells are still retained as evidence.</p>
                </div>
                <span className="text-xs text-[var(--muted)]">{mappings.length} mapped · {selectedSheet.columnCount} columns</span>
              </div>
              <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[var(--surface-raised)] text-xs uppercase tracking-[0.06em] text-[var(--muted)]">
                    <tr><th className="px-3 py-2">Column</th><th className="px-3 py-2">Source header</th><th className="px-3 py-2">Import as</th><th className="px-3 py-2">Sample</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {currentHeaders.map((header, columnIndex) => {
                      const mapping = mappings.find((candidate) => candidate.columnIndex === columnIndex)
                      const sample = selectedSheet.previewRows.find((row) => row.rowNumber > headerRow)?.values[columnIndex] ?? ''
                      return (
                        <tr key={columnIndex}>
                          <td className="px-3 py-2 text-xs tabular-nums text-[var(--muted)]">{columnIndex + 1}</td>
                          <td className="px-3 py-2 font-medium text-[var(--foreground)]">{header}</td>
                          <td className="px-3 py-2">
                            <select
                              value={mapping?.targetField ?? ''}
                              onChange={(event) => changeMapping(columnIndex, event.target.value)}
                              className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                            >
                              <option value="">Ignore column</option>
                              {FIELD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </td>
                          <td className="max-w-[320px] truncate px-3 py-2 text-xs text-[var(--muted-strong)]" title={sample}>{sample || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--border)] pt-4">
              <label className="flex max-w-3xl items-start gap-2 text-sm text-[var(--muted-strong)]">
                <input
                  type="checkbox"
                  checked={profileConfirmed}
                  onChange={(event) => setProfileConfirmed(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I confirm this source profile, worksheet, hierarchy interpretation, and column mapping for this batch. Staging evaluates all rows but does not publish canonical inventory.
                </span>
              </label>
              <Button
                onClick={() => void stage()}
                disabled={!profileConfirmed || mappings.length === 0 || (!profileId && !profileName.trim()) || busy !== null}
              >
                {busy === 'stage' ? 'Evaluating and staging…' : `Stage ${Math.max(0, selectedSheet.rowCount - headerRow).toLocaleString()} row(s)`}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
