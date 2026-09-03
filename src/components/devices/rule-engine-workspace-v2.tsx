'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import {
  applyDeviceImportPredictionRules,
  importPredictionRuleMatches,
  type DeviceImportFirmwareSource,
  type DeviceImportPredictionRule,
} from '@/lib/device-import-profile-predictions'

type ApiError = { error?: { message?: string } }
type Profile = { id: string; name: string; externalProvider: string | null; isActive: boolean }
type ProfilesPayload = { data?: Profile[] } & ApiError
type Rule = DeviceImportPredictionRule & { id: string; priority: number; isActive: boolean }
type Alias = { id: string; kind: string; sourceValue: string; contextKey: string; targetId: string }
type Workspace = { profile: { id: string; name: string; isActive: boolean }; rules: Rule[]; aliases: Alias[] }
type WorkspacePayload = { data?: Workspace } & ApiError
type Tab = 'PROFILE' | 'LEARNED' | 'SYSTEM' | 'TEST'

const SYSTEM_RULES = [
  {
    name: 'Canonical firmware identity',
    scope: 'All imports and all vendors',
    output: 'Firmware Release identity is Vendor + Software Platform + Version. The same numeric version on different platforms never collapses into one release.',
    type: 'Identity invariant',
  },
  {
    name: 'Platform context required',
    scope: 'Firmware creation and linking',
    output: 'A firmware release cannot be created or linked without source references, a resolved Software Platform, and a canonical Version.',
    type: 'Safety invariant',
  },
  {
    name: 'Explicit rules outrank heuristics',
    scope: 'Reconciliation resolution order',
    output: 'Catalog matches and active profile rules are deterministic. Model-pattern inference and similarity remain reviewable heuristics and never become an authored rule automatically.',
    type: 'Resolution invariant',
  },
  {
    name: 'Raw source evidence is preserved',
    scope: 'Firmware and software source columns',
    output: 'Canonical normalization may transform a value, but imported Firmware Version and Software Version remain available for audit/deep dive.',
    type: 'Provenance invariant',
  },
  {
    name: 'Placeholder firmware is unknown',
    scope: 'Firmware values such as 0, 0.0, 0.1 and 1',
    output: 'Placeholder values do not create canonical releases. A meaningful alternative source may be selected; otherwise current firmware remains unknown.',
    type: 'Normalization invariant',
  },
  {
    name: 'Firmware train follows canonical version',
    scope: 'Canonical firmware releases',
    output: 'Train is derived after platform and canonical version are resolved, and train identity remains scoped to the Software Platform.',
    type: 'Catalog invariant',
  },
  {
    name: 'Staged data remains quarantined',
    scope: 'All XLSX/API import reconciliation',
    output: 'Reconciliation may create/link reference data, but staged device rows do not become normal inventory until final review and publish.',
    type: 'Publication invariant',
  },
  {
    name: 'Engineer approval is distinct from confidence',
    scope: 'Predictions and heuristics',
    output: 'A high confidence score does not equal approval. Predictions must be explicitly accepted or promoted into a profile rule before bulk application.',
    type: 'Review invariant',
  },
] as const

