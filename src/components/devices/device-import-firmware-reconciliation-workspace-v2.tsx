'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { inferFirmwareTrainName } from '@/lib/device-import-normalization'
import type { DeviceImportFirmwareSource, DeviceImportPredictionRule } from '@/lib/device-import-profile-predictions'

type ApiError = { error?: { message?: string } }
type BackendSource = 'CATALOG' | 'RULE' | 'BUILT_IN' | 'PREDICTION' | 'HEURISTIC'
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
  firmwareTrainName: string
  matchedPredictionRuleIds: string[]
  interpretationReasons?: string[]
  firmwareSource?: DeviceImportFirmwareSource | 'MIXED'
  resolutionSource?: BackendSource
  confidence?: number
  existingTarget: { id: string; version: string; platform: string; status: string } | null
}
type Assist = { proposals: FirmwareProposal[]; rawReferenceCount: number; proposalCount: number }
type AssistPayload = { data?: Assist } & ApiError
type CreatePayload = { data?: { created: number; linkedExisting: number; assist: Assist | null } } & ApiError
type BatchPayload = { data?: { workspace?: { batch?: { profileId?: string | null; profileName?: string | null } } } } & ApiError
type ProfileRule = DeviceImportPredictionRule & { id: string; priority: number; isActive: boolean }
type RulesPayload = { data?: { rules: ProfileRule[]; aliases: Array<{ id: string }> } } & ApiError

type RawRow = { rowNumber: number; status: string; rawData: unknown; mappedData: unknown }
type RawReference = { occurrenceCount: number; sampled: boolean; rows: RawRow[] }
type RawPayload = { data?: RawReference } & ApiError

type Draft = FirmwareProposal & { approved: boolean }
type QueueTab = 'ATTENTION' | 'PREDICTIONS' | 'DETERMINISTIC'

const STATUSES = ['AVAILABLE', 'TESTING', 'APPROVED', 'RECOMMENDED', 'DEPRECATED', 'BLOCKED'] as const
const PLATFORM_SUGGESTIONS = ['FortiOS', 'FortiSwitch OS/firmware', 'FortiAP OS/firmware', 'IOS XE', 'IOS', 'Sx350', 'AOS-S', 'AOS-CX', 'AOS 8', 'AOS 10']

function normalized(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}
function record(value: unknown) { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {} }
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null }
function mapped(row: RawRow | undefined, field: string) { return text(record(row?.mappedData)[field]) }
function raw(row: RawRow | undefined, field: string) { return text(record(row?.rawData)[field]) }

function uiSource(proposal: FirmwareProposal) {
  if (proposal.existingTarget || proposal.resolutionSource === 'CATALOG') return 'CATALOG' as const
  if (proposal.resolutionSource === 'RULE') return 'PROFILE RULE' as const
  if (proposal.resolutionSource === 'BUILT_IN' || proposal.resolutionSource === 'HEURISTIC') return 'HEURISTIC' as const
  return 'PREDICTION' as const
}
function sourceClass(source: ReturnType<typeof uiSource>) {
  if (source === 'CATALOG') return 'border-[#285f48] bg-[#142b22] text-[#a9e8c6]'
  if (source === 'PROFILE RULE') return 'border-[#40612d] bg-[#172413] text-[#b8e6a3]'
  if (source === 'HEURISTIC') return 'border-[#6c5b2b] bg-[#282111] text-amber-200'
  return 'border-[#315d82] bg-[#122131] text-[#98ccff]'
}
function firmwareSourceLabel(source: Draft['firmwareSource']) {
  if (source === 'SOFTWARE_VERSION') return 'Software Version'
  if (source === 'FIRMWARE_VERSION') return 'Firmware Version'
  if (source === 'EFFECTIVE') return 'Effective firmware value'
  if (source === 'MIXED') return 'Mixed sources'
  return 'Effective firmware value'
}
function ready(draft: Draft) {
  return Boolean(draft.referenceIds.length && draft.platform.trim() && draft.version.trim())
}
function deterministic(draft: Draft) {
  const source = uiSource(draft)
  return source === 'CATALOG' || source === 'PROFILE RULE'
}
function needsAttention(draft: Draft) {
  return !ready(draft) || !deterministic(draft)
}
function displayConfidence(draft: Draft) {
  if (uiSource(draft) === 'CATALOG' || uiSource(draft) === 'PROFILE RULE') return 100
  if (uiSource(draft) === 'HEURISTIC') return Math.min(90, Math.round((draft.confidence ?? 0.85) * 100))
  return Math.min(80, Math.round((draft.confidence ?? 0.7) * 100))
}
function deviceIdentity(row: RawRow) {
  for (const key of ['name', 'hostname', 'externalId', 'serialNumber', 'managementAddress']) {
    const value = mapped(row, key)
    if (value) return value
  }
  return `Source row ${row.rowNumber}`
}

