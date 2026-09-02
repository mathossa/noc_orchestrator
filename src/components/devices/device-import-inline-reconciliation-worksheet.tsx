'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SearchableReferencePicker, type SearchableReferenceOption } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import type { DeviceImportReferenceKind } from '@/lib/device-import'

const SAFE_SCORE = 0.97
const INITIAL_VISIBLE = 100
const MORE_VISIBLE = 100

const STATUSES = ['AVAILABLE', 'TESTING', 'APPROVED', 'RECOMMENDED', 'DEPRECATED', 'BLOCKED'] as const

type ApiError = { error?: { message?: string } }
type ReferenceMetadata = {
  rowNumbers?: number[]
  organizationSiteSourceValue?: string | null
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
  targetId: string | null
  targetLabel: string | null
  suggestedTargetId: string | null
  suggestedTargetLabel: string | null
  suggestionScore: number | null
  occurrenceCount: number
  metadata: ReferenceMetadata
}
type OptionRecord = { id: string; code?: string | null; name: string; isActive: boolean }
type SiteRecord = OptionRecord & { customerId: string }
type ModelRecord = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId: string | null
  model: string
  platform: string | null
  isActive: boolean
  vendor: { id: string; code: string; name: string }
  deviceType: { id: string; code: string; name: string }
}
type FirmwareRecord = {
  id: string
  vendorId: string
  platform: string
  version: string
  status: string
  isActive: boolean
  vendor: { id: string; code: string; name: string }
}
type Family = { id: string; vendorId: string; name: string; isActive: boolean }
type ReadyModel = {
  id: string
  proposedModel: string
  proposedPlatform: string
  proposedPlatforms: string[]
  suggestedFamilyId: string | null
  proposedNewFamilyName: string | null
}
type LinkedModel = {
  id: string
  vendorId: string
  familyId: string | null
  model: string
  platform: string | null
  supportedPlatforms: Array<{ id: string; platform: string }>
  vendor: { id: string; code: string; name: string }
  proposedNewFamilyName: string | null
  suggestedFamilyId: string | null
}
type SiteProposal = {
  referenceIds: string[]
  name: string
  code: string
  existingTarget: { id: string; name: string; code: string | null } | null
}
type FirmwareProposal = {
  referenceIds: string[]
  version: string
  platform: string
  status: string
  existingTarget: { id: string; version: string; platform: string; status: string } | null
}
type Assist = {
  workspace: {
    batch: { id: string; status: string; profileId: string | null; profileName: string | null }
    counts: { references: { unresolved: number } }
    references: Reference[]
    options: {
      customers: OptionRecord[]
      sites: SiteRecord[]
      vendors: OptionRecord[]
      deviceTypes: OptionRecord[]
      models: ModelRecord[]
      firmwareReleases: FirmwareRecord[]
    }
  }
  sites: { proposals: SiteProposal[] }
  models: { readyToCreate: ReadyModel[]; linkedModels: LinkedModel[]; families: Family[] }
  firmware: { proposals: FirmwareProposal[] }
}
type AssistPayload = { data?: Assist } & ApiError

type SiteDraft = {
  customerRefId: string | null
  customerTargetId: string
  customerName: string
  customerCode: string
  siteTargetId: string
  siteName: string
  siteCode: string
}
type ModelDraft = {
  existingModelId: string
  vendorId: string
  vendorName: string
  vendorCode: string
  deviceTypeId: string
  deviceTypeName: string
  deviceTypeCode: string
  model: string
  platform: string
  platforms: string
  familyId: string
  familyName: string
}
type FirmwareDraft = {
  existingReleaseId: string
  version: string
  platform: string
  status: string
}
type CoreDraft = {
  existingTargetId: string
  name: string
  code: string
}
type FamilyDraft = { familyId: string; name: string }
type ApplyFailure = { key: string; message: string }
type ApplyPayload = {
  data?: { applied: number; failed: number; remaining: number; failures: ApplyFailure[] }
} & ApiError

type RawRow = { rowNumber: number; status: string; rawData: unknown; mappedData: unknown }
type RawPayload = {
  data?: { sourceValue: string; kind: string; occurrenceCount: number; sampled: boolean; rows: RawRow[] }
} & ApiError

type PreparedItem = {
  referenceId: string
  action: 'LINK' | 'CREATE'
  targetId: string | null
  remember: boolean
  values: Record<string, unknown>
}
type PreparedFamily = {
  modelId: string
  action: 'ASSIGN' | 'CREATE'
  familyId: string | null
  vendorId: string | null
  name: string | null
}

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function compact(value: string | null | undefined) {
  return normalized(value).replace(/[^a-z0-9]+/g, '')
}

function suggestedCode(value: string, separator: '_' | '-' = '_') {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, separator).replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '').slice(0, 40) || 'IMPORT'
}

function exactOption(value: string, records: OptionRecord[]) {
  const key = normalized(value)
  if (!key) return null
  const matches = records.filter((record) => normalized(record.name) === key || normalized(record.code) === key)
  return matches.length === 1 ? matches[0] : null
}

function sourceReference(assist: Assist, kind: DeviceImportReferenceKind, sourceValue: string | null | undefined) {
  const key = normalized(sourceValue)
  if (!key) return null
  return assist.workspace.references.find((reference) => reference.kind === kind && normalized(reference.sourceValue) === key) ?? null
}

function safeSuggestedTarget(reference: Reference | null) {
  if (!reference?.suggestedTargetId || (reference.suggestionScore ?? 0) < SAFE_SCORE) return ''
  return reference.suggestedTargetId
}

function selectedName(id: string, records: OptionRecord[]) {
  return records.find((record) => record.id === id)?.name ?? ''
}

