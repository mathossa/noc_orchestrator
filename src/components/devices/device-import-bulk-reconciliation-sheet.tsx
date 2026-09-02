'use client'

import { useMemo, useState } from 'react'
import { SearchableReferencePicker, type SearchableReferenceOption } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { DeviceImportReferenceKind } from '@/lib/device-import'

type ApiError = { error?: { message?: string } }
type ReferenceMetadata = {
  customerSourceValue?: string | null
  customerTargetId?: string | null
  vendorSourceValue?: string | null
  vendorTargetId?: string | null
  deviceTypeSourceValue?: string | null
  deviceTypeTargetId?: string | null
  modelSourceValue?: string | null
  modelTargetId?: string | null
  platform?: string | null
  platforms?: string[]
  waitingFor?: DeviceImportReferenceKind[]
}
type Reference = {
  id: string
  kind: DeviceImportReferenceKind
  sourceValue: string
  status: 'UNRESOLVED' | 'WAITING' | 'LINKED'
  occurrenceCount: number
  suggestedTargetId?: string | null
  suggestedTargetLabel?: string | null
  suggestionScore?: number | null
  metadata: ReferenceMetadata
}
type OptionRecord = { id: string; code?: string | null; name: string; isActive: boolean }
type SiteRecord = OptionRecord & { customerId: string }
type ModelRecord = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId?: string | null
  model: string
  platform: string | null
  isActive: boolean
  vendor: { id: string; code?: string; name: string }
  deviceType: { id: string; code?: string; name: string }
}
type FirmwareRecord = {
  id: string
  vendorId: string
  platform: string
  version: string
  isActive: boolean
  vendor: { id: string; code?: string; name: string }
}
type Family = { id: string; vendorId: string; name: string; isActive: boolean }
type LinkedModel = {
  id: string
  vendorId: string
  familyId: string | null
  model: string
  platform: string | null
  supportedPlatforms: Array<{ id: string; platform: string }>
  vendor: { id: string; code: string; name: string }
  proposedNewFamilyName: string | null
}
type Assist = {
  workspace: {
    batch: { status: string }
    counts: { references: { unresolved: number } }
    references: Reference[]
    options: {
      customers: OptionRecord[]
      sites: SiteRecord[]
      vendors: OptionRecord[]
      deviceTypes: OptionRecord[]
      models: ModelRecord[]
      contracts: OptionRecord[]
      firmwareReleases: FirmwareRecord[]
    }
  }
  models: { linkedModels: LinkedModel[]; families: Family[] }
}
type AssistPayload = { data?: Assist } & ApiError

type Decision = 'REVIEW' | 'LINK' | 'CREATE'
type Draft = {
  decision: Decision
  targetId: string
  name: string
  code: string
  customerId: string
  vendorId: string
  deviceTypeId: string
  modelId: string
  model: string
  platform: string
  platforms: string
  familyId: string
  newFamilyName: string
  version: string
  status: string
}
type FamilyDecision = 'REVIEW' | 'ASSIGN' | 'CREATE'
type FamilyDraft = { decision: FamilyDecision; familyId: string; name: string }
type ApplyFailure = { key: string; message: string }
type ApplyPayload = {
  data?: { applied: number; failed: number; remaining: number; failures: ApplyFailure[] }
} & ApiError

type FilterKind = 'ALL' | DeviceImportReferenceKind | 'FAMILY'

const PAGE_SIZE = 50

const KIND_LABELS: Record<DeviceImportReferenceKind, string> = {
  CUSTOMER: 'Customer',
  SITE: 'Site',
  VENDOR: 'Vendor',
  DEVICE_TYPE: 'Device Type',
  DEVICE_MODEL: 'Device Model',
  FIRMWARE_RELEASE: 'Firmware Release',
  CONTRACT_TYPE: 'Contract Type',
}

const FILTER_ORDER: FilterKind[] = [
  'ALL', 'CUSTOMER', 'SITE', 'VENDOR', 'DEVICE_TYPE', 'DEVICE_MODEL', 'FIRMWARE_RELEASE', 'CONTRACT_TYPE', 'FAMILY',
]

