'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SearchableReferencePicker } from '@/components/devices/searchable-reference-picker'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import type {
  DeviceImportPreview,
  DeviceImportReferenceKind,
  DeviceImportResult,
} from '@/lib/device-import'

const SAFE_SUGGESTION_SCORE = 0.97
const MAX_CHUNK = 250
const MAX_SAFE_PASSES = 8

type ApiError = { error?: { message?: string } }
type ReferenceMetadata = {
  customerTargetId?: string | null
  vendorTargetId?: string | null
  deviceTypeTargetId?: string | null
  modelTargetId?: string | null
  platform?: string | null
  platforms?: string[]
  waitingFor?: DeviceImportReferenceKind[]
}
type StagedReference = {
  id: string
  kind: DeviceImportReferenceKind
  sourceValue: string
  metadata: ReferenceMetadata
  status: 'UNRESOLVED' | 'WAITING' | 'LINKED'
  targetId: string | null
  targetLabel: string | null
  suggestedTargetId: string | null
  suggestedTargetLabel: string | null
  suggestionScore: number | null
  occurrenceCount: number
}
type WorkspaceOptions = {
  customers: Array<{ id: string; code: string | null; name: string; isActive: boolean }>
  sites: Array<{ id: string; customerId: string; code: string | null; name: string; isActive: boolean }>
  vendors: Array<{ id: string; code: string; name: string; isActive: boolean }>
  deviceTypes: Array<{ id: string; code: string; name: string; isActive: boolean }>
  models: Array<{
    id: string
    vendorId: string
    deviceTypeId: string
    model: string
    platform: string | null
    isActive: boolean
    vendor: { id: string; name: string }
    deviceType: { id: string; name: string }
  }>
  contracts: Array<{ id: string; code: string; name: string; isActive: boolean }>
  firmwareReleases: Array<{
    id: string
    vendorId: string
    platform: string
    version: string
    status: string
    isActive: boolean
    vendor: { id: string; name: string }
  }>
}
type Workspace = {
  batch: {
    id: string
    profileId: string | null
    profileName: string | null
    fileName: string
    sheetName: string
    status: string
    totalRows: number
    publishedAt: string | null
  }
  counts: {
    references: {
      total: number
      linked: number
      unresolved: number
      byKind: Record<string, { total: number; linked: number; unresolved: number; waiting: number }>
    }
    rows: { total: number; sample: number }
  }
  references: StagedReference[]
  rows: Array<{ id: string; rowNumber: number; mappedData: unknown; status: string }>
  options: WorkspaceOptions
  canValidate: boolean
  canPublish: boolean
}
type CoreProposal = {
  referenceId: string
  kind: 'CUSTOMER' | 'VENDOR' | 'DEVICE_TYPE' | 'CONTRACT_TYPE'
  sourceValue: string
  occurrenceCount: number
  proposedName: string
  proposedCode: string
  suggestedTargetId: string | null
  suggestionScore: number | null
}
type SiteProposal = {
  key: string
  customerId: string
  customerName: string
  customerCode: string | null
  referenceIds: string[]
  sourceValues: string[]
  organizationSiteSourceValues: string[]
  name: string
  code: string
  existingTarget: { id: string; name: string; code: string | null } | null
}
type Family = { id: string; vendorId: string; name: string; isActive: boolean }
type ReadyModel = {
  id: string
  sourceValue: string
  vendorTargetId: string
  vendorName: string
  vendorCode: string
  deviceTypeTargetId: string
  deviceTypeName: string
  deviceTypeCode: string
  proposedModel: string
  proposedPlatform: string
  proposedPlatforms: string[]
  suggestedFamilyId: string | null
  suggestedFamilyName: string | null
  proposedNewFamilyName: string | null
}
type LinkedModel = {
  id: string
  vendorId: string
  deviceTypeId: string
  familyId: string | null
  model: string
  platform: string | null
  supportedPlatforms: Array<{ id: string; platform: string }>
  vendor: { id: string; code: string; name: string }
  deviceType: { id: string; code: string; name: string }
  family: Family | null
  sourceValues: string[]
  suggestedFamilyId: string | null
  suggestedFamilyName: string | null
  proposedNewFamilyName: string | null
}
type NewFamilyProposal = {
  key: string
  vendorId: string
  vendorName: string
  name: string
  modelIds: string[]
  modelNames: string[]
}
type FirmwareProposal = {
  key: string
  vendorId: string
  vendorName: string
  vendorCode: string
  referenceIds: string[]
  versions: string[]
  version: string
  platform: string
  modelIds: string[]
  modelNames: string[]
  status: string
  existingTarget: { id: string; version: string; platform: string; status: string } | null
}
type SmartGroup = {
  field: 'customer' | 'site' | 'vendor' | 'deviceType' | 'model'
  value: string
  count: number
  sampleRows: number[]
}
type AssistData = {
  workspace: Workspace
  core: { proposals: CoreProposal[] }
  sites: {
    proposals: SiteProposal[]
    rawReferenceCount: number
    proposalCount: number
    duplicateReferenceCount: number
    normalizableGenericRowCount: number
  }
  models: {
    readyToCreate: ReadyModel[]
    linkedModels: LinkedModel[]
    families: Family[]
    newFamilyProposals: NewFamilyProposal[]
  }
  firmware: { proposals: FirmwareProposal[]; rawReferenceCount: number; proposalCount: number }
  rows: { profileId: string | null; groups: SmartGroup[]; rowCounts: Record<string, number> }
}
type AssistPayload = { data?: AssistData } & ApiError
type WorkspacePayload = { data?: Workspace } & ApiError
type PreviewPayload = { data?: DeviceImportPreview } & ApiError
type ResultPayload = { data?: DeviceImportResult } & ApiError