function stripVendorPrefix(model: string, vendor: string) {
  const trimmed = model.trim()
  const vendorText = vendor.trim()
  if (!trimmed || !vendorText) return trimmed
  const lower = trimmed.toLocaleLowerCase('en-US')
  const vendorLower = vendorText.toLocaleLowerCase('en-US')
  if (!lower.startsWith(vendorLower)) return trimmed
  return trimmed.slice(vendorText.length).replace(/^[\s._/-]+/, '').trim() || trimmed
}

function pickerOptions(records: OptionRecord[]): SearchableReferenceOption[] {
  return records.filter((record) => record.isActive).map((record) => ({
    id: record.id,
    label: `${record.name}${record.code ? ` (${record.code})` : ''}`,
    keywords: [record.name, record.code ?? ''],
  }))
}

function FreeTextSuggestions({
  id,
  label,
  value,
  records,
  disabled,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  value: string
  records: OptionRecord[]
  disabled: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const listId = `${id}-suggestions`
  return <label className="min-w-0 text-xs font-semibold text-[var(--muted-strong)]">
    <span className="mb-1 block">{label}</span>
    <TextInput id={id} list={listId} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    <datalist id={listId}>{records.filter((record) => record.isActive).map((record) => <option key={record.id} value={record.name}>{record.code ? `${record.code} · ${record.name}` : record.name}</option>)}</datalist>
  </label>
}

function field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="min-w-0 text-xs font-semibold text-[var(--muted-strong)]">
    <span className="mb-1 block">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[11px] font-normal text-[var(--muted)]">{hint}</span> : null}
  </label>
}