function compact(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
}

function suggestedCode(value: string, separator: '_' | '-' = '_') {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
    .slice(0, 40) || 'IMPORT'
}

function likelyVendor(reference: Reference, vendors: OptionRecord[]) {
  if (reference.metadata.vendorTargetId) return reference.metadata.vendorTargetId
  const source = compact(reference.sourceValue)
  const matches = vendors.filter((vendor) => {
    const name = compact(vendor.name)
    const code = compact(vendor.code)
    return (name && source.startsWith(name)) || (code && source.startsWith(code))
  })
  return matches.length === 1 ? matches[0].id : ''
}

function seedDraft(reference: Reference, assist: Assist): Draft {
  const vendorId = likelyVendor(reference, assist.workspace.options.vendors.filter((item) => item.isActive))
  const platform = reference.metadata.platform ?? (reference.metadata.platforms?.length === 1 ? reference.metadata.platforms[0] : '')
  return {
    decision: 'REVIEW',
    targetId: reference.suggestedTargetId ?? '',
    name: reference.sourceValue,
    code: suggestedCode(reference.sourceValue, reference.kind === 'SITE' ? '-' : '_'),
    customerId: reference.metadata.customerTargetId ?? '',
    vendorId,
    deviceTypeId: reference.metadata.deviceTypeTargetId ?? '',
    modelId: reference.metadata.modelTargetId ?? '',
    model: reference.sourceValue,
    platform,
    platforms: reference.metadata.platforms?.join(', ') ?? (platform ? platform : ''),
    familyId: '',
    newFamilyName: '',
    version: reference.sourceValue,
    status: 'AVAILABLE',
  }
}

function fieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-0 text-xs font-semibold text-[var(--muted-strong)]">
    <span className="mb-1 block">{label}</span>
    {children}
  </label>
}

function searchableOptions(records: OptionRecord[]) {
  return records.filter((record) => record.isActive).map((record) => ({
    id: record.id,
    label: `${record.name}${record.code ? ` (${record.code})` : ''}`,
    keywords: [record.name, record.code ?? ''],
  }))
}

function waitingText(reference: Reference) {
  const waiting = reference.metadata.waitingFor ?? []
  return waiting.length ? `Waiting for ${waiting.map((kind) => KIND_LABELS[kind]).join(' + ')}` : null
}

function isCreateReady(reference: Reference) {
  if (reference.status === 'WAITING') return false
  if (['CUSTOMER', 'VENDOR', 'DEVICE_TYPE', 'CONTRACT_TYPE'].includes(reference.kind)) return true
  if (reference.kind === 'SITE') return Boolean(reference.metadata.customerTargetId)
  if (reference.kind === 'DEVICE_MODEL') return Boolean(reference.metadata.vendorTargetId && reference.metadata.deviceTypeTargetId)
  return Boolean(reference.metadata.modelTargetId && reference.metadata.vendorTargetId && reference.metadata.platform)
}

function draftError(reference: Reference, draft: Draft) {
  if (draft.decision === 'REVIEW') return null
  if (draft.decision === 'LINK') return draft.targetId ? null : 'Choose the existing target.'
  if (['CUSTOMER', 'VENDOR', 'DEVICE_TYPE', 'CONTRACT_TYPE'].includes(reference.kind)) {
    return draft.name.trim() && draft.code.trim() ? null : 'Name and code are required.'
  }
  if (reference.kind === 'SITE') {
    if (!draft.customerId) return 'Choose the Customer.'
    return draft.name.trim() && draft.code.trim() ? null : 'Site name and code are required.'
  }
  if (reference.kind === 'DEVICE_MODEL') {
    if (!draft.vendorId || !draft.deviceTypeId) return 'Choose Vendor and Device Type.'
    if (!draft.model.trim()) return 'Concrete Model is required.'
    if (draft.familyId && draft.newFamilyName.trim()) return 'Choose an existing Family or enter a new Family name, not both.'
    return null
  }
  if (!draft.vendorId || !draft.modelId || !draft.platform.trim()) return 'Choose Vendor, Model and Platform.'
  return draft.version.trim() ? null : 'Firmware version is required.'
}

