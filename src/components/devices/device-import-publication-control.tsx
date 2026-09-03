'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { DeviceImportPreview, DeviceImportPreviewRow, DeviceImportResult } from '@/lib/device-import'

type ApiError = { error?: { message?: string } }
type PreviewPayload = { data?: DeviceImportPreview } & ApiError
type ResultPayload = { data?: DeviceImportResult } & ApiError

type BlockedReason = {
  key: string
  action: 'ERROR' | 'CONFLICT'
  message: string
  count: number
}

type BlockedReview = {
  total: number
  filteredTotal: number
  offset: number
  limit: number
  reasons: BlockedReason[]
  rows: DeviceImportPreviewRow[]
}

type BlockedPayload = { data?: BlockedReview } & ApiError
type RepairPayload = { data?: { affected: number } } & ApiError

type RepairField = 'platform' | 'managementAddress' | 'name' | 'hostname' | 'serialNumber' | 'externalId' | 'notes'

const REPAIR_FIELDS: Array<{ value: RepairField; label: string }> = [
  { value: 'platform', label: 'Software Platform' },
  { value: 'managementAddress', label: 'Management Address' },
  { value: 'name', label: 'Device name' },
  { value: 'hostname', label: 'Hostname' },
  { value: 'serialNumber', label: 'Serial number' },
  { value: 'externalId', label: 'External ID' },
  { value: 'notes', label: 'Notes' },
]

function platformChoices(message: string) {
  const match = message.match(/supports multiple platforms \(([^)]+)\)/i)
  if (!match) return []
  return [...new Set(match[1].split(',').map((value) => value.trim()).filter(Boolean))]
}

function inferredRepairField(message: string): RepairField {
  if (/^managementAddress:/i.test(message)) return 'managementAddress'
  if (/Device platform is required/i.test(message) || /^platform:/i.test(message)) return 'platform'
  if (/^name:/i.test(message)) return 'name'
  if (/^hostname:/i.test(message)) return 'hostname'
  if (/^serialNumber:/i.test(message)) return 'serialNumber'
  if (/^externalId:/i.test(message)) return 'externalId'
  return 'managementAddress'
}