function rowIdentity(row: RawRow) {
  const mapped = typeof row.mappedData === 'object' && row.mappedData !== null ? row.mappedData as Record<string, unknown> : {}
  for (const key of ['name', 'hostname', 'externalId']) {
    const value = mapped[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return `Row ${row.rowNumber}`
}

export function DeviceImportInlineReconciliationWorksheet({ batchId }: { batchId: string }) {
  const [assist, setAssist] = useState<Assist | null>(null)
  const [siteDrafts, setSiteDrafts] = useState<Record<string, SiteDraft>>({})
  const [modelDrafts, setModelDrafts] = useState<Record<string, ModelDraft>>({})
  const [firmwareDrafts, setFirmwareDrafts] = useState<Record<string, FirmwareDraft>>({})
  const [coreDrafts, setCoreDrafts] = useState<Record<string, CoreDraft>>({})
  const [familyDrafts, setFamilyDrafts] = useState<Record<string, FamilyDraft>>({})
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [rawRows, setRawRows] = useState<Record<string, RawPayload['data']>>({})
  const [rawLoading, setRawLoading] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [siteVisible, setSiteVisible] = useState(INITIAL_VISIBLE)
  const [modelVisible, setModelVisible] = useState(INITIAL_VISIBLE)
  const [firmwareVisible, setFirmwareVisible] = useState(INITIAL_VISIBLE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const install = useCallback((next: Assist) => {
    setAssist(next)
    setFailures({})

    const activeCustomers = next.workspace.options.customers.filter((item) => item.isActive)
    const activeVendors = next.workspace.options.vendors.filter((item) => item.isActive)
    const activeTypes = next.workspace.options.deviceTypes.filter((item) => item.isActive)

    const nextSites: Record<string, SiteDraft> = {}
    for (const reference of next.workspace.references.filter((item) => item.kind === 'SITE' && item.status !== 'LINKED')) {
      const customerRef = sourceReference(next, 'CUSTOMER', reference.metadata.customerSourceValue)
      const customerTargetId = reference.metadata.customerTargetId ?? customerRef?.targetId ?? safeSuggestedTarget(customerRef)
      const customerName = selectedName(customerTargetId, activeCustomers) || reference.metadata.customerSourceValue || ''
      const proposal = next.sites.proposals.find((item) => item.referenceIds.includes(reference.id))
      nextSites[reference.id] = {
        customerRefId: customerRef?.id ?? null,
        customerTargetId,
        customerName,
        customerCode: suggestedCode(customerName),
        siteTargetId: proposal?.existingTarget?.id ?? safeSuggestedTarget(reference),
        siteName: proposal?.name ?? reference.sourceValue,
        siteCode: proposal?.code ?? suggestedCode(reference.sourceValue, '-'),
      }
    }
    setSiteDrafts(nextSites)

    const nextModels: Record<string, ModelDraft> = {}
    for (const reference of next.workspace.references.filter((item) => item.kind === 'DEVICE_MODEL' && item.status !== 'LINKED')) {
      const vendorRef = sourceReference(next, 'VENDOR', reference.metadata.vendorSourceValue)
      const typeRef = sourceReference(next, 'DEVICE_TYPE', reference.metadata.deviceTypeSourceValue)
      const vendorId = reference.metadata.vendorTargetId ?? vendorRef?.targetId ?? safeSuggestedTarget(vendorRef)
      const deviceTypeId = reference.metadata.deviceTypeTargetId ?? typeRef?.targetId ?? safeSuggestedTarget(typeRef)
      const vendorName = selectedName(vendorId, activeVendors) || reference.metadata.vendorSourceValue || ''
      const deviceTypeName = selectedName(deviceTypeId, activeTypes) || reference.metadata.deviceTypeSourceValue || ''
      const proposal = next.models.readyToCreate.find((item) => item.id === reference.id)
      const platform = proposal?.proposedPlatform ?? reference.metadata.platform ?? (reference.metadata.platforms?.length === 1 ? reference.metadata.platforms[0] : '') ?? ''
      const platforms = proposal?.proposedPlatforms?.length ? proposal.proposedPlatforms.join(', ') : reference.metadata.platforms?.join(', ') ?? (platform ? platform : '')
      nextModels[reference.id] = {
        existingModelId: safeSuggestedTarget(reference),
        vendorId,
        vendorName,
        vendorCode: suggestedCode(vendorName),
        deviceTypeId,
        deviceTypeName,
        deviceTypeCode: suggestedCode(deviceTypeName),
        model: proposal?.proposedModel ?? stripVendorPrefix(reference.sourceValue, vendorName),
        platform,
        platforms,
        familyId: proposal?.suggestedFamilyId ?? '',
        familyName: proposal?.proposedNewFamilyName ?? '',
      }
    }
    setModelDrafts(nextModels)

    const nextFirmware: Record<string, FirmwareDraft> = {}
    for (const reference of next.workspace.references.filter((item) => item.kind === 'FIRMWARE_RELEASE' && item.status !== 'LINKED')) {
      const proposal = next.firmware.proposals.find((item) => item.referenceIds.includes(reference.id))
      nextFirmware[reference.id] = {
        existingReleaseId: proposal?.existingTarget?.id ?? safeSuggestedTarget(reference),
        version: proposal?.version ?? reference.sourceValue,
        platform: proposal?.platform ?? reference.metadata.platform ?? (reference.metadata.platforms?.length === 1 ? reference.metadata.platforms[0] : '') ?? '',
        status: proposal?.status ?? 'AVAILABLE',
      }
    }
    setFirmwareDrafts(nextFirmware)

    const siteCustomerSources = new Set(next.workspace.references.filter((item) => item.kind === 'SITE').map((item) => normalized(item.metadata.customerSourceValue)).filter(Boolean))
    const modelVendorSources = new Set(next.workspace.references.filter((item) => item.kind === 'DEVICE_MODEL').map((item) => normalized(item.metadata.vendorSourceValue)).filter(Boolean))
    const modelTypeSources = new Set(next.workspace.references.filter((item) => item.kind === 'DEVICE_MODEL').map((item) => normalized(item.metadata.deviceTypeSourceValue)).filter(Boolean))
    const nextCore: Record<string, CoreDraft> = {}
    for (const reference of next.workspace.references.filter((item) => item.status !== 'LINKED' && ['CUSTOMER', 'VENDOR', 'DEVICE_TYPE'].includes(item.kind))) {
      if (reference.kind === 'CUSTOMER' && siteCustomerSources.has(normalized(reference.sourceValue))) continue
      if (reference.kind === 'VENDOR' && modelVendorSources.has(normalized(reference.sourceValue))) continue
      if (reference.kind === 'DEVICE_TYPE' && modelTypeSources.has(normalized(reference.sourceValue))) continue
      nextCore[reference.id] = {
        existingTargetId: safeSuggestedTarget(reference),
        name: reference.sourceValue,
        code: suggestedCode(reference.sourceValue),
      }
    }
    setCoreDrafts(nextCore)

    const nextFamilies: Record<string, FamilyDraft> = {}
    for (const model of next.models.linkedModels.filter((item) => !item.familyId)) {
      nextFamilies[model.id] = {
        familyId: model.suggestedFamilyId ?? '',
        name: model.suggestedFamilyId ? '' : model.proposedNewFamilyName ?? '',
      }
    }
    setFamilyDrafts(nextFamilies)
  }, [])

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The import worksheet could not be loaded.')
    install(payload.data)
    return payload.data
  }, [batchId, install])

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/assist`).then(async (response) => {
      const payload = await response.json() as AssistPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The import worksheet could not be loaded.')
      return payload.data
    }).then(
      (next) => { if (!cancelled) install(next) },
      (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The import worksheet could not be loaded.') },
    )
    return () => { cancelled = true }
  }, [batchId, install])

  const references = useMemo(() => assist?.workspace.references.filter((reference) => reference.status !== 'LINKED' && reference.kind !== 'CONTRACT_TYPE') ?? [], [assist])
  const siteRefs = useMemo(() => references.filter((reference) => reference.kind === 'SITE'), [references])
  const modelRefs = useMemo(() => references.filter((reference) => reference.kind === 'DEVICE_MODEL'), [references])
  const firmwareRefs = useMemo(() => references.filter((reference) => reference.kind === 'FIRMWARE_RELEASE'), [references])
  const coreRefs = useMemo(() => references.filter((reference) => Boolean(coreDrafts[reference.id])), [coreDrafts, references])
  const linkedFamilyTasks = useMemo(() => assist?.models.linkedModels.filter((model) => !model.familyId) ?? [], [assist])

  const normalizedQuery = normalized(query)
  const matchesQuery = useCallback((reference: Reference) => {
    if (!normalizedQuery) return true
    const values = [reference.sourceValue, reference.metadata.customerSourceValue, reference.metadata.vendorSourceValue, reference.metadata.deviceTypeSourceValue, reference.metadata.modelSourceValue]
    return normalizedQuery.split(/\s+/g).every((term) => values.some((value) => normalized(value).includes(term)))
  }, [normalizedQuery])

  const filteredSites = siteRefs.filter(matchesQuery)
  const filteredModels = modelRefs.filter(matchesQuery)
  const filteredFirmware = firmwareRefs.filter(matchesQuery)

  function updateSite(referenceId: string, values: Partial<SiteDraft>) {
    setSiteDrafts((current) => ({ ...current, [referenceId]: { ...current[referenceId], ...values } }))
    setFailures((current) => { const next = { ...current }; delete next[referenceId]; return next })
  }

  function updateModel(reference: Reference, values: Partial<ModelDraft>) {
    setModelDrafts((current) => {
      const draft = current[reference.id]
      if (!draft) return current
      let next = { ...draft, ...values }
      if (values.vendorName !== undefined) {
        const vendorMatch = assist ? exactOption(values.vendorName, assist.workspace.options.vendors) : null
        next = {
          ...next,
          vendorId: vendorMatch?.id ?? '',
          vendorCode: vendorMatch?.code ?? suggestedCode(values.vendorName),
          model: draft.model === stripVendorPrefix(reference.sourceValue, draft.vendorName) ? stripVendorPrefix(reference.sourceValue, values.vendorName) : draft.model,
          existingModelId: '',
        }
      }
      if (values.deviceTypeName !== undefined) {
        const typeMatch = assist ? exactOption(values.deviceTypeName, assist.workspace.options.deviceTypes) : null
        next = { ...next, deviceTypeId: typeMatch?.id ?? '', deviceTypeCode: typeMatch?.code ?? suggestedCode(values.deviceTypeName), existingModelId: '' }
      }
      return { ...current, [reference.id]: next }
    })
    setFailures((current) => { const next = { ...current }; delete next[reference.id]; return next })
  }

  function updateFirmware(referenceId: string, values: Partial<FirmwareDraft>) {
    setFirmwareDrafts((current) => ({ ...current, [referenceId]: { ...current[referenceId], ...values } }))
    setFailures((current) => { const next = { ...current }; delete next[referenceId]; return next })
  }

  async function toggleRaw(reference: Reference) {
    if (rawRows[reference.id]) {
      setRawRows((current) => ({ ...current, [reference.id]: undefined }))
      return
    }
    setRawLoading(reference.id)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/${reference.id}/raw`)
      const payload = await response.json() as RawPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Raw source rows could not be loaded.')
      setRawRows((current) => ({ ...current, [reference.id]: payload.data }))
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Raw source rows could not be loaded.')
    } finally {
      setRawLoading(null)
    }
  }

  const plan = useMemo(() => {
    if (!assist) return { items: [] as PreparedItem[], families: [] as PreparedFamily[], errors: [] as string[] }
    const itemMap = new Map<string, PreparedItem>()
    const errors: string[] = []
    const remember = Boolean(assist.workspace.batch.profileId)

    for (const reference of siteRefs) {
      const draft = siteDrafts[reference.id]
      if (!draft) continue
      if (draft.customerRefId) {
        const customerRef = assist.workspace.references.find((item) => item.id === draft.customerRefId)
        if (customerRef && customerRef.status !== 'LINKED') {
          if (draft.customerTargetId) {
            itemMap.set(customerRef.id, { referenceId: customerRef.id, action: 'LINK', targetId: draft.customerTargetId, remember, values: {} })
          } else if (draft.customerName.trim()) {
            itemMap.set(customerRef.id, { referenceId: customerRef.id, action: 'CREATE', targetId: null, remember, values: { name: draft.customerName, code: draft.customerCode } })
          }
        }
      }
      if (draft.siteTargetId) {
        itemMap.set(reference.id, { referenceId: reference.id, action: 'LINK', targetId: draft.siteTargetId, remember, values: {} })
      } else if (draft.siteName.trim() && draft.siteCode.trim()) {
        itemMap.set(reference.id, { referenceId: reference.id, action: 'CREATE', targetId: null, remember, values: { customerId: draft.customerTargetId || null, name: draft.siteName, code: draft.siteCode } })
      } else {
        errors.push(`Site “${reference.sourceValue}” still needs a Site name/code.`)
      }
    }

    for (const reference of coreRefs) {
      const draft = coreDrafts[reference.id]
      if (!draft) continue
      if (draft.existingTargetId) itemMap.set(reference.id, { referenceId: reference.id, action: 'LINK', targetId: draft.existingTargetId, remember, values: {} })
      else if (draft.name.trim() && draft.code.trim()) itemMap.set(reference.id, { referenceId: reference.id, action: 'CREATE', targetId: null, remember, values: { name: draft.name, code: draft.code } })
    }

    for (const reference of modelRefs) {
      const draft = modelDrafts[reference.id]
      if (!draft) continue
      if (draft.existingModelId) {
        itemMap.set(reference.id, { referenceId: reference.id, action: 'LINK', targetId: draft.existingModelId, remember, values: {} })
      } else if (draft.vendorName.trim() && draft.deviceTypeName.trim() && draft.model.trim()) {
        itemMap.set(reference.id, {
          referenceId: reference.id,
          action: 'CREATE',
          targetId: null,
          remember,
          values: {
            vendorId: draft.vendorId || null,
            vendorName: draft.vendorName,
            vendorCode: draft.vendorCode,
            deviceTypeId: draft.deviceTypeId || null,
            deviceTypeName: draft.deviceTypeName,
            deviceTypeCode: draft.deviceTypeCode,
            model: draft.model,
            platform: draft.platform || null,
            platforms: draft.platforms,
            familyId: draft.familyId || null,
            newFamilyName: draft.familyId ? null : draft.familyName || null,
          },
        })
      } else {
        errors.push(`Model “${reference.sourceValue}” still needs Vendor, Device Type and Model.`)
      }
    }

    for (const reference of firmwareRefs) {
      const draft = firmwareDrafts[reference.id]
      if (!draft) continue
      if (draft.existingReleaseId) {
        itemMap.set(reference.id, { referenceId: reference.id, action: 'LINK', targetId: draft.existingReleaseId, remember, values: {} })
      } else if (draft.version.trim()) {
        const relatedModel = modelRefs.find((modelRef) => normalized(modelRef.sourceValue) === normalized(reference.metadata.modelSourceValue))
        const relatedModelDraft = relatedModel ? modelDrafts[relatedModel.id] : null
        const platform = draft.platform || relatedModelDraft?.platform || ''
        itemMap.set(reference.id, {
          referenceId: reference.id,
          action: 'CREATE',
          targetId: null,
          remember,
          values: {
            modelId: reference.metadata.modelTargetId || null,
            vendorId: reference.metadata.vendorTargetId || relatedModelDraft?.vendorId || null,
            platform,
            version: draft.version,
            status: draft.status,
          },
        })
        if (!platform) errors.push(`Firmware “${reference.sourceValue}” still needs a Platform.`)
      }
    }

    const families: PreparedFamily[] = []
    for (const model of linkedFamilyTasks) {
      const draft = familyDrafts[model.id]
      if (!draft) continue
      if (draft.familyId) families.push({ modelId: model.id, action: 'ASSIGN', familyId: draft.familyId, vendorId: model.vendorId, name: null })
      else if (draft.name.trim()) families.push({ modelId: model.id, action: 'CREATE', familyId: null, vendorId: model.vendorId, name: draft.name })
    }

    return { items: [...itemMap.values()], families, errors }
  }, [assist, coreDrafts, coreRefs, familyDrafts, firmwareDrafts, firmwareRefs, linkedFamilyTasks, modelDrafts, modelRefs, siteDrafts, siteRefs])

  async function applyAll() {
    if (!assist || (!plan.items.length && !plan.families.length) || plan.errors.length) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/prepared-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: plan.items, families: plan.families }),
      })
      const payload = await response.json() as ApplyPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The worksheet changes could not be applied.')
      setFailures(Object.fromEntries(payload.data.failures.map((failure) => [failure.key, failure.message])))
      setNotice(`${payload.data.applied.toLocaleString()} mapping${payload.data.applied === 1 ? '' : 's'} applied. ${payload.data.failed ? `${payload.data.failed.toLocaleString()} need correction. ` : ''}${payload.data.remaining.toLocaleString()} references remain.`)
      await load()
      window.setTimeout(() => window.location.reload(), 350)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'The worksheet changes could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  if (!assist) return <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"><div className="text-sm text-[var(--muted)]">{error ?? 'Loading reconciliation worksheet…'}</div></section>
  if (assist.workspace.batch.status === 'PUBLISHED') return null

  const customerOptions = pickerOptions(assist.workspace.options.customers)
  const vendorRecords = assist.workspace.options.vendors.filter((item) => item.isActive)
  const typeRecords = assist.workspace.options.deviceTypes.filter((item) => item.isActive)
  const pending = plan.errors.length
  const prepared = plan.items.length + plan.families.length

  return <section className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
    <div className="border-b border-[var(--border)] px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Reconciliation worksheet</div>
          <h2 className="mt-1 text-lg font-semibold">Match and correct imported values in place</h2>
          <p className="mt-1 max-w-4xl text-sm text-[var(--muted)]">Existing matches and logical source values are prefilled. Leave an existing target selected to link it; otherwise the filled fields describe the new record that will be created. Nothing is committed until Apply worksheet.</p>
        </div>
        <div className="text-right text-xs text-[var(--muted)]"><div><strong className="text-[var(--foreground)]">{prepared.toLocaleString()}</strong> ready</div><div><strong className={pending ? 'text-amber-200' : 'text-[var(--foreground)]'}>{pending.toLocaleString()}</strong> need input</div></div>
      </div>
      <div className="mt-3"><TextInput value={query} disabled={busy} placeholder="Filter Customer, Site, Vendor, Model, Firmware…" onChange={(event) => { setQuery(event.target.value); setSiteVisible(INITIAL_VISIBLE); setModelVisible(INITIAL_VISIBLE); setFirmwareVisible(INITIAL_VISIBLE) }} /></div>
    </div>

    {error ? <div className="mx-4 mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0] sm:mx-5" role="alert">{error}</div> : null}
    {notice ? <div className="mx-4 mt-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6] sm:mx-5">{notice}</div> : null}

    <details open className="border-b border-[var(--border)]">
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Customer + Site · {filteredSites.length.toLocaleString()} rows</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
        {filteredSites.slice(0, siteVisible).map((reference) => {
          const draft = siteDrafts[reference.id]
          if (!draft) return null
          const siteOptions = assist.workspace.options.sites.filter((site) => site.isActive && (!draft.customerTargetId || site.customerId === draft.customerTargetId)).map((site) => ({ id: site.id, label: `${site.name}${site.code ? ` (${site.code})` : ''}`, keywords: [site.name, site.code ?? ''] }))
          return <div key={reference.id} className="px-4 py-4 sm:px-5">
            <div className="grid gap-3 xl:grid-cols-[minmax(260px,.9fr)_minmax(220px,.8fr)_minmax(220px,.8fr)_minmax(180px,.6fr)] xl:items-end">
              <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Imported Customer - Site</div><div className="mt-1 font-mono text-sm font-semibold">{reference.metadata.organizationSiteSourceValue ?? `${reference.metadata.customerSourceValue ?? '—'} - ${reference.sourceValue}`}</div><div className="mt-1 text-xs text-[var(--muted)]">{reference.occurrenceCount.toLocaleString()} device row{reference.occurrenceCount === 1 ? '' : 's'} · rows {(reference.metadata.rowNumbers ?? []).join(', ') || '—'}</div></div>
              {field({ label: 'Customer', children: <SearchableReferencePicker id={`sheet-customer-${reference.id}`} value={draft.customerTargetId} options={customerOptions} disabled={busy} placeholder={draft.customerName || 'Search Customer…'} onChange={(value) => updateSite(reference.id, { customerTargetId: value, customerName: selectedName(value, assist.workspace.options.customers) || draft.customerName, siteTargetId: '' })} />, hint: draft.customerTargetId ? 'Existing Customer' : `Will create: ${draft.customerName || 'fill Customer name'}` })}
              {field({ label: 'Site', children: <SearchableReferencePicker id={`sheet-site-${reference.id}`} value={draft.siteTargetId} options={siteOptions} disabled={busy} placeholder={draft.siteName || 'Search Site…'} onChange={(value) => updateSite(reference.id, { siteTargetId: value })} />, hint: draft.siteTargetId ? 'Existing Site' : `Will create: ${draft.siteName}` })}
              {field({ label: 'New Site code', children: <TextInput value={draft.siteCode} disabled={busy || Boolean(draft.siteTargetId)} onChange={(event) => updateSite(reference.id, { siteCode: event.target.value })} /> })}
            </div>
            {!draft.customerTargetId ? <div className="mt-3 grid gap-3 md:grid-cols-2">{field({ label: 'New Customer name', children: <TextInput value={draft.customerName} disabled={busy} onChange={(event) => updateSite(reference.id, { customerName: event.target.value, customerCode: suggestedCode(event.target.value) })} /> })}{field({ label: 'New Customer code', children: <TextInput value={draft.customerCode} disabled={busy} onChange={(event) => updateSite(reference.id, { customerCode: event.target.value })} /> })}</div> : null}
            {!draft.siteTargetId ? <div className="mt-3 max-w-xl">{field({ label: 'New Site name', children: <TextInput value={draft.siteName} disabled={busy} onChange={(event) => updateSite(reference.id, { siteName: event.target.value })} /> })}</div> : null}
            {failures[reference.id] ? <div className="mt-2 text-xs font-medium text-[#f0a0a0]">{failures[reference.id]}</div> : null}
          </div>
        })}
        {filteredSites.length > siteVisible ? <div className="p-4 text-center"><Button type="button" variant="ghost" disabled={busy} onClick={() => setSiteVisible((value) => value + MORE_VISIBLE)}>Show {Math.min(MORE_VISIBLE, filteredSites.length - siteVisible)} more Sites</Button></div> : null}
      </div>
    </details>

    <details open className="border-b border-[var(--border)]">
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Device Models · {filteredModels.length.toLocaleString()} rows</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
        {filteredModels.slice(0, modelVisible).map((reference) => {
          const draft = modelDrafts[reference.id]
          if (!draft) return null
          const existingModelOptions = assist.workspace.options.models.filter((model) => model.isActive && (!draft.vendorId || model.vendorId === draft.vendorId) && (!draft.deviceTypeId || model.deviceTypeId === draft.deviceTypeId)).map((model) => ({ id: model.id, label: `${model.vendor.name} · ${model.model} · ${model.deviceType.name}`, keywords: [model.model, model.vendor.name, model.deviceType.name, model.platform ?? ''] }))
          const familyOptions = assist.models.families.filter((family) => family.isActive && (!draft.vendorId || family.vendorId === draft.vendorId)).map((family) => ({ id: family.id, label: family.name, keywords: [family.name] }))
          const willLink = Boolean(draft.existingModelId)
          return <div key={reference.id} className="px-4 py-4 sm:px-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Imported Model</div><div className="mt-1 font-mono text-sm font-semibold">{reference.sourceValue}</div><div className="mt-1 text-xs text-[var(--muted)]">{reference.occurrenceCount.toLocaleString()} device row{reference.occurrenceCount === 1 ? '' : 's'} · rows {(reference.metadata.rowNumbers ?? []).join(', ') || '—'}</div></div><div className={`rounded-md border px-2 py-1 text-xs font-semibold ${willLink ? 'border-[#285f48] text-[#a9e8c6]' : 'border-[var(--accent-muted)] text-[var(--accent-light)]'}`}>{willLink ? 'LINK EXISTING' : 'CREATE MODEL'}</div></div>
            <div className="grid gap-3 xl:grid-cols-[minmax(260px,1.2fr)_minmax(170px,.7fr)_minmax(170px,.7fr)] xl:items-end">
              {field({ label: 'Existing Model (optional)', children: <SearchableReferencePicker id={`sheet-model-existing-${reference.id}`} value={draft.existingModelId} options={existingModelOptions} disabled={busy} placeholder="Search existing model; leave blank to create…" onChange={(value) => updateModel(reference, { existingModelId: value })} />, hint: reference.suggestedTargetLabel && !draft.existingModelId ? `Suggestion: ${reference.suggestedTargetLabel}` : undefined })}
              <FreeTextSuggestions id={`sheet-vendor-${reference.id}`} label="Vendor" value={draft.vendorName} records={vendorRecords} disabled={busy || willLink} placeholder="Existing or new Vendor" onChange={(value) => updateModel(reference, { vendorName: value })} />
              <FreeTextSuggestions id={`sheet-type-${reference.id}`} label="Device Type" value={draft.deviceTypeName} records={typeRecords} disabled={busy || willLink} placeholder="Existing or new type" onChange={(value) => updateModel(reference, { deviceTypeName: value })} />
            </div>
            {!willLink ? <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(210px,.9fr)_minmax(150px,.6fr)_minmax(190px,.75fr)_minmax(210px,.85fr)] xl:items-end">
              {field({ label: 'Concrete Model', children: <TextInput value={draft.model} disabled={busy} onChange={(event) => updateModel(reference, { model: event.target.value })} /> })}
              {field({ label: 'Preferred Platform', children: <TextInput value={draft.platform} disabled={busy} placeholder="Optional" onChange={(event) => updateModel(reference, { platform: event.target.value })} />, hint: 'Auto-filled when the import/platform evidence is unambiguous.' })}
              {field({ label: 'Supported Platforms', children: <TextInput value={draft.platforms} disabled={busy} placeholder="e.g. AOS-8, AOS-10" onChange={(event) => updateModel(reference, { platforms: event.target.value })} /> })}
              {field({ label: 'Existing Family (optional)', children: <SearchableReferencePicker id={`sheet-family-${reference.id}`} value={draft.familyId} options={familyOptions} disabled={busy} placeholder="Search Family; leave blank for new…" onChange={(value) => updateModel(reference, { familyId: value, familyName: value ? '' : draft.familyName })} /> })}
            </div> : null}
            {!willLink && !draft.familyId ? <div className="mt-3 max-w-xl">{field({ label: 'New Family name (optional)', children: <TextInput value={draft.familyName} disabled={busy} placeholder="Auto-filled when a family pattern is recognizable" onChange={(event) => updateModel(reference, { familyName: event.target.value })} /> })}</div> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" disabled={busy || rawLoading === reference.id} onClick={() => void toggleRaw(reference)}>{rawRows[reference.id] ? 'Hide raw rows' : rawLoading === reference.id ? 'Loading raw…' : 'Raw / deep dive'}</Button><span className="text-xs text-[var(--muted)]">Vendor and Device Type may be typed even when they do not exist yet; they are created during Apply.</span></div>
            {rawRows[reference.id] ? <RawRowsPanel data={rawRows[reference.id]!} /> : null}
            {failures[reference.id] ? <div className="mt-2 text-xs font-medium text-[#f0a0a0]">{failures[reference.id]}</div> : null}
          </div>
        })}
        {filteredModels.length > modelVisible ? <div className="p-4 text-center"><Button type="button" variant="ghost" disabled={busy} onClick={() => setModelVisible((value) => value + MORE_VISIBLE)}>Show {Math.min(MORE_VISIBLE, filteredModels.length - modelVisible)} more Models</Button></div> : null}
      </div>
    </details>

    <details open className="border-b border-[var(--border)]">
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Firmware Releases · {filteredFirmware.length.toLocaleString()} rows</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
        {filteredFirmware.slice(0, firmwareVisible).map((reference) => {
          const draft = firmwareDrafts[reference.id]
          if (!draft) return null
          const relatedModelRef = modelRefs.find((item) => normalized(item.sourceValue) === normalized(reference.metadata.modelSourceValue))
          const relatedDraft = relatedModelRef ? modelDrafts[relatedModelRef.id] : null
          const effectivePlatform = draft.platform || relatedDraft?.platform || reference.metadata.platform || ''
          const releaseOptions = assist.workspace.options.firmwareReleases.filter((release) => release.isActive && (!reference.metadata.vendorTargetId || release.vendorId === reference.metadata.vendorTargetId) && (!effectivePlatform || normalized(release.platform) === normalized(effectivePlatform))).map((release) => ({ id: release.id, label: `${release.vendor.name} · ${release.platform} · ${release.version} · ${release.status}`, keywords: [release.version, release.platform, release.vendor.name, release.status] }))
          const willLink = Boolean(draft.existingReleaseId)
          return <div key={reference.id} className="px-4 py-4 sm:px-5">
            <div className="grid gap-3 xl:grid-cols-[minmax(220px,.8fr)_minmax(280px,1.1fr)_minmax(150px,.55fr)_minmax(150px,.55fr)_minmax(150px,.55fr)] xl:items-end">
              <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Imported Firmware</div><div className="mt-1 font-mono text-sm font-semibold">{reference.sourceValue}</div><div className="mt-1 text-xs text-[var(--muted)]">Model: {reference.metadata.modelSourceValue ?? 'waiting'} · {reference.occurrenceCount.toLocaleString()} row{reference.occurrenceCount === 1 ? '' : 's'}</div></div>
              {field({ label: 'Existing Release (optional)', children: <SearchableReferencePicker id={`sheet-fw-existing-${reference.id}`} value={draft.existingReleaseId} options={releaseOptions} disabled={busy} placeholder="Search release; leave blank to create…" onChange={(value) => updateFirmware(reference.id, { existingReleaseId: value })} /> })}
              {field({ label: 'Platform', children: <TextInput value={effectivePlatform} disabled={busy || willLink} placeholder="Auto-filled where possible" onChange={(event) => updateFirmware(reference.id, { platform: event.target.value })} /> })}
              {field({ label: 'Version', children: <TextInput value={draft.version} disabled={busy || willLink} onChange={(event) => updateFirmware(reference.id, { version: event.target.value })} /> })}
              {field({ label: 'Status', children: <SelectInput value={draft.status} disabled={busy || willLink} onChange={(event) => updateFirmware(reference.id, { status: event.target.value })}>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</SelectInput> })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" disabled={busy || rawLoading === reference.id} onClick={() => void toggleRaw(reference)}>{rawRows[reference.id] ? 'Hide raw rows' : rawLoading === reference.id ? 'Loading raw…' : 'Raw / deep dive'}</Button><span className="text-xs text-[var(--muted)]">Use raw rows when the parsed version looks suspicious; edit Version above before Apply.</span></div>
            {rawRows[reference.id] ? <RawRowsPanel data={rawRows[reference.id]!} /> : null}
            {failures[reference.id] ? <div className="mt-2 text-xs font-medium text-[#f0a0a0]">{failures[reference.id]}</div> : null}
          </div>
        })}
        {filteredFirmware.length > firmwareVisible ? <div className="p-4 text-center"><Button type="button" variant="ghost" disabled={busy} onClick={() => setFirmwareVisible((value) => value + MORE_VISIBLE)}>Show {Math.min(MORE_VISIBLE, filteredFirmware.length - firmwareVisible)} more Firmware rows</Button></div> : null}
      </div>
    </details>

    {linkedFamilyTasks.length ? <details className="border-b border-[var(--border)]">
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Model Families · {linkedFamilyTasks.length.toLocaleString()} linked Models without Family</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">{linkedFamilyTasks.map((model) => {
        const draft = familyDrafts[model.id] ?? { familyId: '', name: '' }
        const options = assist.models.families.filter((family) => family.isActive && family.vendorId === model.vendorId).map((family) => ({ id: family.id, label: family.name, keywords: [family.name] }))
        return <div key={model.id} className="grid gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(250px,.9fr)_minmax(260px,1fr)_minmax(230px,.8fr)] lg:items-end"><div><div className="text-sm font-semibold">{model.vendor.name} · {model.model}</div><div className="text-xs text-[var(--muted)]">{model.supportedPlatforms.map((item) => item.platform).join(', ') || model.platform || 'Platform unknown'}</div></div>{field({ label: 'Existing Family', children: <SearchableReferencePicker id={`linked-family-${model.id}`} value={draft.familyId} options={options} disabled={busy} placeholder="Search Family…" onChange={(value) => setFamilyDrafts((current) => ({ ...current, [model.id]: { familyId: value, name: value ? '' : draft.name } }))} /> })}{field({ label: 'Or new Family name', children: <TextInput value={draft.name} disabled={busy || Boolean(draft.familyId)} onChange={(event) => setFamilyDrafts((current) => ({ ...current, [model.id]: { familyId: '', name: event.target.value } }))} /> })}</div>
      })}</div>
    </details> : null}

    {coreRefs.length ? <details className="border-b border-[var(--border)]">
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Other imported vocabulary · {coreRefs.length.toLocaleString()}</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">{coreRefs.map((reference) => {
        const draft = coreDrafts[reference.id]
        if (!draft) return null
        const records = reference.kind === 'CUSTOMER' ? assist.workspace.options.customers : reference.kind === 'VENDOR' ? assist.workspace.options.vendors : assist.workspace.options.deviceTypes
        return <div key={reference.id} className="grid gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(220px,.8fr)_minmax(280px,1fr)_minmax(200px,.7fr)] lg:items-end"><div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">{reference.kind.replaceAll('_', ' ')}</div><div className="mt-1 font-mono text-sm font-semibold">{reference.sourceValue}</div></div>{field({ label: 'Existing target', children: <SearchableReferencePicker id={`core-existing-${reference.id}`} value={draft.existingTargetId} options={pickerOptions(records)} disabled={busy} placeholder="Search existing; leave blank to create…" onChange={(value) => setCoreDrafts((current) => ({ ...current, [reference.id]: { ...draft, existingTargetId: value } }))} /> })}{field({ label: draft.existingTargetId ? 'Existing selected' : 'New name / code', children: draft.existingTargetId ? <div className="flex h-10 items-center text-xs text-[var(--muted)]">Will link existing record</div> : <div className="grid grid-cols-2 gap-2"><TextInput value={draft.name} disabled={busy} onChange={(event) => setCoreDrafts((current) => ({ ...current, [reference.id]: { ...draft, name: event.target.value } }))} /><TextInput value={draft.code} disabled={busy} onChange={(event) => setCoreDrafts((current) => ({ ...current, [reference.id]: { ...draft, code: event.target.value } }))} /></div> })}</div>
      })}</div>
    </details> : null}

    <div className="sticky bottom-2 z-20 m-3 rounded-lg border border-[var(--accent)] bg-[var(--surface-raised)]/95 px-4 py-3 shadow-lg backdrop-blur sm:m-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm"><strong>{prepared.toLocaleString()}</strong> mappings ready · <strong className={pending ? 'text-amber-200' : ''}>{pending.toLocaleString()}</strong> need input · Contract Type is intentionally not imported.</div><Button type="button" variant="primary" disabled={busy || !prepared || Boolean(pending)} onClick={() => void applyAll()}>{busy ? 'Applying worksheet…' : `Apply worksheet (${prepared.toLocaleString()})`}</Button></div>
      {plan.errors.length ? <div className="mt-2 text-xs text-amber-200">{plan.errors.slice(0, 5).join(' · ')}{plan.errors.length > 5 ? ` · +${plan.errors.length - 5} more` : ''}</div> : null}
    </div>
  </section>
}

function RawRowsPanel({ data }: { data: NonNullable<RawPayload['data']> }) {
  return <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
    <div className="mb-2 text-xs text-[var(--muted)]">Showing {data.rows.length.toLocaleString()} sampled source row{data.rows.length === 1 ? '' : 's'} for {data.occurrenceCount.toLocaleString()} occurrence{data.occurrenceCount === 1 ? '' : 's'}{data.sampled ? ' (sample)' : ''}.</div>
    <div className="space-y-3">{data.rows.map((row) => <details key={row.rowNumber} className="rounded border border-[var(--border)] bg-[var(--surface-raised)]"><summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Row {row.rowNumber} · {rowIdentity(row)}</summary><div className="grid gap-3 border-t border-[var(--border)] p-3 lg:grid-cols-2"><div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Raw XLSX row</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(row.rawData, null, 2)}</pre></div><div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Mapped values</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(row.mappedData, null, 2)}</pre></div></div></details>)}</div>
  </div>
}