function contextSummary(reference: Reference, assist: Assist) {
  const { customers, vendors, deviceTypes, models } = assist.workspace.options
  if (reference.kind === 'SITE') {
    const customer = customers.find((item) => item.id === reference.metadata.customerTargetId)
    return customer ? customer.name : waitingText(reference) ?? 'Customer not resolved'
  }
  if (reference.kind === 'DEVICE_MODEL') {
    const vendor = vendors.find((item) => item.id === reference.metadata.vendorTargetId)
    const type = deviceTypes.find((item) => item.id === reference.metadata.deviceTypeTargetId)
    return [vendor?.name ?? reference.metadata.vendorSourceValue, type?.name ?? reference.metadata.deviceTypeSourceValue].filter(Boolean).join(' · ') || waitingText(reference) || 'Context not resolved'
  }
  if (reference.kind === 'FIRMWARE_RELEASE') {
    const model = models.find((item) => item.id === reference.metadata.modelTargetId)
    return [model?.model ?? reference.metadata.modelSourceValue, reference.metadata.platform].filter(Boolean).join(' · ') || waitingText(reference) || 'Model not resolved'
  }
  return waitingText(reference) ?? 'Independent reference'
}

export function DeviceImportBulkReconciliationSheet({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false)
  const [assist, setAssist] = useState<Assist | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [familyDrafts, setFamilyDrafts] = useState<Record<string, FamilyDraft>>({})
  const [filterKind, setFilterKind] = useState<FilterKind>('ALL')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [rememberLinks, setRememberLinks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [appliedSinceOpen, setAppliedSinceOpen] = useState(false)

  async function load() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Reconciliation data could not be loaded.')
    setAssist(payload.data)
    return payload.data
  }

  async function openSheet() {
    setOpen(true)
    setError(null)
    if (assist) return
    try {
      await load()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Reconciliation data could not be loaded.')
    }
  }

  function closeSheet() {
    if (busy) return
    if (appliedSinceOpen) {
      window.location.reload()
      return
    }
    setOpen(false)
  }

  const references = useMemo(() => assist?.workspace.references.filter((reference) => reference.status !== 'LINKED') ?? [], [assist])
  const familyTasks = useMemo(() => assist?.models.linkedModels.filter((model) => !model.familyId) ?? [], [assist])

  const filteredReferences = useMemo(() => {
    if (filterKind === 'FAMILY') return []
    const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
    return references.filter((reference) => {
      if (filterKind !== 'ALL' && reference.kind !== filterKind) return false
      if (!normalizedQuery) return true
      const haystack = `${KIND_LABELS[reference.kind]} ${reference.sourceValue} ${contextSummary(reference, assist!)}`.toLocaleLowerCase('en-US')
      return normalizedQuery.split(/\s+/g).every((term) => haystack.includes(term))
    })
  }, [assist, filterKind, query, references])

  const filteredFamilyTasks = useMemo(() => {
    if (filterKind !== 'FAMILY') return []
    const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
    return familyTasks.filter((model) => !normalizedQuery || `${model.vendor.name} ${model.model} ${model.proposedNewFamilyName ?? ''}`.toLocaleLowerCase('en-US').includes(normalizedQuery))
  }, [familyTasks, filterKind, query])

  const pageCount = Math.max(1, Math.ceil(filteredReferences.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleReferences = filteredReferences.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function getDraft(reference: Reference) {
    if (!assist) throw new Error('Reconciliation data is not loaded.')
    return drafts[reference.id] ?? seedDraft(reference, assist)
  }

  function patchDraft(reference: Reference, values: Partial<Draft>) {
    if (!assist) return
    setDrafts((current) => ({ ...current, [reference.id]: { ...(current[reference.id] ?? seedDraft(reference, assist)), ...values } }))
    setFailures((current) => {
      if (!current[reference.id]) return current
      const next = { ...current }
      delete next[reference.id]
      return next
    })
  }

  function setDecision(reference: Reference, decision: Decision) {
    const seed = getDraft(reference)
    patchDraft(reference, {
      decision,
      targetId: decision === 'LINK' ? seed.targetId || reference.suggestedTargetId || '' : seed.targetId,
    })
  }

  function patchFamily(model: LinkedModel, values: Partial<FamilyDraft>) {
    setFamilyDrafts((current) => ({
      ...current,
      [model.id]: {
        decision: 'REVIEW',
        familyId: '',
        name: model.proposedNewFamilyName ?? '',
        ...(current[model.id] ?? {}),
        ...values,
      },
    }))
    setFailures((current) => {
      const key = `family:${model.id}`
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function changeFilter(next: FilterKind) {
    setFilterKind(next)
    setPage(0)
  }

  function prepareCreateReady() {
    if (!assist) return
    const candidates = filteredReferences.filter(isCreateReady)
    setDrafts((current) => {
      const next = { ...current }
      for (const reference of candidates) {
        const draft = next[reference.id] ?? seedDraft(reference, assist)
        if (draft.decision === 'REVIEW') next[reference.id] = { ...draft, decision: 'CREATE' }
      }
      return next
    })
  }

  function clearPrepared() {
    setDrafts({})
    setFamilyDrafts({})
    setFailures({})
    setResultMessage(null)
  }

  const preparedReferences = references.filter((reference) => drafts[reference.id]?.decision && drafts[reference.id].decision !== 'REVIEW')
  const preparedFamilies = familyTasks.filter((model) => familyDrafts[model.id]?.decision && familyDrafts[model.id].decision !== 'REVIEW')
  const validationErrors = [
    ...preparedReferences.flatMap((reference) => {
      const message = draftError(reference, drafts[reference.id])
      return message ? [{ key: reference.id, message }] : []
    }),
    ...preparedFamilies.flatMap((model) => {
      const draft = familyDrafts[model.id]
      if (draft.decision === 'ASSIGN' && !draft.familyId) return [{ key: `family:${model.id}`, message: 'Choose an existing Family.' }]
      if (draft.decision === 'CREATE' && !draft.name.trim()) return [{ key: `family:${model.id}`, message: 'Enter the new Family name.' }]
      return []
    }),
  ]
  const preparedCount = preparedReferences.length + preparedFamilies.length

  function linkOptions(reference: Reference, draft: Draft): SearchableReferenceOption[] {
    if (!assist) return []
    const options = assist.workspace.options
    if (reference.kind === 'CUSTOMER') return searchableOptions(options.customers)
    if (reference.kind === 'VENDOR') return searchableOptions(options.vendors)
    if (reference.kind === 'DEVICE_TYPE') return searchableOptions(options.deviceTypes)
    if (reference.kind === 'CONTRACT_TYPE') return searchableOptions(options.contracts)
    if (reference.kind === 'SITE') {
      const customerId = draft.customerId || reference.metadata.customerTargetId
      return options.sites.filter((site) => site.isActive && (!customerId || site.customerId === customerId)).map((site) => ({ id: site.id, label: `${site.name}${site.code ? ` (${site.code})` : ''}`, keywords: [site.name, site.code ?? ''] }))
    }
    if (reference.kind === 'DEVICE_MODEL') {
      const vendorId = draft.vendorId || reference.metadata.vendorTargetId
      const typeId = draft.deviceTypeId || reference.metadata.deviceTypeTargetId
      return options.models.filter((model) => model.isActive && (!vendorId || model.vendorId === vendorId) && (!typeId || model.deviceTypeId === typeId)).map((model) => ({
        id: model.id,
        label: `${model.vendor.name} · ${model.model} · ${model.deviceType.name}`,
        keywords: [model.model, model.vendor.name, model.deviceType.name, model.platform ?? ''],
      }))
    }
    const vendorId = draft.vendorId || reference.metadata.vendorTargetId
    const platform = draft.platform || reference.metadata.platform
    return options.firmwareReleases.filter((release) => release.isActive && (!vendorId || release.vendorId === vendorId) && (!platform || compact(release.platform) === compact(platform))).map((release) => ({
      id: release.id,
      label: `${release.vendor.name} · ${release.platform} · ${release.version}`,
      keywords: [release.version, release.platform, release.vendor.name],
    }))
  }

  function createFields(reference: Reference, draft: Draft) {
    if (!assist) return null
    const options = assist.workspace.options
    const customerOptions = searchableOptions(options.customers)
    const vendorOptions = searchableOptions(options.vendors)
    const typeOptions = searchableOptions(options.deviceTypes)
    const modelOptions = options.models.filter((model) => model.isActive && (!draft.vendorId || model.vendorId === draft.vendorId)).map((model) => ({
      id: model.id,
      label: `${model.vendor.name} · ${model.model} · ${model.deviceType.name}`,
      keywords: [model.model, model.vendor.name, model.deviceType.name, model.platform ?? ''],
    }))
    const familyOptions = assist.models.families.filter((family) => family.isActive && (!draft.vendorId || family.vendorId === draft.vendorId)).map((family) => ({ id: family.id, label: family.name, keywords: [family.name] }))

    if (['CUSTOMER', 'VENDOR', 'DEVICE_TYPE', 'CONTRACT_TYPE'].includes(reference.kind)) {
      return <div className="grid gap-3 md:grid-cols-2">
        {fieldLabel({ label: 'Canonical name', children: <TextInput value={draft.name} disabled={busy} onChange={(event) => patchDraft(reference, { name: event.target.value })} /> })}
        {fieldLabel({ label: 'Code', children: <TextInput value={draft.code} disabled={busy} onChange={(event) => patchDraft(reference, { code: event.target.value })} /> })}
      </div>
    }

    if (reference.kind === 'SITE') {
      return <div className="grid gap-3 md:grid-cols-3">
        {fieldLabel({ label: 'Customer', children: <SearchableReferencePicker id={`bulk-customer-${reference.id}`} value={draft.customerId} options={customerOptions} disabled={busy} placeholder="Choose Customer…" onChange={(value) => patchDraft(reference, { customerId: value })} /> })}
        {fieldLabel({ label: 'Site name', children: <TextInput value={draft.name} disabled={busy} onChange={(event) => patchDraft(reference, { name: event.target.value })} /> })}
        {fieldLabel({ label: 'Site code', children: <TextInput value={draft.code} disabled={busy} onChange={(event) => patchDraft(reference, { code: event.target.value })} /> })}
      </div>
    }

    if (reference.kind === 'DEVICE_MODEL') {
      return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {fieldLabel({ label: 'Vendor', children: <SearchableReferencePicker id={`bulk-vendor-${reference.id}`} value={draft.vendorId} options={vendorOptions} disabled={busy} placeholder="Choose Vendor…" onChange={(value) => patchDraft(reference, { vendorId: value, familyId: '' })} /> })}
        {fieldLabel({ label: 'Device Type', children: <SearchableReferencePicker id={`bulk-type-${reference.id}`} value={draft.deviceTypeId} options={typeOptions} disabled={busy} placeholder="Choose Device Type…" onChange={(value) => patchDraft(reference, { deviceTypeId: value })} /> })}
        {fieldLabel({ label: 'Concrete Model', children: <TextInput value={draft.model} disabled={busy} onChange={(event) => patchDraft(reference, { model: event.target.value })} /> })}
        {fieldLabel({ label: 'Preferred platform', children: <TextInput value={draft.platform} disabled={busy} placeholder="Optional" onChange={(event) => patchDraft(reference, { platform: event.target.value })} /> })}
        {fieldLabel({ label: 'Supported platforms', children: <TextInput value={draft.platforms} disabled={busy} placeholder="e.g. AOS-8, AOS-10" onChange={(event) => patchDraft(reference, { platforms: event.target.value })} /> })}
        {fieldLabel({ label: 'Existing Family', children: <SearchableReferencePicker id={`bulk-family-${reference.id}`} value={draft.familyId} options={familyOptions} disabled={busy || Boolean(draft.newFamilyName.trim())} placeholder="Optional existing Family…" onChange={(value) => patchDraft(reference, { familyId: value })} /> })}
        {fieldLabel({ label: 'Or create Family', children: <TextInput value={draft.newFamilyName} disabled={busy || Boolean(draft.familyId)} placeholder="Optional new Family name" onChange={(event) => patchDraft(reference, { newFamilyName: event.target.value })} /> })}
      </div>
    }

    return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {fieldLabel({ label: 'Vendor', children: <SearchableReferencePicker id={`bulk-fw-vendor-${reference.id}`} value={draft.vendorId} options={vendorOptions} disabled={busy} placeholder="Choose Vendor…" onChange={(value) => patchDraft(reference, { vendorId: value, modelId: '' })} /> })}
      {fieldLabel({ label: 'Device Model', children: <SearchableReferencePicker id={`bulk-fw-model-${reference.id}`} value={draft.modelId} options={modelOptions} disabled={busy} placeholder="Choose Model…" onChange={(value) => {
        const model = options.models.find((item) => item.id === value)
        patchDraft(reference, { modelId: value, vendorId: model?.vendorId ?? draft.vendorId, platform: model?.platform ?? draft.platform })
      }} /> })}
      {fieldLabel({ label: 'Platform', children: <TextInput value={draft.platform} disabled={busy} onChange={(event) => patchDraft(reference, { platform: event.target.value })} /> })}
      {fieldLabel({ label: 'Version', children: <TextInput value={draft.version} disabled={busy} onChange={(event) => patchDraft(reference, { version: event.target.value })} /> })}
      {fieldLabel({ label: 'Status', children: <SelectInput value={draft.status} disabled={busy} onChange={(event) => patchDraft(reference, { status: event.target.value })}><option value="AVAILABLE">AVAILABLE</option><option value="RECOMMENDED">RECOMMENDED</option><option value="DEFERRED">DEFERRED</option><option value="WITHDRAWN">WITHDRAWN</option></SelectInput> })}
    </div>
  }

  async function applyPrepared() {
    if (!assist || !preparedCount || validationErrors.length) return
    setBusy(true)
    setError(null)
    setResultMessage(null)
    setFailures({})
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/prepared`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: preparedReferences.map((reference) => {
            const draft = drafts[reference.id]
            return {
              referenceId: reference.id,
              action: draft.decision,
              targetId: draft.targetId || null,
              remember: rememberLinks,
              values: {
                name: draft.name,
                code: draft.code,
                customerId: draft.customerId,
                vendorId: draft.vendorId,
                deviceTypeId: draft.deviceTypeId,
                modelId: draft.modelId,
                model: draft.model,
                platform: draft.platform,
                platforms: draft.platforms,
                familyId: draft.familyId || null,
                newFamilyName: draft.newFamilyName || null,
                version: draft.version,
                status: draft.status,
              },
            }
          }),
          families: preparedFamilies.map((model) => {
            const draft = familyDrafts[model.id]
            return {
              modelId: model.id,
              action: draft.decision,
              familyId: draft.familyId || null,
              vendorId: model.vendorId,
              name: draft.name || null,
            }
          }),
        }),
      })
      const payload = await response.json() as ApplyPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Prepared changes could not be applied.')
      const failed = Object.fromEntries(payload.data.failures.map((failure) => [failure.key, failure.message]))
      setFailures(failed)
      setResultMessage(`${payload.data.applied.toLocaleString()} prepared action${payload.data.applied === 1 ? '' : 's'} applied. ${payload.data.failed ? `${payload.data.failed.toLocaleString()} need correction. ` : ''}${payload.data.remaining.toLocaleString()} references remain.`)
      setAppliedSinceOpen(payload.data.applied > 0 || appliedSinceOpen)
      const failedKeys = new Set(payload.data.failures.map((failure) => failure.key))
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => failedKeys.has(key))))
      setFamilyDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => failedKeys.has(`family:${key}`))))
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Prepared changes could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  function filterCount(kind: FilterKind) {
    if (kind === 'FAMILY') return familyTasks.length
    if (kind === 'ALL') return references.length
    return references.filter((reference) => reference.kind === kind).length
  }

  return <>
    <div className="fixed bottom-6 left-6 z-40">
      <Button type="button" variant="primary" onClick={() => void openSheet()}>Bulk reconcile missing entities</Button>
    </div>

    {open ? <div className="fixed inset-0 z-50 bg-black/75 p-3" role="dialog" aria-modal="true" aria-label="Bulk import reconciliation worksheet">
      <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Bulk reconciliation worksheet</div>
            <h2 className="mt-1 text-xl font-semibold">Review the list first. Apply once at the end.</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Decisions remain local until you press Apply prepared changes. Repeated workbook values are already collapsed into one row.</p>
          </div>
          <Button type="button" variant="ghost" disabled={busy} onClick={closeSheet}>Close</Button>
        </div>

        {!assist ? <div className="p-5 text-sm text-[var(--muted)]">Loading reconciliation worksheet…</div> : <>
          <div className="border-b border-[var(--border)] px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {FILTER_ORDER.map((kind) => <button key={kind} type="button" disabled={busy} onClick={() => changeFilter(kind)} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${filterKind === kind ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-light)]' : 'border-[var(--border)] text-[var(--muted-strong)] hover:border-[var(--border-strong)]'}`}>
                {kind === 'ALL' ? 'All' : kind === 'FAMILY' ? 'Families' : KIND_LABELS[kind]} · {filterCount(kind).toLocaleString()}
              </button>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Filter source value, vendor, type, model…" className="h-9 min-w-[260px] flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 text-sm" />
              {filterKind !== 'FAMILY' ? <Button type="button" disabled={busy || !filteredReferences.some(isCreateReady)} onClick={prepareCreateReady}>Prepare create-ready rows</Button> : null}
              <label className="flex items-center gap-2 text-xs text-[var(--muted-strong)]"><input type="checkbox" checked={rememberLinks} disabled={busy} onChange={(event) => setRememberLinks(event.target.checked)} /> Remember linked mappings</label>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
            {resultMessage ? <div className="mb-4 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-3 text-sm">{resultMessage}</div> : null}

            {assist.workspace.batch.status === 'PUBLISHED' ? <div className="text-sm text-[var(--muted)]">This batch is already published.</div> : filterKind === 'FAMILY' ? <div className="space-y-2">
              {filteredFamilyTasks.length ? filteredFamilyTasks.map((model) => {
                const draft = familyDrafts[model.id] ?? { decision: 'REVIEW' as FamilyDecision, familyId: '', name: model.proposedNewFamilyName ?? '' }
                const familyOptions = assist.models.families.filter((family) => family.isActive && family.vendorId === model.vendorId).map((family) => ({ id: family.id, label: family.name, keywords: [family.name] }))
                const failure = failures[`family:${model.id}`]
                return <div key={model.id} className={`rounded-lg border p-3 ${failure ? 'border-[#754040]' : 'border-[var(--border)]'} bg-[var(--surface-raised)]`}>
                  <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_190px_minmax(260px,1.3fr)] lg:items-start">
                    <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Model Family</div><div className="mt-1 font-semibold">{model.vendor.name} · {model.model}</div><div className="mt-1 text-xs text-[var(--muted)]">{model.supportedPlatforms.map((item) => item.platform).join(', ') || model.platform || 'Platform not known'}</div></div>
                    <SelectInput value={draft.decision} disabled={busy} onChange={(event) => patchFamily(model, { decision: event.target.value as FamilyDecision })}><option value="REVIEW">Review later</option><option value="ASSIGN">Assign existing</option><option value="CREATE">Create Family</option></SelectInput>
                    {draft.decision === 'ASSIGN' ? <SearchableReferencePicker id={`family-assign-${model.id}`} value={draft.familyId} options={familyOptions} disabled={busy} placeholder="Search Family…" onChange={(value) => patchFamily(model, { familyId: value })} /> : draft.decision === 'CREATE' ? <TextInput value={draft.name} disabled={busy} placeholder="New Family name" onChange={(event) => patchFamily(model, { name: event.target.value })} /> : <div className="text-xs text-[var(--muted)]">No database change prepared.</div>}
                  </div>
                  {failure ? <div className="mt-2 text-xs font-medium text-[#f0a0a0]">{failure}</div> : null}
                </div>
              }) : <div className="py-10 text-center text-sm text-[var(--muted)]">No missing Model Families match this filter.</div>}
            </div> : <div className="space-y-2">
              {visibleReferences.length ? visibleReferences.map((reference) => {
                const draft = getDraft(reference)
                const localError = drafts[reference.id] ? draftError(reference, draft) : null
                const failure = failures[reference.id]
                const waiting = waitingText(reference)
                return <div key={reference.id} className={`rounded-lg border bg-[var(--surface-raised)] ${failure || localError ? 'border-[#754040]' : draft.decision !== 'REVIEW' ? 'border-[var(--accent-muted)]' : 'border-[var(--border)]'}`}>
                  <div className="grid gap-3 p-3 lg:grid-cols-[minmax(280px,1.25fr)_minmax(180px,.8fr)_100px_180px] lg:items-center">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{KIND_LABELS[reference.kind]}</span><span className="truncate font-mono text-sm font-semibold">{reference.sourceValue}</span></div><div className="mt-1 text-xs text-[var(--muted)]">{contextSummary(reference, assist)}{reference.suggestedTargetLabel ? ` · suggestion: ${reference.suggestedTargetLabel}` : ''}</div></div>
                    <div className="text-xs text-[var(--muted-strong)]">{waiting ?? (reference.status === 'UNRESOLVED' ? 'Ready for review' : reference.status)}</div>
                    <div className="text-xs text-[var(--muted)]">{reference.occurrenceCount.toLocaleString()}x</div>
                    <SelectInput value={draft.decision} disabled={busy} onChange={(event) => setDecision(reference, event.target.value as Decision)}><option value="REVIEW">Review later</option><option value="LINK">Link existing</option><option value="CREATE">Create new</option></SelectInput>
                  </div>
                  {draft.decision === 'LINK' ? <div className="border-t border-[var(--border)] px-3 py-3"><div className="max-w-2xl">{fieldLabel({ label: 'Existing target', children: <SearchableReferencePicker id={`bulk-link-${reference.id}`} value={draft.targetId} options={linkOptions(reference, draft)} disabled={busy} placeholder="Search configured record…" onChange={(value) => patchDraft(reference, { targetId: value })} /> })}</div></div> : null}
                  {draft.decision === 'CREATE' ? <div className="border-t border-[var(--border)] px-3 py-3">{createFields(reference, draft)}</div> : null}
                  {localError ? <div className="border-t border-[var(--border)] px-3 py-2 text-xs font-medium text-[#f0a0a0]">{localError}</div> : failure ? <div className="border-t border-[var(--border)] px-3 py-2 text-xs font-medium text-[#f0a0a0]">{failure}</div> : null}
                </div>
              }) : <div className="py-10 text-center text-sm text-[var(--muted)]">No unresolved references match this filter.</div>}
            </div>}
          </div>

          <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                <span><strong className="text-[var(--foreground)]">{preparedCount.toLocaleString()}</strong> prepared</span>
                <span><strong className={validationErrors.length ? 'text-[#f0a0a0]' : 'text-[var(--foreground)]'}>{validationErrors.length.toLocaleString()}</strong> invalid</span>
                <span><strong className="text-[var(--foreground)]">{assist.workspace.counts.references.unresolved.toLocaleString()}</strong> unresolved</span>
                {filterKind !== 'FAMILY' && filteredReferences.length > PAGE_SIZE ? <span>Page {safePage + 1} / {pageCount}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {filterKind !== 'FAMILY' && filteredReferences.length > PAGE_SIZE ? <><Button type="button" variant="ghost" disabled={busy || safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</Button><Button type="button" variant="ghost" disabled={busy || safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</Button></> : null}
                <Button type="button" variant="ghost" disabled={busy || !preparedCount} onClick={clearPrepared}>Clear prepared</Button>
                <Button type="button" variant="primary" disabled={busy || !preparedCount || validationErrors.length > 0} onClick={() => void applyPrepared()}>{busy ? 'Applying…' : `Apply ${preparedCount.toLocaleString()} prepared changes`}</Button>
              </div>
            </div>
          </div>
        </>}
      </div>
    </div> : null}
  </>
}