function record(value: unknown) { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {} }
function valueText(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : '' }
function ruleSummary(rule: Rule) {
  if (rule.action !== 'PREDICT') return rule.action === 'IGNORE' ? 'Ignore matching rows' : rule.action
  const result = record(rule.result)
  const parts: string[] = []
  const platform = valueText(result.preferredSoftwarePlatform)
  const source = valueText(result.firmwareSource)
  if (platform) parts.push(`Platform → ${platform}`)
  if (source) parts.push(`Firmware source → ${source.replaceAll('_', ' ')}`)
  const platforms = Array.isArray(result.softwarePlatforms) ? result.softwarePlatforms.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
  if (!platform && platforms.length) parts.push(`Platforms → ${platforms.join(', ')}`)
  const firmwareTransforms = Array.isArray(result.firmwareTransforms) ? result.firmwareTransforms.length : 0
  if (firmwareTransforms) parts.push(`${firmwareTransforms} firmware transform${firmwareTransforms === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Prediction outputs configured'
}
function aliasGroupKey(alias: Alias) { return `${alias.kind}|${alias.targetId}|${alias.contextKey}` }
async function parse<T>(response: Response, fallback: string) {
  const payload = await response.json() as T & ApiError
  if (!response.ok) throw new Error(payload.error?.message ?? fallback)
  return payload
}

export function RuleEngineWorkspaceV2() {
  const searchParams = useSearchParams()
  const requestedProfile = searchParams.get('profile')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState('')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tab, setTab] = useState<Tab>('PROFILE')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string,string>>({})
  const [newRule, setNewRule] = useState({ field: 'model', operator: 'EQUALS', value: '', platform: '', firmwareSource: '' as DeviceImportFirmwareSource | '' })
  const [testValues, setTestValues] = useState({ vendor: '', model: '', deviceType: '', platform: '', firmware: '', firmwareVersion: '', softwareVersion: '' })

  async function loadWorkspace(id: string) {
    if (!id) { setWorkspace(null); return }
    const response = await fetch(`/api/v1/device-import/profiles/${id}/rules`)
    const payload = await parse<WorkspacePayload>(response, 'Rules could not be loaded.')
    if (!payload.data) throw new Error('Rules could not be loaded.')
    setWorkspace(payload.data)
    setPriorityDrafts(Object.fromEntries(payload.data.rules.map((rule) => [rule.id, String(rule.priority)])))
  }

  useEffect(() => {
    let cancelled = false
    void fetch('/api/v1/device-import/profiles').then((response) => parse<ProfilesPayload>(response, 'Import profiles could not be loaded.')).then(async (payload) => {
      if (cancelled || !payload.data) return
      setProfiles(payload.data)
      const chosen = requestedProfile && payload.data.some((profile) => profile.id === requestedProfile)
        ? requestedProfile
        : payload.data.find((profile) => profile.isActive)?.id ?? payload.data[0]?.id ?? ''
      setProfileId(chosen)
      if (chosen) await loadWorkspace(chosen)
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Rule engine could not be loaded.') })
    return () => { cancelled = true }
  }, [requestedProfile])

  async function changeProfile(id: string) {
    setProfileId(id); setError(null)
    try { await loadWorkspace(id) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Rules could not be loaded.') }
  }

  async function patchRule(id: string, body: Record<string,unknown>) {
    if (!profileId) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      await parse<ApiError>(response, 'Rule could not be updated.')
      await loadWorkspace(profileId)
      setNotice('Rule updated.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Rule could not be updated.') }
    finally { setBusy(false) }
  }

  async function removeRule(id: string) {
    if (!profileId) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules/${id}`, { method: 'DELETE' })
      await parse<ApiError>(response, 'Rule could not be deleted.')
      await loadWorkspace(profileId); setNotice('Rule deleted.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Rule could not be deleted.') }
    finally { setBusy(false) }
  }

  async function removeAliases(ids: string[]) {
    if (!profileId || !ids.length) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/aliases`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({aliasIds:ids}) })
      await parse<ApiError>(response, 'Learned mappings could not be forgotten.')
      await loadWorkspace(profileId); setNotice(`Forgot ${ids.length} learned mapping${ids.length === 1 ? '' : 's'}.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Learned mappings could not be forgotten.') }
    finally { setBusy(false) }
  }

  async function createRule() {
    if (!profileId || !newRule.value.trim() || !newRule.platform.trim()) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ field:newRule.field, operator:newRule.operator, value:newRule.value, result:{ softwarePlatforms:[newRule.platform], preferredSoftwarePlatform:newRule.platform, firmwareSource:newRule.firmwareSource || undefined } }) })
      await parse<ApiError>(response, 'Rule could not be created.')
      setNewRule({field:'model',operator:'EQUALS',value:'',platform:'',firmwareSource:''})
      await loadWorkspace(profileId); setNotice('Profile rule created.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Rule could not be created.') }
    finally { setBusy(false) }
  }

  const q = query.trim().toLocaleLowerCase('en-US')
  const visibleRules = useMemo(() => (workspace?.rules ?? []).filter((rule) => !q || [rule.action,rule.field,rule.operator,rule.value,ruleSummary(rule)].join(' ').toLocaleLowerCase('en-US').includes(q)), [q,workspace])
  const aliasGroups = useMemo(() => {
    const groups = new Map<string,{key:string;kind:string;targetId:string;contextKey:string;aliases:Alias[]}>()
    for (const alias of workspace?.aliases ?? []) {
      if (q && ![alias.kind,alias.sourceValue,alias.targetId,alias.contextKey].join(' ').toLocaleLowerCase('en-US').includes(q)) continue
      const key = aliasGroupKey(alias); const current = groups.get(key)
      if (current) current.aliases.push(alias); else groups.set(key,{key,kind:alias.kind,targetId:alias.targetId,contextKey:alias.contextKey,aliases:[alias]})
    }
    return [...groups.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||b.aliases.length-a.aliases.length)
  },[q,workspace])
  const predictionRules = useMemo(() => (workspace?.rules ?? []).filter((rule)=>rule.action==='PREDICT'&&rule.isActive),[workspace])
  const tested = useMemo(() => {
    const result = applyDeviceImportPredictionRules(testValues,predictionRules)
    return {...result,matching:predictionRules.filter((rule)=>importPredictionRuleMatches(rule,testValues))}
  },[predictionRules,testValues])

  return <>
    <PageHeader eyebrow="Import intelligence" title="Rule engine" description="Manage deterministic profile rules and learned mappings. Global System rules are limited to read-only engine invariants; vendor/model interpretations belong in profile rules or reviewable heuristics." />
    {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><div className="grid gap-3 lg:grid-cols-[minmax(260px,.7fr)_1fr_auto] lg:items-end"><label className="text-sm font-semibold">Import profile<SelectInput className="mt-1" value={profileId} disabled={busy} onChange={(e)=>void changeProfile(e.target.value)}><option value="">Choose profile…</option>{profiles.map((profile)=><option key={profile.id} value={profile.id}>{profile.name}{profile.isActive?'':' (inactive)'}</option>)}</SelectInput></label><label className="text-sm font-semibold">Search rules / mappings<TextInput className="mt-1" value={query} disabled={busy} placeholder="Model, platform, source value…" onChange={(e)=>setQuery(e.target.value)} /></label><div className="text-right text-xs text-[var(--muted)]"><div><strong className="text-[var(--foreground)]">{workspace?.rules.length ?? 0}</strong> rules</div><div><strong className="text-[var(--foreground)]">{workspace?.aliases.length ?? 0}</strong> learned mappings</div></div></div></section>

    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"><div className="flex flex-wrap gap-1 border-b border-[var(--border)] px-4 pt-3">{([
      ['PROFILE',`Profile rules (${workspace?.rules.length ?? 0})`],['LEARNED',`Learned mappings (${workspace?.aliases.length ?? 0})`],['SYSTEM',`System rules (${SYSTEM_RULES.length})`],['TEST','Test rules'],
    ] as Array<[Tab,string]>).map(([value,label])=><button key={value} type="button" onClick={()=>setTab(value)} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab===value?'border-[var(--accent)] text-[var(--accent-light)]':'border-transparent text-[var(--muted)]'}`}>{label}</button>)}</div>

    {tab==='PROFILE'?<div className="p-4"><section className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="text-sm font-semibold">Add firmware / platform rule</div><div className="mt-1 text-xs text-[var(--muted)]">Use profile rules for vendor/model knowledge learned or confirmed in your source environment. These are editable, testable and prioritized; they are not baked into global system behavior.</div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[140px_140px_minmax(180px,1fr)_180px_200px_auto]"><SelectInput value={newRule.field} disabled={busy} onChange={(e)=>setNewRule((c)=>({...c,field:e.target.value}))}><option value="model">Model</option><option value="vendor">Vendor</option><option value="deviceType">Device Type</option><option value="platform">Platform</option><option value="firmware">Effective Firmware</option><option value="firmwareVersion">Raw Firmware Version</option><option value="softwareVersion">Raw Software Version</option></SelectInput><SelectInput value={newRule.operator} disabled={busy} onChange={(e)=>setNewRule((c)=>({...c,operator:e.target.value}))}><option value="EQUALS">Equals</option><option value="PREFIX">Starts with</option><option value="CONTAINS">Contains</option></SelectInput><TextInput value={newRule.value} disabled={busy} placeholder="Source value" onChange={(e)=>setNewRule((c)=>({...c,value:e.target.value}))}/><TextInput value={newRule.platform} disabled={busy} placeholder="Preferred platform" onChange={(e)=>setNewRule((c)=>({...c,platform:e.target.value}))}/><SelectInput value={newRule.firmwareSource} disabled={busy} onChange={(e)=>setNewRule((c)=>({...c,firmwareSource:e.target.value as DeviceImportFirmwareSource|''}))}><option value="">Automatic source</option><option value="EFFECTIVE">Effective firmware</option><option value="FIRMWARE_VERSION">Firmware Version</option><option value="SOFTWARE_VERSION">Software Version</option></SelectInput><Button variant="primary" disabled={busy||!newRule.value.trim()||!newRule.platform.trim()} onClick={()=>void createRule()}>Add rule</Button></div></section>
      <div className="space-y-2">{visibleRules.map((rule)=><div key={rule.id} className={`rounded-md border p-3 ${rule.isActive?'border-[var(--border)]':'border-[var(--border)] opacity-60'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded border border-[var(--border)] px-1.5 py-.5 text-[10px] font-semibold">{rule.action}</span><strong className="text-sm">{rule.field} {rule.operator.toLowerCase()} “{rule.value}”</strong></div><div className="mt-1 text-xs text-[var(--muted)]">{ruleSummary(rule)}</div></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-[var(--muted)]">Priority <TextInput className="ml-1 inline-block h-8 w-24" value={priorityDrafts[rule.id] ?? String(rule.priority)} disabled={busy} onChange={(e)=>setPriorityDrafts((c)=>({...c,[rule.id]:e.target.value}))}/></label><Button variant="ghost" disabled={busy||Number(priorityDrafts[rule.id])===rule.priority} onClick={()=>void patchRule(rule.id,{priority:Number(priorityDrafts[rule.id])})}>Save priority</Button><Button variant="ghost" disabled={busy} onClick={()=>void patchRule(rule.id,{isActive:!rule.isActive})}>{rule.isActive?'Disable':'Enable'}</Button><Button variant="danger" disabled={busy} onClick={()=>void removeRule(rule.id)}>Delete</Button></div></div></div>)}{!visibleRules.length?<div className="py-8 text-center text-sm text-[var(--muted)]">No profile rules match this filter.</div>:null}</div></div>:null}

    {tab==='LEARNED'?<div className="p-4"><div className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--muted)]">Learned mappings are exact, profile-scoped aliases from source vocabulary to a canonical target. Grouping is presentation only; exact matching remains deterministic and safe.</div><div className="space-y-2">{aliasGroups.map((group)=><details key={group.key} className="rounded-md border border-[var(--border)]"><summary className="cursor-pointer px-3 py-3 text-sm font-semibold"><span className="mr-2 rounded border border-[var(--border)] px-1.5 py-.5 text-[10px]">{group.kind}</span>{group.aliases.length} source value{group.aliases.length===1?'':'s'} → target {group.targetId.slice(0,8)}…</summary><div className="border-t border-[var(--border)] p-3"><div className="mb-3 flex justify-end"><Button variant="danger" disabled={busy} onClick={()=>void removeAliases(group.aliases.map((alias)=>alias.id))}>Forget group</Button></div><div className="space-y-1">{group.aliases.map((alias)=><div key={alias.id} className="flex items-center justify-between gap-3 rounded bg-[var(--surface-raised)] px-3 py-2 text-xs"><span className="font-mono">{alias.sourceValue}</span><Button variant="ghost" disabled={busy} onClick={()=>void removeAliases([alias.id])}>Forget</Button></div>)}</div></div></details>)}{!aliasGroups.length?<div className="py-8 text-center text-sm text-[var(--muted)]">No learned mappings match this filter.</div>:null}</div></div>:null}

    {tab==='SYSTEM'?<div className="p-4"><div className="mb-4 rounded-md border border-[#315d82] bg-[#122131] p-3 text-xs text-[#b9d1ff]"><strong>Global read-only engine invariants.</strong> These rules protect identity, provenance, quarantine and review semantics for every source. Vendor/model mappings such as FortiAP → FortiAP OS or SG350 → Sx350 are intentionally <strong>not</strong> system rules; they belong in a profile rule or remain a reviewable heuristic.</div><div className="grid gap-3 lg:grid-cols-2">{SYSTEM_RULES.map((rule)=><div key={rule.name} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{rule.name}</h3><span className="rounded border border-[#4b5f80] px-1.5 py-.5 text-[10px] font-semibold text-[#b9d1ff]">GLOBAL RO</span></div><div className="mt-2 text-xs text-[var(--muted)]">Applies to: {rule.scope}</div><div className="mt-2 text-xs"><strong>Guarantee:</strong> {rule.output}</div><div className="mt-2 text-[11px] text-[var(--muted)]">{rule.type}</div></div>)}</div></div>:null}

    {tab==='TEST'?<div className="p-4"><div className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="text-sm font-semibold">Test active profile rules</div><div className="mt-1 text-xs text-[var(--muted)]">This tester evaluates authored profile rules only. Heuristic model inference is deliberately not presented as a deterministic rule result here.</div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{Object.entries(testValues).map(([field,value])=><label key={field} className="text-xs font-semibold">{field}<TextInput className="mt-1" value={value} onChange={(e)=>setTestValues((c)=>({...c,[field]:e.target.value}))}/></label>)}</div></div><div className="grid gap-4 xl:grid-cols-2"><section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Matching profile rules ({tested.matching.length})</h3><div className="mt-3 space-y-2">{tested.matching.map((rule)=><div key={rule.id} className="rounded border border-[#285f48] bg-[#142b22] p-2 text-xs"><strong>{rule.field} {rule.operator.toLowerCase()} “{rule.value}”</strong><div className="mt-1 text-[var(--muted-strong)]">Priority {rule.priority} · {ruleSummary(rule)}</div></div>)}{!tested.matching.length?<div className="text-xs text-[var(--muted)]">No active profile rule matched.</div>:null}</div></section><section className="rounded-md border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">Combined deterministic output</h3><pre className="mt-3 overflow-auto rounded bg-[var(--background)] p-3 text-xs">{JSON.stringify(tested.prediction,null,2)}</pre></section></div></div>:null}
    </section>
  </>
}
