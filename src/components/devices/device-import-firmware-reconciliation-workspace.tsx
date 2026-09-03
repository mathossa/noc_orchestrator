'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { inferFirmwareTrainName } from '@/lib/device-import-normalization'
import {
  importPredictionRuleMatches,
  type DeviceImportFirmwareSource,
  type DeviceImportPredictionRule,
} from '@/lib/device-import-profile-predictions'

type ApiError = { error?: { message?: string } }
type FirmwareResolutionSource = 'CATALOG' | 'RULE' | 'BUILT_IN' | 'PREDICTION'
type FirmwareProposal = {
  key: string
  vendorId: string
  vendorName: string
  vendorCode: string
  referenceIds: string[]
  versions: string[]
  variants?: string[]
  version: string
  platform: string
  modelIds: string[]
  modelNames: string[]
  status: string
  firmwareTrainName: string
  matchedPredictionRuleIds: string[]
  interpretationReasons?: string[]
  firmwareSource?: DeviceImportFirmwareSource | 'MIXED'
  resolutionSource?: FirmwareResolutionSource
  confidence?: number
  existingTarget: { id: string; version: string; platform: string; status: string } | null
}
type Assist = { proposals: FirmwareProposal[]; rawReferenceCount: number; proposalCount: number }
type AssistPayload = { data?: Assist } & ApiError
type CreatePayload = { data?: { created: number; linkedExisting: number; assist: Assist | null } } & ApiError
type DraftFirmware = FirmwareProposal & { include: boolean }
type BatchAssistPayload = {
  data?: { workspace?: { batch?: { profileId?: string | null; profileName?: string | null } } }
} & ApiError

type ProfileRule = DeviceImportPredictionRule & { id: string; priority: number; isActive: boolean }
type ProfileAlias = { id: string; kind: string; sourceValue: string; contextKey: string; targetId: string }
type RuleWorkspace = {
  profile: { id: string; name: string; isActive: boolean }
  rules: ProfileRule[]
  aliases: ProfileAlias[]
}
type RuleWorkspacePayload = { data?: RuleWorkspace } & ApiError

type RawRow = { rowNumber: number; status: string; rawData: unknown; mappedData: unknown }
type RawReference = { sourceValue: string; kind: string; occurrenceCount: number; sampled: boolean; rows: RawRow[] }
type RawPayload = { data?: RawReference } & ApiError

type QueueTab = 'ATTENTION' | 'PREDICTIONS' | 'DETERMINISTIC'

const STATUSES = ['AVAILABLE', 'TESTING', 'APPROVED', 'RECOMMENDED', 'DEPRECATED', 'BLOCKED'] as const
const RAW_REFERENCE_LIMIT = 20
const COMMON_PLATFORMS = [
  'FortiOS',
  'FortiSwitch OS/firmware',
  'FortiAP OS/firmware',
  'IOS XE',
  'IOS',
  'Sx350',
  'AOS-S',
  'AOS-CX',
  'AOS 8',
  'AOS 10',
]

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mappedValue(row: RawRow | undefined, field: string) {
  return textValue(record(row?.mappedData)[field])
}

function rawValue(row: RawRow | undefined, field: string) {
  return textValue(record(row?.rawData)[field])
}

function deviceIdentity(row: RawRow) {
  const mapped = record(row.mappedData)
  for (const key of ['name', 'hostname', 'externalId', 'serialNumber', 'managementAddress']) {
    const value = textValue(mapped[key])
    if (value) return value
  }
  return `Source row ${row.rowNumber}`
}

function sourceLabel(source: FirmwareResolutionSource | undefined) {
  if (source === 'CATALOG') return 'CATALOG'
  if (source === 'RULE') return 'PROFILE RULE'
  if (source === 'BUILT_IN') return 'SYSTEM RULE'
  return 'PREDICTION'
}

function sourceClass(source: FirmwareResolutionSource | undefined) {
  if (source === 'CATALOG') return 'border-[#285f48] bg-[#142b22] text-[#a9e8c6]'
  if (source === 'RULE') return 'border-[#40612d] bg-[#172413] text-[#b8e6a3]'
  if (source === 'BUILT_IN') return 'border-[#4b5f80] bg-[#151d2a] text-[#b9d1ff]'
  return 'border-[#315d82] bg-[#122131] text-[#98ccff]'
}

function firmwareSourceLabel(source: FirmwareProposal['firmwareSource']) {
  if (source === 'SOFTWARE_VERSION') return 'Software Version'
  if (source === 'FIRMWARE_VERSION') return 'Firmware Version'
  if (source === 'EFFECTIVE') return 'Effective firmware value'
  if (source === 'MIXED') return 'Mixed source rules'
  return 'Automatic / effective value'
}