export function DeviceImportPublicationControl({ batchId }: { batchId: string }) {
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null)
  const [result, setResult] = useState<DeviceImportResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'valid' | 'all' | null>(null)
  const [blockedBusy, setBlockedBusy] = useState(false)
  const [repairBusy, setRepairBusy] = useState(false)
  const [blockedReview, setBlockedReview] = useState<BlockedReview | null>(null)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [reasonQuery, setReasonQuery] = useState('')
  const [selectedRows, setSelectedRows] = useState<number[]>([])
  const [repairField, setRepairField] = useState<RepairField>('managementAddress')
  const [repairValue, setRepairValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function requestValidation() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/validate`, { method: 'POST' })
    const payload = await response.json() as PreviewPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Device validation failed.')
    return payload.data
  }

  async function requestBlocked(offset = 0, reason: string | null = blockedReason) {
    const params = new URLSearchParams({ offset: String(offset), limit: '50' })
    if (reason) params.set('reason', reason)
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/blocked?${params.toString()}`)
    const payload = await response.json() as BlockedPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The blocked devices could not be loaded.')
    return payload.data
  }

  async function validate() {
    setBusy('validate')
    setError(null)
    setNotice(null)
    setResult(null)
    setBlockedReview(null)
    setBlockedReason(null)
    setSelectedRows([])
    try {
      setPreview(await requestValidation())
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Device validation failed.')
    } finally {
      setBusy(null)
    }
  }

  async function loadBlocked(offset = 0, reason: string | null = blockedReason) {
    setBlockedBusy(true)
    setError(null)
    setSelectedRows([])
    try {
      const data = await requestBlocked(offset, reason)
      setBlockedReview(data)
      setBlockedReason(reason)
      if (reason) {
        const selectedReason = data.reasons.find((item) => item.key === reason)
        if (selectedReason) setRepairField(inferredRepairField(selectedReason.message))
      }
      return data
    } catch (blockedError) {
      setError(blockedError instanceof Error ? blockedError.message : 'The blocked devices could not be loaded.')
      return null
    } finally {
      setBlockedBusy(false)
    }
  }

  async function refreshAfterRepair(previousReason: string | null) {
    const nextPreview = await requestValidation()
    setPreview(nextPreview)
    const remaining = nextPreview.counts.error + nextPreview.counts.conflict
    if (!remaining) {
      setBlockedReview(null)
      setBlockedReason(null)
      return
    }
    if (previousReason) {
      const sameReason = await requestBlocked(0, previousReason)
      if (sameReason.filteredTotal > 0) {
        setBlockedReview(sameReason)
        setBlockedReason(previousReason)
        return
      }
    }
    setBlockedReview(await requestBlocked(0, null))
    setBlockedReason(null)
  }

  async function repair(body: Record<string, unknown>, success: string) {
    setRepairBusy(true)
    setError(null)
    setNotice(null)
    const previousReason = blockedReason
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/blocked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as RepairPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The blocked rows could not be repaired.')
      setNotice(`${success} ${payload.data.affected.toLocaleString()} staged row${payload.data.affected === 1 ? '' : 's'} updated.`)
      setSelectedRows([])
      await refreshAfterRepair(previousReason)
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : 'The blocked rows could not be repaired.')
    } finally {
      setRepairBusy(false)
    }
  }

  async function publish(mode: 'VALID' | 'ALL') {
    setBusy(mode === 'VALID' ? 'valid' : 'all')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const payload = await response.json() as ResultPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The devices could not be imported.')
      setResult(payload.data)
      setPreview(null)
      window.location.reload()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'The devices could not be imported.')
    } finally {
      setBusy(null)
    }
  }

  const blockers = preview ? preview.counts.error + preview.counts.conflict : 0
  const valid = preview?.counts.importable ?? 0
  const blockedEnd = blockedReview ? Math.min(blockedReview.offset + blockedReview.rows.length, blockedReview.filteredTotal) : 0
  const selectedReason = blockedReview?.reasons.find((reason) => reason.key === blockedReason) ?? null
  const selectedPlatforms = selectedReason ? platformChoices(selectedReason.message) : []
  const selectedPageRows = blockedReview?.rows.map((row) => row.rowNumber) ?? []
  const allPageSelected = selectedPageRows.length > 0 && selectedPageRows.every((row) => selectedRows.includes(row))
  const scopedPlatformRow = selectedRows.length === 1
    ? blockedReview?.rows.find((row) => row.rowNumber === selectedRows[0]) ?? null
    : null
  const filteredReasons = useMemo(() => {
    if (!blockedReview) return []
    const query = reasonQuery.trim().toLocaleLowerCase('en-US')
    if (!query) return blockedReview.reasons
    return blockedReview.reasons.filter((reason) => `${reason.action} ${reason.message}`.toLocaleLowerCase('en-US').includes(query))
  }, [blockedReview, reasonQuery])

  function toggleRow(rowNumber: number) {
    setSelectedRows((current) => current.includes(rowNumber)
      ? current.filter((row) => row !== rowNumber)
      : [...current, rowNumber])
  }

  function togglePage() {
    setSelectedRows((current) => allPageSelected
      ? current.filter((row) => !selectedPageRows.includes(row))
      : [...new Set([...current, ...selectedPageRows])])
  }

  return <section className="mb-5 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-light)]">Device publication</div>
        <h2 className="mt-1 text-base font-semibold">Validate, repair blockers, then import what is ready</h2>
        <p className="mt-2 text-sm text-[var(--muted-strong)]">
          <strong>STAGED</strong> means a source row is still quarantined in this import batch; it is not an inventory device yet.
          Blocked rows can be repaired or excluded here. You do not have to hunt through the sample Device table below.
        </p>
      </div>
      <Button type="button" variant="ghost" disabled={Boolean(busy) || repairBusy} onClick={() => void validate()}>
        {busy === 'validate' ? 'Validating…' : preview ? 'Validate again' : 'Validate remaining devices'}
      </Button>
    </div>

    {error ? <div className="mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-3 py-2 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mt-4 rounded-md border border-[#285f48] bg-[#142b22] px-3 py-2 text-sm text-[#a9e8c6]">{notice}</div> : null}

    {preview ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <strong>{valid.toLocaleString()} ready to import</strong>
        <span>Create {preview.counts.create.toLocaleString()}</span>
        <span>Update {preview.counts.update.toLocaleString()}</span>
        <span>Unchanged {preview.counts.unchanged.toLocaleString()}</span>
        <span>Conflicts {preview.counts.conflict.toLocaleString()}</span>
        <span>Errors {preview.counts.error.toLocaleString()}</span>
      </div>

      {blockers ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-amber-200">
          {blockers.toLocaleString()} blocked row{blockers === 1 ? '' : 's'} remain staged. Open the repair workspace to fix a whole error class or selected rows.
        </p>
        <Button type="button" variant="ghost" disabled={blockedBusy || Boolean(busy) || repairBusy} onClick={() => void loadBlocked(0, null)}>
          {blockedBusy && !blockedReview ? 'Loading blocked devices…' : `Repair ${blockers.toLocaleString()} blocked devices`}
        </Button>
      </div> : <p className="mt-3 text-sm text-[var(--accent-light)]">No blocking rows remain. The full remaining batch can be published.</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {valid > 0 ? <Button type="button" variant="primary" disabled={Boolean(busy) || repairBusy} onClick={() => void publish('VALID')}>
          {busy === 'valid' ? 'Importing in safe chunks…' : `Import ${valid.toLocaleString()} valid device${valid === 1 ? '' : 's'} now`}
        </Button> : null}
        <Button type="button" variant={blockers ? 'ghost' : 'primary'} disabled={Boolean(busy) || repairBusy || blockers > 0} onClick={() => void publish('ALL')}>
          {busy === 'all' ? 'Publishing…' : 'Publish all remaining devices'}
        </Button>
      </div>
    </div> : null}

    {blockedReview ? <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Blocked-device repair workspace</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Choose a reason group to get the relevant bulk repair. You can also select individual rows, edit a field, or exclude those rows from this import.</p>
        </div>
        <Button type="button" variant="ghost" disabled={blockedBusy || repairBusy} onClick={() => void loadBlocked(blockedReview.offset, blockedReason)}>{blockedBusy ? 'Refreshing…' : 'Refresh blockers'}</Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <div className="rounded-md border border-[var(--border)] p-3">
          <div className="flex items-center justify-between gap-2"><strong className="text-xs">Reason groups ({blockedReview.reasons.length.toLocaleString()})</strong><button type="button" className="text-xs text-[var(--accent-light)]" onClick={() => void loadBlocked(0, null)}>All blocked</button></div>
          <TextInput className="mt-2" value={reasonQuery} placeholder="Search all blocker reasons…" onChange={(event) => setReasonQuery(event.target.value)} />
          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
            {filteredReasons.map((reason) => <button key={reason.key} type="button" className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs ${blockedReason === reason.key ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'border-[var(--border)] text-[var(--muted-strong)] hover:border-[var(--border-strong)]'}`} disabled={blockedBusy || repairBusy} onClick={() => void loadBlocked(0, reason.key)} title={reason.message}>
              <div><strong>{reason.action}</strong> · {reason.count.toLocaleString()}</div>
              <div className="mt-1 break-words">{reason.message}</div>
            </button>)}
            {!filteredReasons.length ? <div className="py-3 text-center text-xs text-[var(--muted)]">No blocker reason matches this search.</div> : null}
          </div>
        </div>

        <div className="rounded-md border border-[var(--border)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-light)]">Repair actions</div>
          {selectedReason ? <>
            <div className="mt-2 text-sm font-semibold">{selectedReason.count.toLocaleString()} row{selectedReason.count === 1 ? '' : 's'} · {selectedReason.message}</div>

            {/^managementAddress:/i.test(selectedReason.message) ? <div className="mt-3 rounded-md border border-[#315d82] bg-[#122131] p-3">
              <div className="text-sm font-semibold">Invalid Management Address values</div>
              <p className="mt-1 text-xs text-[var(--muted-strong)]">These source values cannot fit the inventory field. Clearing them keeps the device importable without inventing or truncating an address.</p>
              <Button className="mt-3" type="button" variant="primary" disabled={repairBusy} onClick={() => void repair({ scope: 'INVALID_MANAGEMENT_ADDRESS', action: 'CLEAR_FIELD' }, 'Cleared invalid Management Address on')}>{repairBusy ? 'Repairing…' : 'Clear every overlength Management Address'}</Button>
            </div> : null}

            {selectedPlatforms.length ? <div className="mt-3 rounded-md border border-[#315d82] bg-[#122131] p-3">
              <div className="text-sm font-semibold">Choose platform by customer or site</div>
              <p className="mt-1 text-xs text-[var(--muted-strong)]">This model supports multiple platforms, so there is deliberately no model-wide choice. Select exactly one representative device below, then apply the platform to that model for its Site or Customer.</p>
              {scopedPlatformRow ? <div className="mt-2 text-xs text-[var(--muted-strong)]">Selected: <strong>{scopedPlatformRow.identity}</strong> · {scopedPlatformRow.customer ?? 'Unknown customer'}{scopedPlatformRow.site ? ` / ${scopedPlatformRow.site}` : ''}</div> : <div className="mt-2 text-xs text-amber-200">Select exactly one row from the table below to choose the customer/site scope.</div>}
              <div className="mt-3 flex flex-wrap gap-2">{selectedPlatforms.flatMap((platform) => [
                <Button key={`${platform}-site`} type="button" variant="primary" disabled={repairBusy || !scopedPlatformRow?.site} onClick={() => void repair({ scope: 'SAME_SITE_MODEL_AS_ROW', action: 'SET_FIELD', editField: 'platform', editValue: platform, sampleRowNumber: scopedPlatformRow?.rowNumber }, `Set ${platform} for this site/model on`)}>{repairBusy ? 'Applying…' : `Use ${platform} for this site`}</Button>,
                <Button key={`${platform}-customer`} type="button" variant="secondary" disabled={repairBusy || !scopedPlatformRow?.customer} onClick={() => void repair({ scope: 'SAME_CUSTOMER_MODEL_AS_ROW', action: 'SET_FIELD', editField: 'platform', editValue: platform, sampleRowNumber: scopedPlatformRow?.rowNumber }, `Set ${platform} for this customer/model on`)}>{repairBusy ? 'Applying…' : `Use ${platform} for this customer`}</Button>,
              ])}</div>
            </div> : null}
          </> : <p className="mt-2 text-sm text-[var(--muted)]">Select a reason group on the left for bulk-fix options. The table below still supports row-level repair.</p>}

          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs"><strong>{selectedRows.length.toLocaleString()} row{selectedRows.length === 1 ? '' : 's'} selected</strong><button type="button" className="text-[var(--accent-light)]" disabled={!selectedPageRows.length} onClick={togglePage}>{allPageSelected ? 'Clear current page' : 'Select current page'}</button></div>
            <div className="mt-3 grid gap-2 lg:grid-cols-[190px_minmax(220px,1fr)_auto_auto_auto]">
              <SelectInput value={repairField} disabled={repairBusy} onChange={(event) => setRepairField(event.target.value as RepairField)}>{REPAIR_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</SelectInput>
              <TextInput value={repairValue} disabled={repairBusy} placeholder={`New ${REPAIR_FIELDS.find((field) => field.value === repairField)?.label ?? 'value'}…`} onChange={(event) => setRepairValue(event.target.value)} />
              <Button type="button" variant="secondary" disabled={repairBusy || !selectedRows.length || !repairValue.trim()} onClick={() => void repair({ scope: 'ROWS', action: 'SET_FIELD', editField: repairField, editValue: repairValue, rowNumbers: selectedRows }, `Updated ${repairField} on`)}>Set value</Button>
              <Button type="button" variant="ghost" disabled={repairBusy || !selectedRows.length} onClick={() => void repair({ scope: 'ROWS', action: 'CLEAR_FIELD', editField: repairField, rowNumbers: selectedRows }, `Cleared ${repairField} on`)}>Clear field</Button>
              <Button type="button" variant="ghost" disabled={repairBusy || !selectedRows.length} onClick={() => void repair({ scope: 'ROWS', action: 'EXCLUDE', rowNumbers: selectedRows }, 'Excluded')}>Exclude selected</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-xs">
          <thead><tr className="border-b border-[var(--border)] uppercase tracking-wide text-[var(--muted)]"><th className="w-10 p-2"><input type="checkbox" checked={allPageSelected} onChange={togglePage} aria-label="Select current blocked page" /></th><th className="p-2">Row</th><th className="p-2">Device</th><th className="p-2">State</th><th className="p-2">Customer / Site</th><th className="p-2">Model / Firmware</th><th className="p-2">Why blocked</th></tr></thead>
          <tbody>{blockedReview.rows.map((row) => <tr key={row.rowNumber} className="border-b border-[var(--border)] align-top">
            <td className="p-2"><input type="checkbox" checked={selectedRows.includes(row.rowNumber)} onChange={() => toggleRow(row.rowNumber)} aria-label={`Select row ${row.rowNumber}`} /></td>
            <td className="p-2 font-mono">{row.rowNumber}</td>
            <td className="p-2 font-semibold">{row.identity}</td>
            <td className="p-2"><span className={row.action === 'CONFLICT' ? 'text-amber-200' : 'text-[#f0b0b0]'}>{row.action}</span></td>
            <td className="p-2"><div>{row.customer ?? '—'}</div><div className="mt-1 text-[var(--muted)]">{row.site ?? '—'}</div></td>
            <td className="p-2"><div>{row.model ?? '—'}</div><div className="mt-1 font-mono text-[var(--muted)]">{row.currentFirmware ?? '—'}</div></td>
            <td className="p-2 text-[var(--muted-strong)]">{row.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join(' · ') || 'No detailed reason was returned.'}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>{blockedReview.filteredTotal ? `Showing ${blockedReview.offset + 1}-${blockedEnd} of ${blockedReview.filteredTotal.toLocaleString()}${blockedReason ? ' for this reason' : ''}` : 'No blocked rows match this reason.'}</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={blockedBusy || repairBusy || blockedReview.offset === 0} onClick={() => void loadBlocked(Math.max(0, blockedReview.offset - blockedReview.limit), blockedReason)}>Previous</Button>
          <Button type="button" variant="ghost" disabled={blockedBusy || repairBusy || blockedReview.offset + blockedReview.limit >= blockedReview.filteredTotal} onClick={() => void loadBlocked(blockedReview.offset + blockedReview.limit, blockedReason)}>Next</Button>
        </div>
      </div>
    </div> : null}

    {result ? <div className="mt-4 text-sm text-[var(--accent-light)]">Imported {result.created.toLocaleString()} new · {result.updated.toLocaleString()} updated.</div> : null}
  </section>
}