type CoreDraft = CoreProposal & { include: boolean; name: string; code: string }
type SiteDraft = SiteProposal & { include: boolean }
type ModelDraft = ReadyModel & {
  include: boolean
  model: string
  platform: string
  platformsText: string
  familyId: string
}
type FamilyDraft = NewFamilyProposal & { include: boolean }
type FirmwareDraft = FirmwareProposal & { include: boolean }

const KIND_LABELS: Record<DeviceImportReferenceKind, string> = {
  CUSTOMER: 'Customers',
  SITE: 'Sites',
  VENDOR: 'Vendors',
  DEVICE_TYPE: 'Device types',
  DEVICE_MODEL: 'Models',
  FIRMWARE_RELEASE: 'Firmware',
  CONTRACT_TYPE: 'Contracts',
}
const STATUSES = ['AVAILABLE', 'TESTING', 'APPROVED', 'RECOMMENDED', 'DEPRECATED', 'BLOCKED'] as const

function samePlatform(left: string, right: string) {
  return left.normalize('NFKC').trim().toLocaleLowerCase('en-US') === right.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function mappedValue(mappedData: unknown, field: string) {
  const record = typeof mappedData === 'object' && mappedData !== null ? mappedData as Record<string, unknown> : {}
  const value = record[field]
  return typeof value === 'string' && value.trim() ? value : null
}

function referenceOptions(reference: StagedReference, options: WorkspaceOptions) {
  if (reference.kind === 'CUSTOMER') {
    return options.customers.filter((record) => record.isActive).map((record) => ({
      id: record.id,
      label: `${record.name}${record.code ? ` (${record.code})` : ''}`,
      keywords: [record.name, record.code ?? ''],
    }))
  }
  if (reference.kind === 'SITE') {
    return options.sites.filter((record) => record.isActive && record.customerId === reference.metadata.customerTargetId).map((record) => ({
      id: record.id,
      label: `${record.name}${record.code ? ` (${record.code})` : ''}`,
      keywords: [record.name, record.code ?? ''],
    }))
  }
  if (reference.kind === 'VENDOR') {
    return options.vendors.filter((record) => record.isActive).map((record) => ({
      id: record.id,
      label: `${record.name} (${record.code})`,
      keywords: [record.name, record.code],
    }))
  }
  if (reference.kind === 'DEVICE_TYPE') {
    return options.deviceTypes.filter((record) => record.isActive).map((record) => ({
      id: record.id,
      label: `${record.name} (${record.code})`,
      keywords: [record.name, record.code],
    }))
  }
  if (reference.kind === 'DEVICE_MODEL') {
    return options.models.filter((record) =>
      record.isActive &&
      (!reference.metadata.vendorTargetId || record.vendorId === reference.metadata.vendorTargetId) &&
      (!reference.metadata.deviceTypeTargetId || record.deviceTypeId === reference.metadata.deviceTypeTargetId),
    ).map((record) => ({
      id: record.id,
      label: `${record.vendor.name} · ${record.model} · ${record.deviceType.name}`,
      keywords: [record.model, record.vendor.name, record.deviceType.name, record.platform ?? ''],
    }))
  }
  if (reference.kind === 'CONTRACT_TYPE') {
    return options.contracts.filter((record) => record.isActive).map((record) => ({
      id: record.id,
      label: `${record.name} (${record.code})`,
      keywords: [record.name, record.code],
    }))
  }
  return options.firmwareReleases.filter((record) =>
    record.isActive &&
    (!reference.metadata.vendorTargetId || record.vendorId === reference.metadata.vendorTargetId) &&
    (!reference.metadata.platform || samePlatform(record.platform, reference.metadata.platform)),
  ).map((record) => ({
    id: record.id,
    label: `${record.vendor.name} · ${record.platform} · ${record.version} · ${record.status}`,
    keywords: [record.version, record.platform, record.vendor.name, record.status],
  }))
}

function contextLabel(reference: StagedReference, options: WorkspaceOptions) {
  if (reference.kind === 'SITE') {
    const customer = options.customers.find((record) => record.id === reference.metadata.customerTargetId)
    return `Customer: ${customer?.name ?? 'waiting for Customer'}`
  }
  if (reference.kind === 'DEVICE_MODEL') {
    const vendor = options.vendors.find((record) => record.id === reference.metadata.vendorTargetId)
    const type = options.deviceTypes.find((record) => record.id === reference.metadata.deviceTypeTargetId)
    return `Vendor: ${vendor?.name ?? 'waiting'} · Type: ${type?.name ?? 'waiting'}`
  }
  if (reference.kind === 'FIRMWARE_RELEASE') {
    const vendor = options.vendors.find((record) => record.id === reference.metadata.vendorTargetId)
    return `Vendor: ${vendor?.name ?? 'waiting'} · Platform: ${reference.metadata.platform ?? reference.metadata.platforms?.join(', ') ?? 'waiting'}`
  }
  return null
}

function sectionClass() {
  return 'rounded-lg border border-[var(--border)] bg-[var(--surface)]'
}

export function DeviceImportReconciliationWorkspace({ batchId, reconciliationWorksheet }: { batchId: string; reconciliationWorksheet?: ReactNode }) {
  const [data, setData] = useState<AssistData | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [selectedRows, setSelectedRows] = useState<number[]>([])
  const [coreDrafts, setCoreDrafts] = useState<CoreDraft[]>([])
  const [siteDrafts, setSiteDrafts] = useState<SiteDraft[]>([])
  const [modelDrafts, setModelDrafts] = useState<ModelDraft[]>([])
  const [familyDrafts, setFamilyDrafts] = useState<FamilyDraft[]>([])
  const [familyChoices, setFamilyChoices] = useState<Record<string, string>>({})
  const [firmwareDrafts, setFirmwareDrafts] = useState<FirmwareDraft[]>([])
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null)
  const [result, setResult] = useState<DeviceImportResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const install = useCallback((next: AssistData) => {
    setData(next)
    setChoices({})
    setSelectedRows([])
    setCoreDrafts(next.core.proposals.map((proposal) => ({
      ...proposal,
      include: !proposal.suggestedTargetId,
      name: proposal.proposedName,
      code: proposal.proposedCode,
    })))
    setSiteDrafts(next.sites.proposals.map((proposal) => ({ ...proposal, include: true })))
    setModelDrafts(next.models.readyToCreate.map((proposal) => ({
      ...proposal,
      include: true,
      model: proposal.proposedModel,
      platform: proposal.proposedPlatform,
      platformsText: proposal.proposedPlatforms.join(', '),
      familyId: proposal.suggestedFamilyId ?? '',
    })))
    setFamilyDrafts(next.models.newFamilyProposals.map((proposal) => ({ ...proposal, include: true })))
    setFamilyChoices({})
    setFirmwareDrafts(next.firmware.proposals.map((proposal) => ({ ...proposal, include: Boolean(proposal.platform) })))
  }, [])

  const reload = useCallback(async () => {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The import reconciliation workspace could not be loaded.')
    install(payload.data)
    return payload.data
  }, [batchId, install])

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/assist`)
      .then(async (response) => {
        const payload = await response.json() as AssistPayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The import reconciliation workspace could not be loaded.')
        return payload.data
      })
      .then(
        (next) => { if (!cancelled) install(next) },
        (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The import reconciliation workspace could not be loaded.') },
      )
    return () => { cancelled = true }
  }, [batchId, install])

  const unresolved = useMemo(() => data?.workspace.references.filter((reference) => reference.status === 'UNRESOLVED') ?? [], [data])
  const waiting = useMemo(() => data?.workspace.references.filter((reference) => reference.status === 'WAITING') ?? [], [data])
  const chosen = useMemo(() => unresolved.flatMap((reference) => {
    const targetId = choices[reference.id]
    return targetId ? [{ referenceId: reference.id, targetId }] : []
  }), [unresolved, choices])
  const safeCount = useMemo(() => unresolved.filter((reference) => reference.suggestedTargetId && (reference.suggestionScore ?? 0) >= SAFE_SUGGESTION_SCORE).length, [unresolved])
  const selectedCore = useMemo(() => coreDrafts.filter((draft) => draft.include), [coreDrafts])
  const selectedSites = useMemo(() => siteDrafts.filter((draft) => draft.include), [siteDrafts])
  const selectedModels = useMemo(() => modelDrafts.filter((draft) => draft.include), [modelDrafts])
  const selectedFamilies = useMemo(() => familyDrafts.filter((draft) => draft.include), [familyDrafts])
  const selectedFirmware = useMemo(() => firmwareDrafts.filter((draft) => draft.include), [firmwareDrafts])
  const suggestedFamilyAssignments = useMemo(() => data?.models.linkedModels.flatMap((model) =>
    !model.familyId && model.suggestedFamilyId
      ? [{ modelId: model.id, familyId: model.suggestedFamilyId }]
      : [],
  ) ?? [], [data])
  const manualFamilyAssignments = useMemo(() => data?.models.linkedModels.flatMap((model) => {
    const familyId = familyChoices[model.id]
    return familyId && familyId !== model.familyId ? [{ modelId: model.id, familyId }] : []
  }) ?? [], [data, familyChoices])
  const preparedCount = selectedCore.length + selectedSites.length + selectedModels.length + selectedFamilies.length + selectedFirmware.length + suggestedFamilyAssignments.length

  async function actionRequest(url: string, body: unknown) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as ApiError & { data?: unknown }
    if (!response.ok) throw new Error(payload.error?.message ?? 'The import action could not be completed.')
    return payload.data
  }

  async function applySafeSuggestions() {
    if (!data || !safeCount) return
    setBusy('safe')
    setError(null)
    setNotice(null)
    try {
      let workspace = data.workspace
      let applied = 0
      for (let pass = 0; pass < MAX_SAFE_PASSES; pass += 1) {
        const suggestions = workspace.references.filter((reference) =>
          reference.status === 'UNRESOLVED' &&
          reference.suggestedTargetId &&
          (reference.suggestionScore ?? 0) >= SAFE_SUGGESTION_SCORE,
        ).slice(0, MAX_CHUNK)
        if (!suggestions.length) break
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: suggestions.map((reference) => ({
              referenceId: reference.id,
              targetId: reference.suggestedTargetId,
              remember: Boolean(workspace.batch.profileId),
            })),
          }),
        })
        const payload = await response.json() as WorkspacePayload
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Safe suggestions could not be applied.')
        workspace = payload.data
        applied += suggestions.length
      }
      await reload()
      setNotice(`Applied ${applied.toLocaleString()} high-confidence mapping${applied === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Safe suggestions could not be applied.')
    } finally {
      setBusy(null)
    }
  }

  async function linkChosen(remember: boolean) {
    if (!chosen.length) return
    setBusy('link')
    setError(null)
    try {
      await actionRequest(`/api/v1/device-import/batches/${batchId}/references/bulk`, {
        items: chosen.map((item) => ({ ...item, remember })),
      })
      await reload()
      setNotice(`${chosen.length.toLocaleString()} mapping${chosen.length === 1 ? '' : 's'} ${remember ? `remembered for ${data?.workspace.batch.profileName ?? 'the import profile'}` : 'linked for this import'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The mappings could not be applied.')
    } finally {
      setBusy(null)
    }
  }

  async function createPreparedCore() {
    for (let index = 0; index < selectedCore.length; index += MAX_CHUNK) {
      const chunk = selectedCore.slice(index, index + MAX_CHUNK)
      await actionRequest(`/api/v1/device-import/batches/${batchId}/references/assist`, {
        items: chunk.map((draft) => ({ referenceId: draft.referenceId, name: draft.name, code: draft.code })),
      })
    }
  }

  async function createPreparedSites() {
    for (let index = 0; index < selectedSites.length; index += MAX_CHUNK) {
      const chunk = selectedSites.slice(index, index + MAX_CHUNK)
      await actionRequest(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`, {
        items: chunk.map((draft) => ({ referenceIds: draft.referenceIds, name: draft.name, code: draft.code })),
      })
    }
  }

  async function createPreparedModels() {
    for (let index = 0; index < selectedModels.length; index += MAX_CHUNK) {
      const chunk = selectedModels.slice(index, index + MAX_CHUNK)
      await actionRequest(`/api/v1/device-import/batches/${batchId}/models/assist`, {
        action: 'CREATE_MODELS',
        items: chunk.map((draft) => ({
          referenceId: draft.id,
          model: draft.model,
          platform: draft.platform || null,
          platforms: draft.platformsText.split(',').map((value) => value.trim()).filter(Boolean),
          familyId: draft.familyId || null,
        })),
      })
    }
  }

  async function assignFamilies(items: Array<{ modelId: string; familyId: string }>) {
    for (let index = 0; index < items.length; index += MAX_CHUNK) {
      await actionRequest(`/api/v1/device-import/batches/${batchId}/models/assist`, {
        action: 'ASSIGN_FAMILIES',
        items: items.slice(index, index + MAX_CHUNK),
      })
    }
  }

  async function createPreparedFamilies() {
    for (let index = 0; index < selectedFamilies.length; index += MAX_CHUNK) {
      const chunk = selectedFamilies.slice(index, index + MAX_CHUNK)
      await actionRequest(`/api/v1/device-import/batches/${batchId}/models/assist`, {
        action: 'CREATE_FAMILIES',
        items: chunk.map((draft) => ({ vendorId: draft.vendorId, name: draft.name, modelIds: draft.modelIds })),
      })
    }
  }

  async function createPreparedFirmware() {
    for (let index = 0; index < selectedFirmware.length; index += MAX_CHUNK) {
      const chunk = selectedFirmware.slice(index, index + MAX_CHUNK)
      await actionRequest(`/api/v1/device-import/batches/${batchId}/firmware/assist`, {
        items: chunk.map((draft) => ({
          referenceIds: draft.referenceIds,
          version: draft.version,
          platform: draft.platform,
          status: draft.status,
        })),
      })
    }
  }

  async function applyPrepared() {
    if (!preparedCount) return
    setBusy('prepared')
    setError(null)
    setNotice(null)
    try {
      if (selectedCore.length) await createPreparedCore()
      if (selectedSites.length) await createPreparedSites()
      if (selectedModels.length) await createPreparedModels()
      if (suggestedFamilyAssignments.length) await assignFamilies(suggestedFamilyAssignments)
      if (manualFamilyAssignments.length) await assignFamilies(manualFamilyAssignments)
      if (selectedFamilies.length) await createPreparedFamilies()
      if (selectedFirmware.length) await createPreparedFirmware()
      await reload()
      setNotice(`Applied ${preparedCount.toLocaleString()} prepared create/assignment action${preparedCount === 1 ? '' : 's'}. Newly-unblocked proposals are ready below.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Prepared actions could not be applied.')
      await reload().catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  async function normalizeGenericSites() {
    setBusy('normalize-sites')
    setError(null)
    try {
      await actionRequest(`/api/v1/device-import/batches/${batchId}/sites/bulk-create`, { action: 'NORMALIZE_GENERIC_SITES' })
      await reload()
      setNotice('Generic staged Site values were rebuilt from the Organization/Site context.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Generic Site values could not be normalized.')
    } finally {
      setBusy(null)
    }
  }

  async function rowAction(action: 'IGNORE' | 'EXCLUDE' | 'RESTORE', input: { rowNumbers?: number[]; field?: SmartGroup['field']; value?: string }, remember = false) {
    setBusy('rows')
    setError(null)
    try {
      await actionRequest(`/api/v1/device-import/batches/${batchId}/rows/actions`, { action, remember, ...input })
      await reload()
      setNotice(`${action === 'EXCLUDE' ? 'Excluded' : action === 'RESTORE' ? 'Restored' : 'Ignored'} matching staged device rows${remember ? ` and saved the rule for ${data?.workspace.batch.profileName ?? 'the import profile'}` : ''}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The staged row action could not be applied.')
    } finally {
      setBusy(null)
    }
  }

  async function validate() {
    setBusy('validate')
    setError(null)
    setPreview(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/validate`, { method: 'POST' })
      const payload = await response.json() as PreviewPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Device validation failed.')
      setPreview(payload.data)
      setNotice('Device validation completed. Review the result below before publishing.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Device validation failed.')
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    setBusy('publish')
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/publish`, { method: 'POST' })
      const payload = await response.json() as ResultPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The staged batch could not be published.')
      setResult(payload.data)
      await reload()
      setNotice(`Published ${payload.data.created.toLocaleString()} new and ${payload.data.updated.toLocaleString()} updated device${payload.data.created + payload.data.updated === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The staged batch could not be published.')
    } finally {
      setBusy(null)
    }
  }

  if (!data) {
    return <>
      <PageHeader eyebrow="Inventory import" title="Assisted reconciliation" description="Preparing import proposals." />
      <div className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</div>
    </>
  }

  const { workspace } = data
  const published = workspace.batch.status === 'PUBLISHED'
  const rowCounts = data.rows.rowCounts
  const activeRows = rowCounts.STAGED ?? 0
  const ignoredRows = rowCounts.IGNORED ?? 0
  const excludedRows = rowCounts.EXCLUDED ?? 0
  const linkedRefs = workspace.counts.references.linked
  const totalRefs = workspace.counts.references.total

  return <>
    <PageHeader
      eyebrow="Staged inventory"
      title="Assisted import reconciliation"
      description={`${workspace.batch.fileName} · ${workspace.batch.profileName ?? 'No saved profile'} · raw data remains quarantined until final publish.`}
      actions={<Link href="/devices/import" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Import inbox</Link>}
    />

    {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <div className="sticky top-2 z-30 mb-5 rounded-lg border border-[var(--accent)] bg-[var(--surface-raised)]/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <strong>{linkedRefs}/{totalRefs} entities linked</strong>
          <span>{activeRows.toLocaleString()} active devices</span>
          {ignoredRows ? <span>{ignoredRows.toLocaleString()} ignored</span> : null}
          {excludedRows ? <span>{excludedRows.toLocaleString()} excluded</span> : null}
          {waiting.length ? <span className="text-amber-200">{waiting.length} waiting</span> : null}
        </div>
        {!published ? <div className="flex flex-wrap items-center gap-2">
          {!reconciliationWorksheet ? <>
            <Button type="button" variant="primary" disabled={Boolean(busy) || !safeCount} onClick={() => void applySafeSuggestions()}>
              {busy === 'safe' ? 'Applying…' : `Apply ${safeCount} safe match${safeCount === 1 ? '' : 'es'}`}
            </Button>
            <Button type="button" variant="primary" disabled={Boolean(busy) || !preparedCount} onClick={() => void applyPrepared()}>
              {busy === 'prepared' ? 'Creating…' : `Apply ${preparedCount} prepared action${preparedCount === 1 ? '' : 's'}`}
            </Button>
            <Button type="button" variant="ghost" disabled={Boolean(busy) || !chosen.length} onClick={() => void linkChosen(false)}>Link {chosen.length || ''} once</Button>
            <Button type="button" variant="ghost" disabled={Boolean(busy) || !chosen.length || !workspace.batch.profileId} onClick={() => void linkChosen(true)}>Remember {chosen.length || ''}</Button>
          </> : null}
          {selectedRows.length ? <>
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void rowAction('EXCLUDE', { rowNumbers: selectedRows })}>Exclude {selectedRows.length}</Button>
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void rowAction('IGNORE', { rowNumbers: selectedRows })}>Ignore {selectedRows.length}</Button>
          </> : null}
        </div> : <strong className="text-sm text-[var(--accent-light)]">Published</strong>}
      </div>
    </div>

    <section className={`${sectionClass()} mb-5 p-4 sm:p-5`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Source rows</div><div className="mt-1 text-xl font-semibold">{workspace.batch.totalRows.toLocaleString()}</div></div>
        <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Active</div><div className="mt-1 text-xl font-semibold">{activeRows.toLocaleString()}</div></div>
        <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Ignored</div><div className="mt-1 text-xl font-semibold">{ignoredRows.toLocaleString()}</div></div>
        <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Excluded</div><div className="mt-1 text-xl font-semibold">{excludedRows.toLocaleString()}</div></div>
        <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Needs entity review</div><div className="mt-1 text-xl font-semibold">{workspace.counts.references.unresolved.toLocaleString()}</div></div>
      </div>
    </section>

    {!published && data.rows.groups.length ? <details className={`${sectionClass()} mb-5`}>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Smart ignore / exclude groups</summary>
      <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5">
        <p className="mb-3 text-xs text-[var(--muted)]">Generated from repeated imported values. Ignore keeps the raw evidence but removes matching rows from reconciliation/publication. Remembering creates a reusable rule for this export profile.</p>
        <div className="space-y-2">{data.rows.groups.slice(0, 30).map((group) => <div key={`${group.field}:${group.value}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
          <div><strong className="text-sm">{group.field}: {group.value}</strong><div className="text-xs text-[var(--muted)]">{group.count.toLocaleString()} device rows</div></div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void rowAction('EXCLUDE', { field: group.field, value: group.value })}>Exclude once</Button>
            <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void rowAction('IGNORE', { field: group.field, value: group.value })}>Ignore this import</Button>
            <Button type="button" variant="primary" disabled={Boolean(busy) || !workspace.batch.profileId} onClick={() => void rowAction('IGNORE', { field: group.field, value: group.value }, true)}>Always ignore for {workspace.batch.profileName ?? 'profile'}</Button>
          </div>
        </div>)}</div>
      </div>
    </details> : null}

    {reconciliationWorksheet ? reconciliationWorksheet : <>
    {!published && unresolved.length ? <details className={`${sectionClass()} mb-5`} open>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Existing-link suggestions and exceptions · {unresolved.length}</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
        {unresolved.map((reference) => {
          const options = referenceOptions(reference, workspace.options)
          const context = contextLabel(reference, workspace.options)
          return <div key={reference.id} className="grid gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(220px,.8fr)_minmax(320px,1.2fr)] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-sm">{reference.sourceValue}</strong><span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">{KIND_LABELS[reference.kind]}</span></div>
              {context ? <div className="mt-1 text-xs text-[var(--muted-strong)]">{context}</div> : null}
              <div className="mt-1 text-xs text-[var(--muted)]">{reference.occurrenceCount.toLocaleString()} occurrence{reference.occurrenceCount === 1 ? '' : 's'}{reference.suggestedTargetId ? ` · suggestion ${Math.round((reference.suggestionScore ?? 0) * 100)}%: ${reference.suggestedTargetLabel}` : ''}</div>
            </div>
            <FormField label="Link to existing" htmlFor={`unified-ref-${reference.id}`} description="Type code/name/model/version. Enter selects when one result remains.">
              <SearchableReferencePicker id={`unified-ref-${reference.id}`} value={choices[reference.id] ?? ''} options={options} disabled={Boolean(busy)} onChange={(value) => setChoices((current) => ({ ...current, [reference.id]: value }))} />
            </FormField>
          </div>
        })}
      </div>
    </details> : null}

    {!published && coreDrafts.length ? <details className={`${sectionClass()} mb-5`} open>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Customers, Vendors, Device Types & Contracts · {coreDrafts.length} proposed</summary>
      <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">{coreDrafts.map((draft) => <div key={draft.referenceId} className="grid gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[34px_minmax(170px,.7fr)_minmax(240px,1fr)_minmax(170px,.65fr)] lg:items-end">
        <label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={Boolean(busy)} onChange={(event) => setCoreDrafts((current) => current.map((item) => item.referenceId === draft.referenceId ? { ...item, include: event.target.checked } : item))} aria-label={`Create ${draft.sourceValue}`} /></label>
        <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">{KIND_LABELS[draft.kind]}</div><div className="mt-1 font-mono text-sm font-semibold">{draft.sourceValue}</div><div className="text-xs text-[var(--muted)]">{draft.occurrenceCount} occurrences{draft.suggestedTargetId ? ' · existing suggestion available, creation unchecked by default' : ''}</div></div>
        <div><label className="mb-1 block text-xs font-semibold" htmlFor={`core-name-${draft.referenceId}`}>Proposed name</label><TextInput id={`core-name-${draft.referenceId}`} value={draft.name} disabled={Boolean(busy)} onChange={(event) => setCoreDrafts((current) => current.map((item) => item.referenceId === draft.referenceId ? { ...item, name: event.target.value } : item))} /></div>
        <div><label className="mb-1 block text-xs font-semibold" htmlFor={`core-code-${draft.referenceId}`}>Code</label><TextInput id={`core-code-${draft.referenceId}`} value={draft.code} disabled={Boolean(busy)} onChange={(event) => setCoreDrafts((current) => current.map((item) => item.referenceId === draft.referenceId ? { ...item, code: event.target.value.toUpperCase() } : item))} /></div>
      </div>)}</div>
    </details> : null}

    {!published && (siteDrafts.length || data.sites.normalizableGenericRowCount) ? <details className={`${sectionClass()} mb-5`} open>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Sites · {siteDrafts.length} proposed</summary>
      <div className="border-t border-[var(--border)] px-4 py-3 sm:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--muted)]">Customer is always shown. Names/codes are prefilled; edit only exceptions.</p>{data.sites.normalizableGenericRowCount ? <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void normalizeGenericSites()}>{busy === 'normalize-sites' ? 'Normalizing…' : `Normalize ${data.sites.normalizableGenericRowCount} legacy generic Site rows`}</Button> : null}</div>
        <div className="space-y-2">{siteDrafts.map((draft) => <div key={draft.key} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 lg:grid-cols-[34px_minmax(180px,.7fr)_minmax(240px,1fr)_minmax(180px,.65fr)] lg:items-end">
          <label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={Boolean(busy)} onChange={(event) => setSiteDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, include: event.target.checked } : item))} aria-label={`Create Site ${draft.name}`} /></label>
          <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Customer</div><div className="mt-1 text-sm font-semibold">{draft.customerName}</div><div className="text-xs text-[var(--muted)]">{draft.customerCode ?? ''}{draft.organizationSiteSourceValues.length ? ` · ${draft.organizationSiteSourceValues[0]}` : ''}</div></div>
          <div><label className="mb-1 block text-xs font-semibold" htmlFor={`site-name-${draft.key}`}>Proposed Site</label><TextInput id={`site-name-${draft.key}`} value={draft.name} disabled={Boolean(busy)} onChange={(event) => setSiteDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, name: event.target.value } : item))} />{draft.existingTarget ? <div className="mt-1 text-xs text-[var(--accent-light)]">Existing Site found; will link instead of duplicate.</div> : null}</div>
          <div><label className="mb-1 block text-xs font-semibold" htmlFor={`site-code-${draft.key}`}>Code</label><TextInput id={`site-code-${draft.key}`} value={draft.code} disabled={Boolean(busy) || Boolean(draft.existingTarget)} onChange={(event) => setSiteDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, code: event.target.value.toUpperCase() } : item))} /></div>
        </div>)}</div>
      </div>
    </details> : null}

    {!published && (modelDrafts.length || data.models.linkedModels.length) ? <details className={`${sectionClass()} mb-5`} open>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Models & Families · {modelDrafts.length} Model proposals · {selectedFamilies.length + suggestedFamilyAssignments.length} Family actions</summary>
      <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5">
        {modelDrafts.length ? <div className="space-y-2">{modelDrafts.map((draft) => {
          const familyOptions = data.models.families.filter((family) => family.isActive && family.vendorId === draft.vendorTargetId).map((family) => ({ id: family.id, label: family.name, keywords: [family.name, draft.vendorName] }))
          return <div key={draft.id} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 xl:grid-cols-[34px_minmax(150px,.55fr)_minmax(150px,.55fr)_minmax(220px,1fr)_minmax(210px,.85fr)_minmax(150px,.65fr)_minmax(200px,.8fr)] xl:items-end">
            <label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={Boolean(busy)} onChange={(event) => setModelDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, include: event.target.checked } : item))} aria-label={`Create Model ${draft.model}`} /></label>
            <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor</div><div className="mt-1 text-sm font-semibold">{draft.vendorName}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Type</div><div className="mt-1 text-sm font-semibold">{draft.deviceTypeName}</div></div>
            <div><label className="mb-1 block text-xs font-semibold" htmlFor={`model-name-${draft.id}`}>Concrete Model</label><TextInput id={`model-name-${draft.id}`} value={draft.model} disabled={Boolean(busy)} onChange={(event) => setModelDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, model: event.target.value } : item))} /><div className="mt-1 text-xs text-[var(--muted)]">Import: {draft.sourceValue}</div></div>
            <div><label className="mb-1 block text-xs font-semibold" htmlFor={`model-platforms-${draft.id}`}>Supported platforms</label><TextInput id={`model-platforms-${draft.id}`} value={draft.platformsText} disabled={Boolean(busy)} placeholder="e.g. AOS-8, AOS-10" onChange={(event) => setModelDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, platformsText: event.target.value } : item))} /><div className="mt-1 text-xs text-[var(--muted)]">Comma-separated. Inferred from imported devices where possible.</div></div>
            <div><label className="mb-1 block text-xs font-semibold" htmlFor={`model-platform-${draft.id}`}>Preferred</label><TextInput id={`model-platform-${draft.id}`} value={draft.platform} disabled={Boolean(busy)} placeholder="Optional" onChange={(event) => setModelDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, platform: event.target.value } : item))} /></div>
            <FormField label="Family" htmlFor={`model-family-${draft.id}`} description={draft.proposedNewFamilyName ? `Suggested new: ${draft.proposedNewFamilyName}` : undefined}><SearchableReferencePicker id={`model-family-${draft.id}`} value={draft.familyId} options={familyOptions} disabled={Boolean(busy)} placeholder={draft.suggestedFamilyName ?? 'Optional'} onChange={(value) => setModelDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, familyId: value } : item))} /></FormField>
          </div>
        })}</div> : null}

        {data.models.linkedModels.some((model) => !model.familyId) ? <div className="mt-5 border-t border-[var(--border)] pt-4"><h3 className="text-sm font-semibold">Family assignments</h3><p className="mt-1 text-xs text-[var(--muted)]">Existing Family matches are pre-suggested. New recognizable series are grouped below.</p><div className="mt-3 space-y-2">{data.models.linkedModels.filter((model) => !model.familyId).map((model) => {
          const options = data.models.families.filter((family) => family.isActive && family.vendorId === model.vendorId).map((family) => ({ id: family.id, label: family.name, keywords: [family.name, model.vendor.name] }))
          return <div key={model.id} className="grid gap-3 rounded-md border border-[var(--border)] p-3 lg:grid-cols-[minmax(260px,1fr)_minmax(280px,1fr)] lg:items-end"><div><strong className="text-sm">{model.vendor.name} · {model.model}</strong><div className="mt-1 text-xs text-[var(--muted)]">Platforms: {model.supportedPlatforms.map((entry) => entry.platform).join(', ') || model.platform || 'not known'}{model.suggestedFamilyName ? ` · suggested Family: ${model.suggestedFamilyName}` : model.proposedNewFamilyName ? ` · proposed new Family: ${model.proposedNewFamilyName}` : ''}</div></div><FormField label="Family override" htmlFor={`linked-family-${model.id}`}><SearchableReferencePicker id={`linked-family-${model.id}`} value={familyChoices[model.id] ?? ''} options={options} disabled={Boolean(busy)} placeholder={model.suggestedFamilyName ?? 'Choose only if needed'} onChange={(value) => setFamilyChoices((current) => ({ ...current, [model.id]: value }))} /></FormField></div>
        })}</div></div> : null}

        {familyDrafts.length ? <div className="mt-5 border-t border-[var(--border)] pt-4"><h3 className="text-sm font-semibold">Proposed new Families</h3><div className="mt-3 space-y-2">{familyDrafts.map((draft) => <div key={draft.key} className="grid gap-3 rounded-md border border-[var(--border)] p-3 lg:grid-cols-[34px_minmax(180px,.7fr)_minmax(240px,1fr)_minmax(260px,1fr)] lg:items-end"><label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={Boolean(busy)} onChange={(event) => setFamilyDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, include: event.target.checked } : item))} aria-label={`Create Family ${draft.name}`} /></label><div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor</div><div className="mt-1 text-sm font-semibold">{draft.vendorName}</div></div><div><label className="mb-1 block text-xs font-semibold" htmlFor={`family-name-${draft.key}`}>Suggested Family</label><TextInput id={`family-name-${draft.key}`} value={draft.name} disabled={Boolean(busy)} onChange={(event) => setFamilyDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, name: event.target.value } : item))} /></div><div className="text-xs text-[var(--muted)]">Assign to: {draft.modelNames.join(', ')}</div></div>)}</div></div> : null}
      </div>
    </details> : null}

    {!published && firmwareDrafts.length ? <details className={`${sectionClass()} mb-5`} open>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Firmware · {firmwareDrafts.length} Release proposals</summary>
      <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5"><div className="space-y-2">{firmwareDrafts.map((draft) => <div key={draft.key} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 xl:grid-cols-[34px_minmax(160px,.6fr)_minmax(180px,.7fr)_minmax(150px,.6fr)_minmax(160px,.65fr)_minmax(250px,1fr)] xl:items-end"><label className="flex h-10 items-center justify-center"><input type="checkbox" checked={draft.include} disabled={Boolean(busy) || !draft.platform} onChange={(event) => setFirmwareDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, include: event.target.checked } : item))} aria-label={`Create firmware ${draft.version}`} /></label><div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor</div><div className="mt-1 text-sm font-semibold">{draft.vendorName}</div></div><div><label className="mb-1 block text-xs font-semibold" htmlFor={`fw-platform-${draft.key}`}>Platform</label><TextInput id={`fw-platform-${draft.key}`} value={draft.platform} disabled={Boolean(busy) || Boolean(draft.existingTarget)} onChange={(event) => setFirmwareDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, platform: event.target.value, include: Boolean(event.target.value) } : item))} />{!draft.platform ? <div className="mt-1 text-xs text-amber-200">Needs platform before it is safe to create.</div> : null}</div><div><label className="mb-1 block text-xs font-semibold" htmlFor={`fw-version-${draft.key}`}>Version</label><TextInput id={`fw-version-${draft.key}`} value={draft.version} disabled={Boolean(busy) || Boolean(draft.existingTarget)} onChange={(event) => setFirmwareDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, version: event.target.value } : item))} /></div><div><label className="mb-1 block text-xs font-semibold" htmlFor={`fw-status-${draft.key}`}>Status</label><SelectInput id={`fw-status-${draft.key}`} value={draft.status} disabled={Boolean(busy) || Boolean(draft.existingTarget)} onChange={(event) => setFirmwareDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, status: event.target.value } : item))}>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</SelectInput></div><div><div className="text-xs uppercase tracking-wide text-[var(--muted)]">Imported Models</div><div className="mt-1 text-sm">{draft.modelNames.join(', ')}</div><div className="mt-1 text-xs text-[var(--muted)]">Raw: {draft.versions.join(', ')}{draft.existingTarget ? ' · existing Release will be linked' : ''}</div></div></div>)}</div></div>
    </details> : null}

    </>}

    <details className={`${sectionClass()} mb-5`} open>
      <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Devices · active, ignored and excluded rows</summary>
      <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--muted)]">Select sample rows to exclude/ignore. Group actions above are preferable for repeated categories such as Phones.</p>{!published ? <div className="flex gap-2"><Button type="button" variant="ghost" disabled={Boolean(busy) || workspace.counts.references.unresolved > 0} onClick={() => void validate()}>{busy === 'validate' ? 'Validating…' : 'Validate active devices'}</Button><Button type="button" variant="primary" disabled={Boolean(busy) || workspace.counts.references.unresolved > 0 || !preview || preview.counts.error > 0 || preview.counts.conflict > 0} onClick={() => void publish()}>{busy === 'publish' ? 'Publishing…' : 'Accept & publish active devices'}</Button></div> : null}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]"><th className="p-2"> </th><th className="p-2">Row</th><th className="p-2">Device</th><th className="p-2">Customer / Site</th><th className="p-2">Type / Model</th><th className="p-2">Platform</th><th className="p-2">Firmware</th><th className="p-2">Status</th></tr></thead><tbody>{workspace.rows.map((row) => <tr key={row.id} className="border-b border-[var(--border)]"><td className="p-2"><input type="checkbox" checked={selectedRows.includes(row.rowNumber)} disabled={Boolean(busy) || published} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...current, row.rowNumber] : current.filter((value) => value !== row.rowNumber))} aria-label={`Select row ${row.rowNumber}`} /></td><td className="p-2 font-mono text-xs">{row.rowNumber}</td><td className="p-2">{mappedValue(row.mappedData, 'name') ?? mappedValue(row.mappedData, 'hostname') ?? mappedValue(row.mappedData, 'externalId') ?? 'Unnamed'}</td><td className="p-2"><div>{mappedValue(row.mappedData, 'customer') ?? '—'}</div><div className="text-xs text-[var(--muted)]">{mappedValue(row.mappedData, 'site') ?? '—'}</div></td><td className="p-2"><div>{mappedValue(row.mappedData, 'deviceType') ?? '—'}</div><div className="text-xs text-[var(--muted)]">{mappedValue(row.mappedData, 'model') ?? '—'}</div></td><td className="p-2">{mappedValue(row.mappedData, 'platform') ?? '—'}</td><td className="p-2">{mappedValue(row.mappedData, 'currentFirmware') ?? '—'}</td><td className="p-2">{row.status}</td></tr>)}</tbody></table></div>

        {preview ? <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4"><h3 className="text-sm font-semibold">Device validation</h3><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>Create {preview.counts.create}</span><span>Update {preview.counts.update}</span><span>Unchanged {preview.counts.unchanged}</span><span>Conflicts {preview.counts.conflict}</span><span>Errors {preview.counts.error}</span></div>{preview.rows.some((row) => row.issues.length) ? <div className="mt-3 space-y-2">{preview.rows.filter((row) => row.issues.length).slice(0, 25).map((row) => <div key={row.rowNumber} className="text-xs"><strong>Row {row.rowNumber} · {row.identity}</strong> — {row.issues.map((issue) => issue.message).join(' · ')}</div>)}</div> : null}</div> : null}
        {result ? <div className="mt-4 text-sm text-[var(--accent-light)]">Published: {result.created} created · {result.updated} updated · {result.skipped} skipped.</div> : null}
      </div>
    </details>
  </>
}