function proposalNeedsAttention(proposal: FirmwareProposal) {
  return !proposal.platform || (!proposal.existingTarget && (proposal.confidence ?? 0.7) < 0.95)
}

function proposalIsPrediction(proposal: FirmwareProposal) {
  return (proposal.resolutionSource ?? 'PREDICTION') === 'PREDICTION'
}

function proposalReady(proposal: FirmwareProposal) {
  return Boolean(proposal.platform.trim() && proposal.version.trim())
}

function ruleResultSummary(rule: ProfileRule) {
  const result = record(rule.result)
  const parts: string[] = []
  if (textValue(result.preferredSoftwarePlatform)) parts.push(`Platform ${result.preferredSoftwarePlatform}`)
  if (textValue(result.firmwareSource)) parts.push(`Source ${String(result.firmwareSource).replaceAll('_', ' ')}`)
  const platforms = Array.isArray(result.softwarePlatforms)
    ? result.softwarePlatforms.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : []
  if (!textValue(result.preferredSoftwarePlatform) && platforms.length) parts.push(`Platforms ${platforms.join(', ')}`)
  return parts.join(' · ') || 'Classification / transform rule'
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = await response.json() as T & ApiError
  if (!response.ok) throw new Error(payload.error?.message ?? fallback)
  return payload
}