async function json<T>(response: Response, fallback: string) {
  const payload = await response.json() as T & ApiError
  if (!response.ok) throw new Error(payload.error?.message ?? fallback)
  return payload
}

export function DeviceImportFirmwareReconciliationWorkspaceV2({ batchId }: { batchId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [summary, setSummary] = useState({ rawReferenceCount: 0, proposalCount: 0 })
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [ruleCounts, setRuleCounts] = useState({ rules: 0, aliases: 0 })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [rawReferences, setRawReferences] = useState<RawReference[]>([])
  const [rawBusy, setRawBusy] = useState(false)
  const [tab, setTab] = useState<QueueTab>('ATTENTION')
  const [query, setQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [ruleModel, setRuleModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [ruleBusy, setRuleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function install(data: Assist) {
    // Approval is deliberately never inferred from confidence. Engineer approval is a separate state.
    const next = data.proposals.map((proposal) => ({ ...proposal, approved: false }))
    setDrafts(next)
    setSummary({ rawReferenceCount: data.rawReferenceCount, proposalCount: data.proposalCount })
    setSelectedKey((current) => current && next.some((item) => item.key === current) ? current : next.find(needsAttention)?.key ?? next[0]?.key ?? null)
  }

  async function reload() {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`)
    const payload = await json<AssistPayload>(response, 'Firmware proposals could not be loaded.')
    if (!payload.data) throw new Error('Firmware proposals could not be loaded.')
    install(payload.data)
  }

  async function loadRuleCounts(id: string | null) {
    if (!id) { setRuleCounts({ rules: 0, aliases: 0 }); return }
    const response = await fetch(`/api/v1/device-import/profiles/${id}/rules`)
    const payload = await json<RulesPayload>(response, 'Profile rules could not be loaded.')
    setRuleCounts({ rules: payload.data?.rules.length ?? 0, aliases: payload.data?.aliases.length ?? 0 })
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`).then((response) => json<AssistPayload>(response, 'Firmware proposals could not be loaded.')),
      fetch(`/api/v1/device-import/batches/${batchId}/assist`).then((response) => json<BatchPayload>(response, 'Import profile context could not be loaded.')),
    ]).then(async ([firmware, batch]) => {
      if (cancelled || !firmware.data) return
      install(firmware.data)
      const id = batch.data?.workspace?.batch?.profileId ?? null
      setProfileId(id)
      setProfileName(batch.data?.workspace?.batch?.profileName ?? null)
      await loadRuleCounts(id)
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Firmware reconciliation could not be loaded.') })
    return () => { cancelled = true }
  }, [batchId])

  const selected = useMemo(() => drafts.filter((draft) => draft.approved && ready(draft)), [drafts])
  const selectedDraft = useMemo(() => drafts.find((draft) => draft.key === selectedKey) ?? null, [drafts, selectedKey])
  const attentionCount = useMemo(() => drafts.filter(needsAttention).length, [drafts])
  const predictionCount = useMemo(() => drafts.filter((draft) => !deterministic(draft)).length, [drafts])
  const deterministicCount = drafts.length - predictionCount
  const platformOptions = useMemo(() => [...new Set([...PLATFORM_SUGGESTIONS, ...drafts.map((draft) => draft.platform).filter(Boolean)])].sort(), [drafts])
  const vendorOptions = useMemo(() => [...new Set(drafts.map((draft) => draft.vendorName))].sort(), [drafts])

  const visible = useMemo(() => {
    const terms = normalized(query).split(/\s+/).filter(Boolean)
    return drafts.filter((draft) => {
      if (tab === 'ATTENTION' && !needsAttention(draft)) return false
      if (tab === 'PREDICTIONS' && deterministic(draft)) return false
      if (tab === 'DETERMINISTIC' && !deterministic(draft)) return false
      if (platformFilter && draft.platform !== platformFilter) return false
      if (vendorFilter && draft.vendorName !== vendorFilter) return false
      if (sourceFilter && uiSource(draft) !== sourceFilter) return false
      if (!terms.length) return true
      const haystack = [draft.vendorName, draft.platform, draft.version, draft.firmwareTrainName, ...draft.versions, ...draft.modelNames].map(normalized).join(' ')
      return terms.every((term) => haystack.includes(term))
    })
  }, [drafts, platformFilter, query, sourceFilter, tab, vendorFilter])

  function patch(key: string, values: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => {
      if (draft.key !== key) return draft
      const next = { ...draft, ...values }
      if (values.platform !== undefined || values.version !== undefined) {
        next.firmwareTrainName = next.platform && next.version ? inferFirmwareTrainName(next.platform, next.version) : ''
      }
      return next
    }))
  }

  useEffect(() => {
    if (!selectedDraft) { setRawReferences([]); setRuleModel(''); return }
    setRuleModel(selectedDraft.modelNames[0] ?? '')
    let cancelled = false
    setRawBusy(true)
    void Promise.all(selectedDraft.referenceIds.slice(0, 20).map(async (referenceId) => {
      const response = await fetch(`/api/v1/device-import/batches/${batchId}/references/${referenceId}/raw?limit=50`)
      const payload = await json<RawPayload>(response, 'Device rows could not be loaded.')
      return payload.data ?? { occurrenceCount: 0, sampled: false, rows: [] }
    })).then((refs) => { if (!cancelled) setRawReferences(refs) }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Device rows could not be loaded.') }).finally(() => { if (!cancelled) setRawBusy(false) })
    return () => { cancelled = true }
  }, [batchId, selectedDraft?.key])

  const deviceRows = useMemo(() => {
    const rows = new Map<number, RawRow>()
    for (const reference of rawReferences) for (const row of reference.rows) rows.set(row.rowNumber, row)
    return [...rows.values()].sort((a, b) => a.rowNumber - b.rowNumber)
  }, [rawReferences])

  const sourceCandidates = useMemo(() => {
    const collect = (source: DeviceImportFirmwareSource) => [...new Map(deviceRows.flatMap((row) => {
      const value = source === 'SOFTWARE_VERSION'
        ? mapped(row, 'softwareVersion') ?? raw(row, 'Software Version')
        : source === 'FIRMWARE_VERSION'
          ? mapped(row, 'firmwareVersion') ?? raw(row, 'Firmware Version')
          : mapped(row, 'currentFirmware')
      return value ? [[normalized(value), value] as const] : []
    })).values()]
    return { EFFECTIVE: collect('EFFECTIVE'), FIRMWARE_VERSION: collect('FIRMWARE_VERSION'), SOFTWARE_VERSION: collect('SOFTWARE_VERSION') }
  }, [deviceRows])

  function chooseSource(source: DeviceImportFirmwareSource) {
    if (!selectedDraft) return
    const candidates = sourceCandidates[source]
    patch(selectedDraft.key, { firmwareSource: source, approved: false, ...(candidates.length === 1 ? { version: candidates[0] } : {}) })
    if (candidates.length === 1) setNotice(`Canonical version changed to the sampled ${firmwareSourceLabel(source)} value. Review and approve it.`)
    else if (candidates.length > 1) setNotice(`${firmwareSourceLabel(source)} has ${candidates.length} distinct sampled values. Do not force one version across the group; narrow the rule/model scope.`)
    else setNotice(`No sampled ${firmwareSourceLabel(source)} value was available; the canonical version was left unchanged.`)
  }

  function approve(draft: Draft) {
    setSelectedKey(draft.key)
    if (!ready(draft)) {
      patch(draft.key, { approved: false })
      setError(`Cannot approve ${draft.versions[0] ?? draft.version}: source references, Software Platform and Version are all required.`)
      return
    }
    setError(null)
    patch(draft.key, { approved: true })
  }

  async function apply(items: Draft[]) {
    const valid = items.filter((draft) => draft.approved && ready(draft))
    if (!valid.length) { setError('Approve at least one complete firmware mapping first.'); return }
    if (valid.length !== items.length) { setError('One or more approved mappings became incomplete. Re-review them before applying.'); return }
    setBusy(true); setError(null); setNotice(null)
    let created = 0; let linked = 0
    try {
      for (let offset = 0; offset < valid.length; offset += 250) {
        const chunk = valid.slice(offset, offset + 250)
        const response = await fetch(`/api/v1/device-import/batches/${batchId}/firmware/assist`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk.map((draft) => ({ referenceIds: draft.referenceIds, platform: draft.platform.trim(), version: draft.version.trim(), status: draft.status })) }),
        })
        const payload = await json<CreatePayload>(response, 'Approved firmware mappings could not be applied.')
        if (!payload.data) throw new Error('Approved firmware mappings could not be applied.')
        created += payload.data.created; linked += payload.data.linkedExisting
      }
      await reload()
      setNotice(`Applied ${valid.length} approved mapping${valid.length === 1 ? '' : 's'}: ${created} release${created === 1 ? '' : 's'} created, ${linked} existing release${linked === 1 ? '' : 's'} linked.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Approved firmware mappings could not be applied.') }
    finally { setBusy(false) }
  }

  async function createRule() {
    if (!selectedDraft || !profileId || !ruleModel || !selectedDraft.platform) return
    setRuleBusy(true); setError(null)
    try {
      const source = selectedDraft.firmwareSource && selectedDraft.firmwareSource !== 'MIXED' ? selectedDraft.firmwareSource : 'EFFECTIVE'
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'model', operator: 'EQUALS', value: ruleModel, result: { softwarePlatforms: [selectedDraft.platform], preferredSoftwarePlatform: selectedDraft.platform, firmwareSource: source } }),
      })
      await json<ApiError>(response, 'Profile rule could not be created.')
      await loadRuleCounts(profileId)
      await reload()
      setNotice(`Created a profile rule for ${ruleModel}. The firmware queue was recalculated.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Profile rule could not be created.') }
    finally { setRuleBusy(false) }
  }

  const selectedSource: DeviceImportFirmwareSource = selectedDraft?.firmwareSource && selectedDraft.firmwareSource !== 'MIXED' ? selectedDraft.firmwareSource : 'EFFECTIVE'
  const heuristicCount = drafts.filter((draft) => uiSource(draft) === 'HEURISTIC').length

  return <>
    <datalist id={`firmware-platforms-${batchId}`}>{platformOptions.map((platform) => <option key={platform} value={platform} />)}</datalist>
    <PageHeader eyebrow="Staged inventory · Resolve firmware" title="Firmware reconciliation" description="Catalog matches and profile rules are deterministic. Model-pattern inference is only a heuristic: inspect the device context, explicitly approve the mapping, then create or link the canonical release." actions={<div className="flex gap-2"><Link href={`/devices/import/${batchId}`} className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold">Back to import</Link><Link href={profileId ? `/rule-engine?profile=${encodeURIComponent(profileId)}` : '/rule-engine'} className="rounded-md border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent-light)]">Rule engine</Link></div>} />

    {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--muted)]">Raw references</div><div className="mt-1 text-2xl font-semibold">{summary.rawReferenceCount}</div></div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--muted)]">Canonical proposals</div><div className="mt-1 text-2xl font-semibold">{summary.proposalCount}</div></div>
      <button type="button" onClick={() => setTab('ATTENTION')} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left"><div className="text-xs text-[var(--muted)]">Need attention</div><div className="mt-1 text-2xl font-semibold text-amber-200">{attentionCount}</div></button>
      <button type="button" onClick={() => setTab('DETERMINISTIC')} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left"><div className="text-xs text-[var(--muted)]">Catalog / profile rule</div><div className="mt-1 text-2xl font-semibold">{deterministicCount}</div></button>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--muted)]">Engineer approved</div><div className="mt-1 text-2xl font-semibold text-[var(--accent-light)]">{selected.length}</div></div>
    </section>

    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[.12em] text-[var(--accent)]">Resolution engine</div><div className="mt-1 text-sm font-semibold">{profileName ?? 'No import profile'}</div><div className="mt-1 text-xs text-[var(--muted)]">{ruleCounts.rules} profile rules · {ruleCounts.aliases} learned mappings · {heuristicCount} model heuristics. Heuristics never auto-approve a firmware mapping.</div></div><Link href={profileId ? `/rule-engine?profile=${encodeURIComponent(profileId)}` : '/rule-engine'} className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold">Open rule engine →</Link></div></section>

    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap gap-1 border-b border-[var(--border)] px-4 pt-3">{([
          ['ATTENTION', `Need attention ${attentionCount}`], ['PREDICTIONS', `Predictions / heuristics ${predictionCount}`], ['DETERMINISTIC', `Catalog / profile rules ${deterministicCount}`],
        ] as Array<[QueueTab,string]>).map(([value,label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === value ? 'border-[var(--accent)] text-[var(--accent-light)]' : 'border-transparent text-[var(--muted)]'}`}>{label}</button>)}</div>
        <div className="grid gap-2 border-b border-[var(--border)] p-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px_170px]"><TextInput value={query} placeholder="Search firmware, platform, model…" onChange={(e) => setQuery(e.target.value)} /><SelectInput value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}><option value="">Platform: All</option>{platformOptions.map((item) => <option key={item}>{item}</option>)}</SelectInput><SelectInput value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}><option value="">Vendor: All</option>{vendorOptions.map((item) => <option key={item}>{item}</option>)}</SelectInput><SelectInput value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="">Source: All</option><option>CATALOG</option><option>PROFILE RULE</option><option>HEURISTIC</option><option>PREDICTION</option></SelectInput></div>

        <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs text-[var(--muted)]"><tr><th className="w-12 px-3 py-3">Use</th><th className="px-3 py-3">Imported firmware</th><th className="px-3 py-3">Platform</th><th className="px-3 py-3">Devices / models</th><th className="px-3 py-3">Mapping</th><th className="px-3 py-3">Confidence</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Action</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{visible.map((draft) => {
          const source = uiSource(draft); const isReady = ready(draft); const confidence = displayConfidence(draft)
          return <tr key={draft.key} onClick={() => setSelectedKey(draft.key)} className={`cursor-pointer align-top hover:bg-[var(--surface-raised)] ${selectedKey === draft.key ? 'bg-[var(--surface-raised)]' : ''}`}>
            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={draft.approved} disabled={busy || !isReady} onChange={(e) => e.target.checked ? approve(draft) : patch(draft.key,{approved:false})} className="h-4 w-4 accent-[var(--accent)]" /></td>
            <td className="px-3 py-3"><div className="font-mono text-xs font-semibold">{draft.versions.join(' · ')}</div>{draft.versions.some((value) => normalized(value) !== normalized(draft.version)) ? <div className="mt-1 text-[11px] text-[var(--muted)]">Canonical: {draft.version}</div> : null}</td>
            <td className="px-3 py-3"><div className={`font-semibold ${draft.platform ? '' : 'text-amber-200'}`}>{draft.platform || 'Needs platform'}</div><div className="mt-1 text-[11px] text-[var(--muted)]">Train {draft.firmwareTrainName || '—'}</div></td>
            <td className="px-3 py-3"><div>{draft.referenceIds.length} firmware value group{draft.referenceIds.length === 1 ? '' : 's'}</div><div className="mt-1 text-xs text-[var(--muted)]">{draft.modelNames.slice(0,3).join(', ') || 'Model unknown'}{draft.modelNames.length > 3 ? ` +${draft.modelNames.length-3}` : ''}</div></td>
            <td className="px-3 py-3"><div>{draft.existingTarget ? `Link ${draft.platform} ${draft.version}` : isReady ? `Create ${draft.platform} ${draft.version}` : 'Resolve platform/version first'}</div><div className="mt-1 text-[11px] text-[var(--muted)]">From {firmwareSourceLabel(draft.firmwareSource)}</div></td>
            <td className="px-3 py-3"><div className={deterministic(draft) ? 'text-[#a9e8c6]' : 'text-amber-200'}>{confidence}%</div><div className="mt-1 text-[11px] text-[var(--muted)]">{deterministic(draft) ? 'Deterministic' : 'Engineer review'}</div></td>
            <td className="px-3 py-3"><span className={`inline-flex rounded border px-1.5 py-.5 text-[10px] font-semibold ${sourceClass(source)}`}>{source}</span></td>
            <td className="px-3 py-3"><Button type="button" variant="ghost" onClick={(e) => {e.stopPropagation();setSelectedKey(draft.key)}}>{isReady ? 'Review' : 'Resolve'}</Button></td>
          </tr>})}</tbody></table>{!visible.length ? <div className="p-8 text-center text-sm text-[var(--muted)]">No firmware mappings match this view.</div> : null}</div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3"><div className="text-sm"><strong>{selected.length}</strong> explicitly approved · {drafts.length} unresolved</div><div className="flex gap-2"><Button variant="ghost" disabled={busy || !visible.some(ready)} onClick={() => setDrafts((current) => current.map((draft) => visible.some((item) => item.key === draft.key) && ready(draft) ? {...draft,approved:true} : draft))}>Approve ready in view</Button><Button variant="ghost" disabled={busy || !selected.length} onClick={() => setDrafts((current) => current.map((draft) => ({...draft,approved:false})))}>Clear</Button><Button variant="primary" disabled={busy || !selected.length} onClick={() => void apply(selected)}>{busy ? 'Applying…' : `Create/link approved (${selected.length})`}</Button></div></div>
      </section>

      <aside className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] 2xl:sticky 2xl:top-5 2xl:max-h-[calc(100vh-2.5rem)] 2xl:overflow-y-auto">{selectedDraft ? <><div className="border-b border-[var(--border)] p-4"><div className="text-xs uppercase tracking-[.12em] text-[var(--muted)]">Imported firmware</div><div className="mt-1 font-mono text-lg font-semibold">{selectedDraft.versions.join(' · ')}</div><div className="mt-1 text-xs text-[var(--muted)]">{selectedDraft.modelNames.join(', ') || 'Model unknown'}</div></div><div className="space-y-3 p-4">
        <section className="rounded-md border border-[#315d82] bg-[#122131] p-3"><div className="flex items-center justify-between"><div className="text-xs font-semibold text-[#98ccff]">Engineer decision</div><span className={`rounded border px-1.5 py-.5 text-[10px] font-semibold ${selectedDraft.approved ? 'border-[#285f48] text-[#a9e8c6]' : 'border-[#6c5b2b] text-amber-200'}`}>{selectedDraft.approved ? 'APPROVED' : 'REVIEW'}</span></div><div className="mt-3 space-y-3"><label className="block text-xs font-semibold">Software Platform<TextInput list={`firmware-platforms-${batchId}`} className="mt-1" value={selectedDraft.platform} disabled={Boolean(selectedDraft.existingTarget)} placeholder="Required" onChange={(e) => patch(selectedDraft.key,{platform:e.target.value,approved:false})} /></label><div className="grid grid-cols-2 gap-2"><label className="block text-xs font-semibold">Canonical Version<TextInput className="mt-1" value={selectedDraft.version} disabled={Boolean(selectedDraft.existingTarget)} onChange={(e) => patch(selectedDraft.key,{version:e.target.value,approved:false})} /></label><label className="block text-xs font-semibold">Status<SelectInput className="mt-1" value={selectedDraft.status} disabled={Boolean(selectedDraft.existingTarget)} onChange={(e) => patch(selectedDraft.key,{status:e.target.value,approved:false})}>{STATUSES.map((item)=><option key={item}>{item}</option>)}</SelectInput></label></div><label className="block text-xs font-semibold">Version source<SelectInput className="mt-1" value={selectedSource} disabled={Boolean(selectedDraft.existingTarget)} onChange={(e)=>chooseSource(e.target.value as DeviceImportFirmwareSource)}><option value="EFFECTIVE">Effective firmware value</option><option value="FIRMWARE_VERSION">Firmware Version column</option><option value="SOFTWARE_VERSION">Software Version column</option></SelectInput></label><div className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-[11px] text-[var(--muted)]">Effective: {sourceCandidates.EFFECTIVE.join(' · ') || '—'}<br/>Firmware Version: {sourceCandidates.FIRMWARE_VERSION.join(' · ') || '—'}<br/>Software Version: {sourceCandidates.SOFTWARE_VERSION.join(' · ') || '—'}<br/>Train: {selectedDraft.firmwareTrainName || '—'}</div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!ready(selectedDraft)} onClick={() => approve(selectedDraft)}>{selectedDraft.approved ? 'Approved' : 'Approve for batch'}</Button><Button variant="ghost" onClick={() => patch(selectedDraft.key,{approved:false})}>Defer</Button><Button variant="primary" disabled={!selectedDraft.approved || !ready(selectedDraft) || busy} onClick={() => void apply([selectedDraft])}>{selectedDraft.existingTarget ? 'Link this release' : 'Create this release'}</Button></div></div></section>

        <section className="rounded-md border border-[var(--border)] p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Why this suggestion?</h3><span className={`rounded border px-1.5 py-.5 text-[10px] font-semibold ${sourceClass(uiSource(selectedDraft))}`}>{uiSource(selectedDraft)}</span></div><div className="mt-2 text-xs text-[var(--muted)]">{deterministic(selectedDraft) ? 'This comes from existing catalog data or an explicit profile rule.' : 'This is model-pattern/heuristic evidence only. It is not a global rule and requires engineer approval.'}</div>{selectedDraft.interpretationReasons?.map((reason)=><div key={reason} className="mt-2 text-xs text-amber-200">• {reason}</div>)}</section>

        <section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Devices in this mapping</h3>{rawBusy ? <div className="mt-2 text-xs text-[var(--muted)]">Loading…</div> : <div className="mt-3 max-h-64 space-y-2 overflow-auto">{deviceRows.map((row)=><div key={row.rowNumber} className="rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2"><div className="text-xs font-semibold">{deviceIdentity(row)}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{mapped(row,'model') ?? 'Model unknown'} · {mapped(row,'deviceType') ?? 'Type unknown'}</div><div className="mt-1 text-[11px] text-[var(--muted)]">Firmware: {mapped(row,'firmwareVersion') ?? raw(row,'Firmware Version') ?? '—'} · Software: {mapped(row,'softwareVersion') ?? raw(row,'Software Version') ?? '—'}</div></div>)}{!deviceRows.length ? <div className="text-xs text-[var(--muted)]">No sampled device rows available.</div> : null}</div>}</section>

        <section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Create deterministic profile rule</h3><div className="mt-1 text-xs text-[var(--muted)]">Promote this engineer decision into a reusable rule for this import profile. Vendor/model knowledge is not installed as an immutable global rule.</div>{profileId ? <><label className="mt-3 block text-xs font-semibold">Model scope<SelectInput className="mt-1" value={ruleModel} onChange={(e)=>setRuleModel(e.target.value)}>{selectedDraft.modelNames.map((model)=><option key={model}>{model}</option>)}</SelectInput></label><Button className="mt-2" variant="primary" disabled={ruleBusy || !ruleModel || !selectedDraft.platform} onClick={() => void createRule()}>{ruleBusy ? 'Creating…' : 'Create profile rule'}</Button></> : <div className="mt-2 text-xs text-[var(--muted)]">No import profile selected.</div>}</section>
      </div></> : <div className="p-6 text-sm text-[var(--muted)]">Select a firmware mapping to resolve it.</div>}</aside>
    </div>
  </>
}