export function DeviceImportFirmwareReconciliationWorkspace({ batchId }: { batchId: string }) {
  const [drafts, setDrafts] = useState<DraftFirmware[]>([])
  const [summary, setSummary] = useState({ rawReferenceCount: 0, proposalCount: 0 })
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [ruleWorkspace, setRuleWorkspace] = useState<RuleWorkspace | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [rawReferences, setRawReferences] = useState<RawReference[]>([])
  const [rawBusy, setRawBusy] = useState(false)
  const [queueTab, setQueueTab] = useState<QueueTab>('ATTENTION')
  const [query, setQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [ruleModel, setRuleModel] = useState('')
  const [ruleBusy, setRuleBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function install(data: Assist, preserveSelection = true) {
    const next = data.proposals.map((proposal) => ({
      ...proposal,
      include: Boolean(proposal.existingTarget || (proposal.platform && (proposal.confidence ?? 0.7) >= 0.95)),
    }))
    setDrafts(next)
    setSummary({ rawReferenceCount: data.rawReferenceCount, proposalCount: data.proposalCount })
    setSelectedKey((current) => preserveSelection && current && next.some((draft) => draft.key === current)
      ? current
      : next.find(proposalNeedsAttention)?.key ?? next[0]?.key ?? null)
  }

  async function loadRules(nextProfileId: string | null) {
    if (!nextProfileId) {
      setRuleWorkspace(null)
      return
    }
    const response = await fetch(`/api/v1/device-import/profiles/${nextProfileId}/rules`)
    const payload = await readJson<RuleWorkspacePayload>(response, 'Profile rules could not be loaded.')
    if (!payload.data) throw new Error('Profile rules could not be loaded.')
    setRuleWorkspace(payload.data)
  }

  async function reloadFirmware(preserveSelection = true) {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`)
    const payload = await readJson<AssistPayload>(response, 'The Firmware proposals could not be loaded.')
    if (!payload.data) throw new Error('The Firmware proposals could not be loaded.')
    install(payload.data, preserveSelection)
    return payload.data
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`).then((response) => readJson<AssistPayload>(response, 'The Firmware proposals could not be loaded.')),
      fetch(`/api/v1/device-import/batches/${batchId}/assist`).then((response) => readJson<BatchAssistPayload>(response, 'The import profile context could not be loaded.')),
    ]).then(async ([firmwarePayload, batchPayload]) => {
      if (cancelled || !firmwarePayload.data) return
      install(firmwarePayload.data, false)
      const batch = batchPayload.data?.workspace?.batch ?? null
      const nextProfileId = batch?.profileId ?? null
      setProfileId(nextProfileId)
      setProfileName(batch?.profileName ?? null)
      if (nextProfileId) await loadRules(nextProfileId)
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'The Firmware reconciliation workspace could not be loaded.')
    })
    return () => { cancelled = true }
  }, [batchId])

  const selected = useMemo(() => drafts.filter((draft) => draft.include), [drafts])
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.key === selectedKey) ?? null, [drafts, selectedKey])
  const attentionCount = useMemo(() => drafts.filter(proposalNeedsAttention).length, [drafts])
  const predictionCount = useMemo(() => drafts.filter(proposalIsPrediction).length, [drafts])
  const deterministicCount = drafts.length - predictionCount
  const rulePlatformOptions = useMemo(() => ruleWorkspace?.rules.flatMap((rule) => {
    const result = record(rule.result)
    const preferred = textValue(result.preferredSoftwarePlatform)
    const supported = Array.isArray(result.softwarePlatforms)
      ? result.softwarePlatforms.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      : []
    return [...(preferred ? [preferred] : []), ...supported]
  }) ?? [], [ruleWorkspace])
  const platformOptions = useMemo(() => [...new Set([
    ...COMMON_PLATFORMS,
    ...rulePlatformOptions,
    ...drafts.map((draft) => draft.platform).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b)), [drafts, rulePlatformOptions])
  const vendorOptions = useMemo(() => [...new Set(drafts.map((draft) => draft.vendorName).filter(Boolean))].sort(), [drafts])

  const visibleDrafts = useMemo(() => {
    const terms = normalized(query).split(/\s+/).filter(Boolean)
    return drafts.filter((draft) => {
      if (queueTab === 'ATTENTION' && !proposalNeedsAttention(draft)) return false
      if (queueTab === 'PREDICTIONS' && !proposalIsPrediction(draft)) return false
      if (queueTab === 'DETERMINISTIC' && proposalIsPrediction(draft)) return false
      if (platformFilter && draft.platform !== platformFilter) return false
      if (vendorFilter && draft.vendorName !== vendorFilter) return false
      if (sourceFilter && sourceLabel(draft.resolutionSource) !== sourceFilter) return false
      if (!terms.length) return true
      const haystack = [draft.vendorName, draft.platform, draft.version, draft.firmwareTrainName, ...draft.versions, ...draft.modelNames].map(normalized).join(' ')
      return terms.every((term) => haystack.includes(term))
    })
  }, [drafts, platformFilter, query, queueTab, sourceFilter, vendorFilter])

  useEffect(() => {
    if (!selectedDraft) {
      setRawReferences([])
      setRuleModel('')
      return
    }
    setRuleModel(selectedDraft.modelNames[0] ?? '')
    let cancelled = false
    setRawBusy(true)
    const ids = selectedDraft.referenceIds.slice(0, RAW_REFERENCE_LIMIT)
    void Promise.all(ids.map(async (referenceId) => {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/${referenceId}/raw?limit=50`)
      const payload = await readJson<RawPayload>(response, 'Device source rows could not be loaded.')
      if (!payload.data) throw new Error('Device source rows could not be loaded.')
      return payload.data
    })).then(
      (rows) => { if (!cancelled) setRawReferences(rows) },
      (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Device source rows could not be loaded.') },
    ).finally(() => { if (!cancelled) setRawBusy(false) })
    return () => { cancelled = true }
  }, [batchId, selectedDraft?.key])

  const deviceRows = useMemo(() => {
    const byRow = new Map<number, RawRow>()
    for (const reference of rawReferences) for (const row of reference.rows) byRow.set(row.rowNumber, row)
    return [...byRow.values()].sort((left, right) => left.rowNumber - right.rowNumber)
  }, [rawReferences])
  const rawSampled = rawReferences.some((reference) => reference.sampled) || Boolean(selectedDraft && selectedDraft.referenceIds.length > RAW_REFERENCE_LIMIT)

  const sourceCandidates = useMemo(() => {
    function unique(field: 'EFFECTIVE' | 'FIRMWARE_VERSION' | 'SOFTWARE_VERSION') {
      const values = deviceRows.flatMap((row) => {
        const value = field === 'FIRMWARE_VERSION'
          ? mappedValue(row, 'firmwareVersion') ?? rawValue(row, 'Firmware Version')
          : field === 'SOFTWARE_VERSION'
            ? mappedValue(row, 'softwareVersion') ?? rawValue(row, 'Software Version')
            : mappedValue(row, 'currentFirmware')
        return value ? [value] : []
      })
      return [...new Map(values.map((value) => [normalized(value), value])).values()]
    }
    return {
      EFFECTIVE: unique('EFFECTIVE'),
      FIRMWARE_VERSION: unique('FIRMWARE_VERSION'),
      SOFTWARE_VERSION: unique('SOFTWARE_VERSION'),
    }
  }, [deviceRows])

  const matchedRules = useMemo(() => {
    if (!selectedDraft || !ruleWorkspace) return []
    const ids = new Set(selectedDraft.matchedPredictionRuleIds)
    return ruleWorkspace.rules.filter((rule) => ids.has(rule.id))
  }, [ruleWorkspace, selectedDraft])

  const evaluatedNonMatches = useMemo(() => {
    if (!ruleWorkspace || !selectedDraft) return []
    const first = deviceRows[0]
    const values = {
      vendor: mappedValue(first, 'vendor') ?? selectedDraft.vendorName,
      model: mappedValue(first, 'model') ?? selectedDraft.modelNames[0] ?? null,
      deviceType: mappedValue(first, 'deviceType'),
      platform: mappedValue(first, 'platform') ?? selectedDraft.platform,
      firmware: mappedValue(first, 'currentFirmware') ?? selectedDraft.versions[0] ?? null,
      firmwareVersion: mappedValue(first, 'firmwareVersion'),
      softwareVersion: mappedValue(first, 'softwareVersion'),
    }
    const matched = new Set(selectedDraft.matchedPredictionRuleIds)
    return ruleWorkspace.rules.filter((rule) => rule.action === 'PREDICT' && rule.isActive && !matched.has(rule.id) && !importPredictionRuleMatches(rule, values)).slice(0, 4)
  }, [deviceRows, ruleWorkspace, selectedDraft])

  function patch(key: string, values: Partial<DraftFirmware>) {
    setDrafts((current) => current.map((draft) => {
      if (draft.key !== key) return draft
      const next = { ...draft, ...values }
      if (values.version !== undefined || values.platform !== undefined) {
        next.firmwareTrainName = next.platform && next.version ? inferFirmwareTrainName(next.platform, next.version) : ''
      }
      return next
    }))
  }

  function chooseFirmwareSource(source: DeviceImportFirmwareSource) {
    if (!selectedDraft) return
    const candidates = sourceCandidates[source]
    if (candidates.length === 1) {
      patch(selectedDraft.key, { firmwareSource: source, version: candidates[0] })
      setNotice(`Using ${firmwareSourceLabel(source)} for this proposal. Review the canonical version, then approve or create it.`)
      return
    }
    patch(selectedDraft.key, { firmwareSource: source })
    if (candidates.length > 1) {
      setNotice(`${firmwareSourceLabel(source)} contains ${candidates.length} different values in the sampled devices. Create a rule and recalculate instead of forcing one version across the group.`)
    } else {
      setNotice(`${firmwareSourceLabel(source)} was not present in the sampled device rows. The current canonical version was left unchanged.`)
    }
  }

  function approveDraft(draft: DraftFirmware) {
    setSelectedKey(draft.key)
    if (!proposalReady(draft)) {
      patch(draft.key, { include: false })
      setError('Choose the Software Platform and canonical Version before approving this firmware mapping.')
      return
    }
    setError(null)
    patch(draft.key, { include: true })
  }

  function deferDraft(draft: DraftFirmware) {
    patch(draft.key, { include: false })
    setNotice(`${draft.vendorName} ${draft.platform || 'unknown platform'} ${draft.version} is deferred for this pass.`)
  }

  async function applyItems(items: DraftFirmware[]) {
    if (!items.length) return
    const invalid = items.find((draft) => !proposalReady(draft))
    if (invalid) {
      setSelectedKey(invalid.key)
      setError('At least one selected firmware mapping has no Software Platform or Version. Resolve it or defer it before applying.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    let created = 0
    let linkedExisting = 0
    try {
      for (let index = 0; index < items.length; index += 250) {
        const chunk = items.slice(index, index + 250)
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map((draft) => ({
              referenceIds: draft.referenceIds,
              version: draft.version,
              platform: draft.platform,
              status: draft.status,
            })),
          }),
        })
        const payload = await readJson<CreatePayload>(response, 'The prepared Firmware Releases could not be applied.')
        if (!payload.data) throw new Error('The prepared Firmware Releases could not be applied.')
        created += payload.data.created
        linkedExisting += payload.data.linkedExisting
        if (index + 250 >= items.length) {
          if (payload.data.assist) install(payload.data.assist, false)
          else await reloadFirmware(false)
        }
      }
      setNotice(`Applied ${items.length.toLocaleString()} firmware mapping${items.length === 1 ? '' : 's'}: created ${created.toLocaleString()} release${created === 1 ? '' : 's'} and linked ${linkedExisting.toLocaleString()} existing release${linkedExisting === 1 ? '' : 's'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The prepared Firmware Releases could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  async function createRuleFromDecision() {
    if (!selectedDraft || !profileId || !ruleModel.trim() || !selectedDraft.platform) return
    setRuleBusy(true)
    setError(null)
    setNotice(null)
    try {
      const firmwareSource = selectedDraft.firmwareSource && selectedDraft.firmwareSource !== 'MIXED'
        ? selectedDraft.firmwareSource
        : 'EFFECTIVE'
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'model',
          operator: 'EQUALS',
          value: ruleModel.trim(),
          result: {
            softwarePlatforms: [selectedDraft.platform],
            preferredSoftwarePlatform: selectedDraft.platform,
            firmwareSource,
          },
        }),
      })
      await readJson<ApiError>(response, 'The profile rule could not be created.')
      await loadRules(profileId)
      await reloadFirmware(false)
      setNotice(`Created an exact ${ruleModel.trim()} rule and recalculated the unresolved firmware queue.`)
    } catch (ruleError) {
      setError(ruleError instanceof Error ? ruleError.message : 'The profile rule could not be created.')
    } finally {
      setRuleBusy(false)
    }
  }

  const sourceCounts = useMemo(() => ({
    catalog: drafts.filter((draft) => draft.resolutionSource === 'CATALOG').length,
    rules: drafts.filter((draft) => draft.resolutionSource === 'RULE').length,
    builtIn: drafts.filter((draft) => draft.resolutionSource === 'BUILT_IN').length,
    predictions: drafts.filter(proposalIsPrediction).length,
  }), [drafts])

  const selectedSource = selectedDraft?.firmwareSource && selectedDraft.firmwareSource !== 'MIXED'
    ? selectedDraft.firmwareSource
    : 'EFFECTIVE'

  return <>
    <datalist id={`firmware-platforms-${batchId}`}>{platformOptions.map((platform) => <option key={platform} value={platform} />)}</datalist>

    <PageHeader
      eyebrow="Staged inventory · Resolve entities"
      title="Firmware reconciliation"
      description="Resolve firmware in device/model context. A prediction is not an action: choose the platform and source where needed, approve it, then create or link the canonical release."
      actions={<div className="flex flex-wrap gap-2"><Link href={`/devices/import/${batchId}`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Back to import</Link><Link href={profileId ? `/rule-engine?profile=${encodeURIComponent(profileId)}` : '/rule-engine'} className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent-light)] hover:bg-[var(--surface-muted)]">Rule engine</Link></div>}
    />

    {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--muted)]">Raw firmware references</div><div className="mt-1 text-2xl font-semibold">{summary.rawReferenceCount.toLocaleString()}</div></div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--muted)]">Canonical proposals</div><div className="mt-1 text-2xl font-semibold">{summary.proposalCount.toLocaleString()}</div></div>
      <button type="button" onClick={() => setQueueTab('ATTENTION')} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent-muted)]"><div className="text-xs text-[var(--muted)]">Need attention</div><div className="mt-1 text-2xl font-semibold text-amber-200">{attentionCount.toLocaleString()}</div></button>
      <button type="button" onClick={() => setQueueTab('DETERMINISTIC')} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent-muted)]"><div className="text-xs text-[var(--muted)]">Rule / catalog proposals</div><div className="mt-1 text-2xl font-semibold">{deterministicCount.toLocaleString()}</div></button>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--muted)]">Approved for apply</div><div className="mt-1 text-2xl font-semibold text-[var(--accent-light)]">{selected.length.toLocaleString()}</div></div>
    </section>

    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Resolution engine</div>
          <div className="mt-1 text-sm font-semibold">{profileName ?? 'No import profile'}{profileName ? ' · profile-scoped memory and rules' : ''}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{ruleWorkspace?.rules.length.toLocaleString() ?? '0'} profile rules · {ruleWorkspace?.aliases.length.toLocaleString() ?? '0'} learned mappings · {sourceCounts.builtIn.toLocaleString()} system-rule proposals · {sourceCounts.predictions.toLocaleString()} heuristic predictions. Predictions require an engineer decision before they are applied.</div>
        </div>
        <Link href={profileId ? `/rule-engine?profile=${encodeURIComponent(profileId)}` : '/rule-engine'} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]">Open rule engine →</Link>
      </div>
    </section>

    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_410px]">
      <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 pt-3">
          <div className="flex flex-wrap gap-1">
            {([
              ['ATTENTION', `Need attention ${attentionCount}`],
              ['PREDICTIONS', `Predictions ${predictionCount}`],
              ['DETERMINISTIC', `Rules / catalog ${deterministicCount}`],
            ] as Array<[QueueTab, string]>).map(([tab, label]) => <button key={tab} type="button" onClick={() => setQueueTab(tab)} className={`border-b-2 px-3 py-2 text-sm font-semibold ${queueTab === tab ? 'border-[var(--accent)] text-[var(--accent-light)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{label}</button>)}
          </div>
        </div>
        <div className="grid gap-2 border-b border-[var(--border)] p-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px_170px]">
          <TextInput value={query} disabled={busy} placeholder="Search firmware, platform, model…" onChange={(event) => setQuery(event.target.value)} />
          <SelectInput value={platformFilter} disabled={busy} onChange={(event) => setPlatformFilter(event.target.value)}><option value="">Platform: All</option>{platformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</SelectInput>
          <SelectInput value={vendorFilter} disabled={busy} onChange={(event) => setVendorFilter(event.target.value)}><option value="">Vendor: All</option>{vendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</SelectInput>
          <SelectInput value={sourceFilter} disabled={busy} onChange={(event) => setSourceFilter(event.target.value)}><option value="">Source: All</option><option>CATALOG</option><option>PROFILE RULE</option><option>SYSTEM RULE</option><option>PREDICTION</option></SelectInput>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs text-[var(--muted)]"><tr><th className="w-10 px-3 py-3">Use</th><th className="px-3 py-3">Imported firmware</th><th className="px-3 py-3">Platform</th><th className="px-3 py-3">Devices / models</th><th className="px-3 py-3">Mapping</th><th className="px-3 py-3">Confidence</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Action</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {visibleDrafts.map((draft) => {
                const isSelected = draft.key === selectedKey
                const confidence = Math.round((draft.confidence ?? 0.7) * 100)
                const ready = proposalReady(draft)
                return <tr key={draft.key} onClick={() => setSelectedKey(draft.key)} className={`cursor-pointer align-top hover:bg-[var(--surface-raised)] ${isSelected ? 'bg-[var(--surface-raised)]' : ''}`}>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={draft.include} disabled={busy || !ready} className="h-4 w-4 accent-[var(--accent)]" onChange={(event) => event.target.checked ? approveDraft(draft) : deferDraft(draft)} aria-label={`Approve ${draft.platform || 'unknown platform'} ${draft.version}`} /></td>
                  <td className="px-3 py-3"><div className="font-mono text-xs font-semibold">{draft.versions.join(' · ')}</div>{draft.versions.some((version) => normalized(version) !== normalized(draft.version)) ? <div className="mt-1 text-[11px] text-[var(--muted)]">Canonical: {draft.version}</div> : null}</td>
                  <td className="px-3 py-3"><div className={`font-semibold ${draft.platform ? '' : 'text-amber-200'}`}>{draft.platform || 'Needs platform'}</div><div className="mt-1 text-[11px] text-[var(--muted)]">Train {draft.firmwareTrainName || '—'}</div></td>
                  <td className="px-3 py-3"><div>{draft.referenceIds.length.toLocaleString()} firmware value group{draft.referenceIds.length === 1 ? '' : 's'}</div><div className="mt-1 text-xs text-[var(--muted)]">{draft.modelNames.slice(0, 3).join(', ') || 'Model unknown'}{draft.modelNames.length > 3 ? ` +${draft.modelNames.length - 3}` : ''}</div></td>
                  <td className="px-3 py-3"><div className={draft.existingTarget ? 'text-[#a9e8c6]' : ready ? 'text-[var(--foreground)]' : 'text-amber-200'}>{draft.existingTarget ? `Link ${draft.platform} ${draft.version}` : ready ? `Create ${draft.platform} ${draft.version}` : 'Resolve platform first'}</div><div className="mt-1 text-[11px] text-[var(--muted)]">From {firmwareSourceLabel(draft.firmwareSource)}</div></td>
                  <td className="px-3 py-3"><div className={confidence >= 95 ? 'text-[#a9e8c6]' : confidence >= 80 ? 'text-amber-200' : 'text-[var(--muted-strong)]'}>{confidence}%</div><div className="mt-1 text-[11px] text-[var(--muted)]">{confidence >= 95 ? 'High' : confidence >= 80 ? 'Medium' : 'Review'}</div></td>
                  <td className="px-3 py-3"><span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${sourceClass(draft.resolutionSource)}`}>{sourceLabel(draft.resolutionSource)}</span></td>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><div className="flex gap-1"><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelectedKey(draft.key)}>{ready ? 'Review' : 'Resolve'}</Button>{ready && !draft.include ? <Button type="button" variant="secondary" disabled={busy} onClick={() => approveDraft(draft)}>Approve</Button> : null}</div></td>
                </tr>
              })}
            </tbody>
          </table>
          {!visibleDrafts.length ? <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">No firmware proposals match this view.</div> : null}
        </div>
      </section>

      <aside className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] 2xl:sticky 2xl:top-5 2xl:max-h-[calc(100vh-2.5rem)] 2xl:overflow-y-auto">
        {selectedDraft ? <>
          <div className="border-b border-[var(--border)] p-4"><div className="text-xs uppercase tracking-[0.12em] text-[var(--muted)]">Imported firmware</div><div className="mt-1 font-mono text-lg font-semibold">{selectedDraft.versions.join(' · ')}</div><div className="mt-1 text-xs text-[var(--muted)]">{selectedDraft.modelNames.length.toLocaleString()} model{selectedDraft.modelNames.length === 1 ? '' : 's'} · {deviceRows.length.toLocaleString()} device row{deviceRows.length === 1 ? '' : 's'} loaded{rawSampled ? ' (sample)' : ''}</div></div>
          <div className="space-y-3 p-4">
            <section className="rounded-md border border-[#315d82] bg-[#122131] p-3">
              <div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold text-[#98ccff]">Engineer decision</div><span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${selectedDraft.include ? 'border-[#285f48] text-[#a9e8c6]' : 'border-[#6c5b2b] text-amber-200'}`}>{selectedDraft.include ? 'APPROVED' : 'NOT APPROVED'}</span></div>
              <div className="mt-2 text-sm font-semibold">{selectedDraft.existingTarget ? 'Link existing firmware release' : 'Create new firmware release'}</div>
              <div className="mt-1 text-sm">{selectedDraft.vendorName} · {selectedDraft.platform || 'choose platform'} · {selectedDraft.version}</div>
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-semibold">Software Platform<TextInput list={`firmware-platforms-${batchId}`} value={selectedDraft.platform} disabled={busy || Boolean(selectedDraft.existingTarget)} className="mt-1" placeholder="Required: e.g. FortiAP OS/firmware" onChange={(event) => patch(selectedDraft.key, { platform: event.target.value, include: false })} /></label>
                <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-semibold">Canonical Version<TextInput value={selectedDraft.version} disabled={busy || Boolean(selectedDraft.existingTarget)} className="mt-1" onChange={(event) => patch(selectedDraft.key, { version: event.target.value, include: false })} /></label><label className="block text-xs font-semibold">Catalog Status<SelectInput value={selectedDraft.status} disabled={busy || Boolean(selectedDraft.existingTarget)} className="mt-1" onChange={(event) => patch(selectedDraft.key, { status: event.target.value, include: false })}>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</SelectInput></label></div>
                <label className="block text-xs font-semibold">Firmware source<SelectInput value={selectedSource} disabled={busy || Boolean(selectedDraft.existingTarget)} className="mt-1" onChange={(event) => chooseFirmwareSource(event.target.value as DeviceImportFirmwareSource)}><option value="EFFECTIVE">Effective / imported value</option><option value="FIRMWARE_VERSION">Firmware Version column</option><option value="SOFTWARE_VERSION">Software Version column</option></SelectInput></label>
                <div className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-[11px] text-[var(--muted)]">Sample source values: Effective {sourceCandidates.EFFECTIVE.join(' · ') || '—'} · Firmware {sourceCandidates.FIRMWARE_VERSION.join(' · ') || '—'} · Software {sourceCandidates.SOFTWARE_VERSION.join(' · ') || '—'}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => deferDraft(selectedDraft)}>Defer</Button><Button type="button" variant="secondary" disabled={busy || !proposalReady(selectedDraft)} onClick={() => approveDraft(selectedDraft)}>Approve for batch</Button><Button type="button" variant="primary" disabled={busy || !proposalReady(selectedDraft)} onClick={() => void applyItems([selectedDraft])}>{busy ? 'Applying…' : selectedDraft.existingTarget ? 'Link this release now' : 'Create this release now'}</Button></div>
            </section>

            <section className="rounded-md border border-[var(--border)] p-3"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Why this suggestion?</h3><span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${sourceClass(selectedDraft.resolutionSource)}`}>{sourceLabel(selectedDraft.resolutionSource)}</span></div><div className="mt-2 flex items-center justify-between text-xs"><span>Confidence</span><strong>{Math.round((selectedDraft.confidence ?? 0.7) * 100)}%</strong></div><div className="mt-3 space-y-1.5 text-xs">{selectedDraft.interpretationReasons?.length ? selectedDraft.interpretationReasons.map((reason) => <div key={reason} className="text-[#a9e8c6]">✓ {reason}</div>) : <div className="text-[var(--muted)]">No deterministic interpretation rule matched. This row requires an engineer decision.</div>}<div className="text-[#a9e8c6]">✓ Vendor context: {selectedDraft.vendorName}</div><div className={selectedDraft.platform ? 'text-[#a9e8c6]' : 'text-amber-200'}>{selectedDraft.platform ? '✓' : '!'} Platform context: {selectedDraft.platform || 'must be chosen'}</div><div className="text-[#a9e8c6]">✓ Canonical train: {selectedDraft.firmwareTrainName || 'unknown'}</div></div></section>

            <section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Devices in this firmware mapping</h3><div className="mt-1 text-xs text-[var(--muted)]">Use these devices and models to decide whether a numeric version belongs to an AP, switch, firewall, UPS, or another software platform.</div>{rawBusy ? <div className="mt-3 text-xs text-[var(--muted)]">Loading device rows…</div> : <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{deviceRows.map((row) => <div key={row.rowNumber} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2"><div className="text-xs font-semibold">{deviceIdentity(row)}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{mappedValue(row, 'model') ?? 'Model unknown'} · {mappedValue(row, 'deviceType') ?? 'Type unknown'}</div><div className="mt-1 text-[11px] text-[var(--muted)]">Firmware: {mappedValue(row, 'firmwareVersion') ?? rawValue(row, 'Firmware Version') ?? '—'} · Software: {mappedValue(row, 'softwareVersion') ?? rawValue(row, 'Software Version') ?? '—'}</div></div>)}{!deviceRows.length ? <div className="text-xs text-[var(--muted)]">No sampled device rows were returned.</div> : null}</div>}{rawSampled ? <div className="mt-2 text-[11px] text-amber-200">Large group: this is a bounded device sample; the model scope still covers the complete proposal.</div> : null}</section>

            <section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Rules evaluated</h3><div className="mt-3"><div className="text-xs font-semibold">Matching rules ({matchedRules.length})</div><div className="mt-2 space-y-2">{matchedRules.map((rule) => <div key={rule.id} className="rounded border border-[#285f48] bg-[#142b22] p-2 text-xs"><div className="font-semibold">✓ {rule.field} {rule.operator.toLowerCase()} “{rule.value}”</div><div className="mt-1 text-[var(--muted-strong)]">Priority {rule.priority} · {ruleResultSummary(rule)}</div></div>)}{!matchedRules.length ? <div className="text-xs text-[var(--muted)]">No profile rule matched this proposal.</div> : null}</div></div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Top non-matching rules ({evaluatedNonMatches.length})</summary><div className="mt-2 space-y-2">{evaluatedNonMatches.map((rule) => <div key={rule.id} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs"><div>✕ {rule.field} {rule.operator.toLowerCase()} “{rule.value}”</div><div className="mt-1 text-[var(--muted)]">Priority {rule.priority} · condition did not match sampled source context.</div></div>)}</div></details></section>

            <section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Create rule from this decision</h3>{profileId ? <><div className="mt-2 text-xs text-[var(--muted)]">Save the chosen platform and firmware source for this exact model, then immediately recalculate the unresolved queue so you can see the rule taking effect.</div><label className="mt-3 block text-xs font-semibold">Model scope<SelectInput value={ruleModel} disabled={ruleBusy} className="mt-1" onChange={(event) => setRuleModel(event.target.value)}>{selectedDraft.modelNames.map((model) => <option key={model} value={model}>{model}</option>)}</SelectInput></label><Button type="button" variant="primary" disabled={ruleBusy || !ruleModel || !selectedDraft.platform} onClick={() => void createRuleFromDecision()}>{ruleBusy ? 'Creating rule…' : 'Create rule & recalculate'}</Button></> : <div className="mt-2 text-xs text-[var(--muted)]">Select an import profile to create reusable profile rules.</div>}</section>
          </div>
        </> : <div className="p-6 text-sm text-[var(--muted)]">Select a firmware proposal to resolve it.</div>}
      </aside>
    </div>

    <div className="sticky bottom-2 z-20 mt-4 rounded-lg border border-[var(--accent-muted)] bg-[var(--surface-raised)]/95 px-4 py-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm"><strong>{selected.length.toLocaleString()}</strong> approved · <strong>{visibleDrafts.length.toLocaleString()}</strong> in current view · <strong>{attentionCount.toLocaleString()}</strong> still need attention</div><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={busy || !visibleDrafts.some(proposalReady)} onClick={() => setDrafts((current) => current.map((draft) => visibleDrafts.some((visible) => visible.key === draft.key) && proposalReady(draft) ? { ...draft, include: true } : draft))}>Approve visible</Button><Button type="button" variant="ghost" disabled={busy || !visibleDrafts.some((draft) => draft.include)} onClick={() => setDrafts((current) => current.map((draft) => visibleDrafts.some((visible) => visible.key === draft.key) ? { ...draft, include: false } : draft))}>Defer visible</Button><Button type="button" variant="primary" disabled={busy || !selected.length} onClick={() => void applyItems(selected)}>{busy ? 'Applying…' : `Create/link ${selected.length.toLocaleString()} approved`}</Button></div></div>
    </div>
  </>
}
