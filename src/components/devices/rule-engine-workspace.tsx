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
type RuleWorkspace = { profile: { id: string; name: string; isActive: boolean }; rules: Rule[]; aliases: Alias[] }
type RulesPayload = { data?: RuleWorkspace } & ApiError
type Tab = 'PROFILE' | 'LEARNED' | 'SYSTEM' | 'TEST'

const SYSTEM_RULES = [
  { name: 'FortiGate platform', scope: 'FortiGate / FG-* models', output: 'FortiOS · Firewall', type: 'Model classification' },
  { name: 'FortiSwitch platform', scope: 'FortiSwitch / FS-* models', output: 'FortiSwitch OS/firmware · Switch', type: 'Model classification' },
  { name: 'FortiAP platform', scope: 'FortiAP / FAP-* models', output: 'FortiAP OS/firmware · Access Point', type: 'Model classification' },
  { name: 'Cisco Catalyst IOS XE', scope: 'C9200/C9300/C9120 families', output: 'IOS XE', type: 'Model classification' },
  { name: 'Cisco 2960X IOS', scope: 'WS-C2960X family', output: 'IOS', type: 'Model classification' },
  { name: 'Cisco Sx350', scope: 'SG350/SF350/Sx350 families', output: 'Sx350 · use Software Version', type: 'Firmware interpretation' },
  { name: 'Aruba 2530', scope: '2530 family', output: 'AOS-S', type: 'Model classification' },
  { name: 'Aruba CX 6200', scope: 'CX 6200 family', output: 'AOS-CX', type: 'Model classification' },
  { name: 'AOS-S image variant', scope: 'AOS-S YA/YB/WC-style prefix', output: 'Strip image prefix from release version; retain as variant metadata', type: 'Firmware normalization' },
] as const

function record(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function valueText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function ruleSummary(rule: Rule) {
  if (rule.action !== 'PREDICT') return rule.action === 'IGNORE' ? 'Ignore matching rows' : rule.action
  const result = record(rule.result)
  const parts: string[] = []
  const platform = valueText(result.preferredSoftwarePlatform)
  const firmwareSource = valueText(result.firmwareSource)
  if (platform) parts.push(`Platform → ${platform}`)
  if (firmwareSource) parts.push(`Firmware source → ${firmwareSource.replaceAll('_', ' ')}`)
  const platforms = Array.isArray(result.softwarePlatforms) ? result.softwarePlatforms.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
  if (!platform && platforms.length) parts.push(`Platforms → ${platforms.join(', ')}`)
  const transforms = Array.isArray(result.firmwareTransforms) ? result.firmwareTransforms.length : 0
  if (transforms) parts.push(`${transforms} firmware transform${transforms === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Prediction outputs configured'
}

function aliasGroupKey(alias: Alias) {
  return `${alias.kind}|${alias.targetId}|${alias.contextKey}`
}

export function RuleEngineWorkspace() {
  const searchParams = useSearchParams()
  const requestedProfile = searchParams.get('profile')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState('')
  const [workspace, setWorkspace] = useState<RuleWorkspace | null>(null)
  const [tab, setTab] = useState<Tab>('PROFILE')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({})
  const [newRule, setNewRule] = useState({
    field: 'model',
    operator: 'EQUALS',
    value: '',
    platform: '',
    firmwareSource: '' as DeviceImportFirmwareSource | '',
  })
  const [testValues, setTestValues] = useState({
    vendor: '', model: '', deviceType: '', platform: '', firmware: '', firmwareVersion: '', softwareVersion: '',
  })

  async function loadWorkspace(nextProfileId: string) {
    if (!nextProfileId) {
      setWorkspace(null)
      return
    }
    const response = await fetch(`/api/v1/device-import/profiles/${nextProfileId}/rules`)
    const payload = await response.json() as RulesPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Rules could not be loaded.')
    setWorkspace(payload.data)
    setPriorityDrafts(Object.fromEntries(payload.data.rules.map((rule) => [rule.id, String(rule.priority)])))
  }

  useEffect(() => {
    let cancelled = false
    void fetch('/api/v1/device-import/profiles').then(async (response) => {
      const payload = await response.json() as ProfilesPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Import profiles could not be loaded.')
      return payload.data
    }).then(async (nextProfiles) => {
      if (cancelled) return
      setProfiles(nextProfiles)
      const chosen = requestedProfile && nextProfiles.some((profile) => profile.id === requestedProfile)
        ? requestedProfile
        : nextProfiles.find((profile) => profile.isActive)?.id ?? nextProfiles[0]?.id ?? ''
      setProfileId(chosen)
      if (chosen) await loadWorkspace(chosen)
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Rule engine could not be loaded.')
    })
    return () => { cancelled = true }
  }, [requestedProfile])

  async function changeProfile(nextProfileId: string) {
    setProfileId(nextProfileId)
    setError(null)
    try { await loadWorkspace(nextProfileId) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Rules could not be loaded.') }
  }

  async function patchRule(ruleId: string, body: Record<string, unknown>) {
    if (!profileId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules/${ruleId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const payload = await response.json() as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'The rule could not be updated.')
      await loadWorkspace(profileId)
      setNotice('Rule updated. Future reconciliation passes will evaluate the new rule state and priority.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The rule could not be updated.')
    } finally { setBusy(false) }
  }

  async function deleteRule(ruleId: string) {
    if (!profileId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules/${ruleId}`, { method: 'DELETE' })
      const payload = await response.json() as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'The rule could not be deleted.')
      await loadWorkspace(profileId)
      setNotice('Rule deleted.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The rule could not be deleted.')
    } finally { setBusy(false) }
  }

  async function createRule() {
    if (!profileId || !newRule.value.trim() || !newRule.platform.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          field: newRule.field,
          operator: newRule.operator,
          value: newRule.value,
          result: {
            softwarePlatforms: [newRule.platform],
            preferredSoftwarePlatform: newRule.platform,
            firmwareSource: newRule.firmwareSource || undefined,
          },
        }),
      })
      const payload = await response.json() as ApiError
      if (!response.ok) throw new Error(payload.error?.message ?? 'The rule could not be created.')
      setNewRule({ field: 'model', operator: 'EQUALS', value: '', platform: '', firmwareSource: '' })
      await loadWorkspace(profileId)
      setNotice('Profile rule created.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The rule could not be created.')
    } finally { setBusy(false) }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
  const visibleRules = useMemo(() => (workspace?.rules ?? []).filter((rule) => !normalizedQuery || [rule.action, rule.field, rule.operator, rule.value, ruleSummary(rule)].join(' ').toLocaleLowerCase('en-US').includes(normalizedQuery)), [normalizedQuery, workspace])
  const aliasGroups = useMemo(() => {
    const groups = new Map<string, { key: string; kind: string; targetId: string; contextKey: string; aliases: Alias[] }>()
    for (const alias of workspace?.aliases ?? []) {
      if (normalizedQuery && ![alias.kind, alias.sourceValue, alias.targetId, alias.contextKey].join(' ').toLocaleLowerCase('en-US').includes(normalizedQuery)) continue
      const key = aliasGroupKey(alias)
      const current = groups.get(key)
      if (current) current.aliases.push(alias)
      else groups.set(key, { key, kind: alias.kind, targetId: alias.targetId, contextKey: alias.contextKey, aliases: [alias] })
    }
    return [...groups.values()].sort((left, right) => left.kind.localeCompare(right.kind) || right.aliases.length - left.aliases.length)
  }, [normalizedQuery, workspace])
  const predictRules = useMemo(() => (workspace?.rules ?? []).filter((rule) => rule.action === 'PREDICT' && rule.isActive), [workspace])
  const tested = useMemo(() => {
    const result = applyDeviceImportPredictionRules(testValues, predictRules)
    const matching = predictRules.filter((rule) => importPredictionRuleMatches(rule, testValues))
    return { ...result, matching }
  }, [predictRules, testValues])

  return <>
    <PageHeader eyebrow="Import intelligence" title="Rule engine" description="Manage deterministic import-profile rules, inspect learned mappings, understand built-in system inference, and test how a source row will be interpreted before the next reconciliation pass." />

    {error ? <div className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]" role="alert">{error}</div> : null}
    {notice ? <div className="mb-4 rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]">{notice}</div> : null}

    <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,.7fr)_1fr_auto] lg:items-end">
        <label className="text-sm font-semibold">Import profile<SelectInput className="mt-1" value={profileId} disabled={busy} onChange={(event) => void changeProfile(event.target.value)}><option value="">Choose profile…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.isActive ? '' : ' (inactive)'}</option>)}</SelectInput></label>
        <label className="text-sm font-semibold">Search rules / mappings<TextInput className="mt-1" value={query} disabled={busy} placeholder="Model, platform, source value…" onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="text-right text-xs text-[var(--muted)]"><div><strong className="text-[var(--foreground)]">{workspace?.rules.length.toLocaleString() ?? 0}</strong> rules</div><div><strong className="text-[var(--foreground)]">{workspace?.aliases.length.toLocaleString() ?? 0}</strong> learned mappings</div></div>
      </div>
    </section>

    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] px-4 pt-3">{([
        ['PROFILE', `Profile rules (${workspace?.rules.length ?? 0})`],
        ['LEARNED', `Learned mappings (${workspace?.aliases.length ?? 0})`],
        ['SYSTEM', `System rules (${SYSTEM_RULES.length})`],
        ['TEST', 'Test rules'],
      ] as Array<[Tab, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === value ? 'border-[var(--accent)] text-[var(--accent-light)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{label}</button>)}</div>

      {tab === 'PROFILE' ? <div className="p-4">
        <section className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="text-sm font-semibold">Add firmware / platform rule</div><div className="mt-1 text-xs text-[var(--muted)]">Use an exact model rule for decisions such as SG350-28P → Sx350 → use Software Version. Broad prefix/contains rules are available, but exact rules are safer when model families overlap.</div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[140px_140px_minmax(180px,1fr)_180px_200px_auto]"><SelectInput value={newRule.field} disabled={busy} onChange={(event) => setNewRule((current) => ({ ...current, field: event.target.value }))}><option value="model">Model</option><option value="vendor">Vendor</option><option value="deviceType">Device Type</option><option value="platform">Platform</option><option value="firmware">Effective Firmware</option><option value="firmwareVersion">Raw Firmware Version</option><option value="softwareVersion">Raw Software Version</option></SelectInput><SelectInput value={newRule.operator} disabled={busy} onChange={(event) => setNewRule((current) => ({ ...current, operator: event.target.value }))}><option value="EQUALS">Equals</option><option value="PREFIX">Starts with</option><option value="CONTAINS">Contains</option></SelectInput><TextInput value={newRule.value} disabled={busy} placeholder="Source value" onChange={(event) => setNewRule((current) => ({ ...current, value: event.target.value }))} /><TextInput value={newRule.platform} disabled={busy} placeholder="Preferred platform" onChange={(event) => setNewRule((current) => ({ ...current, platform: event.target.value }))} /><SelectInput value={newRule.firmwareSource} disabled={busy} onChange={(event) => setNewRule((current) => ({ ...current, firmwareSource: event.target.value as DeviceImportFirmwareSource | '' }))}><option value="">Automatic firmware source</option><option value="FIRMWARE_VERSION">Firmware Version</option><option value="SOFTWARE_VERSION">Software Version</option><option value="EFFECTIVE">Effective value</option></SelectInput><Button type="button" variant="primary" disabled={busy || !profileId || !newRule.value.trim() || !newRule.platform.trim()} onClick={() => void createRule()}>Add rule</Button></div></section>
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]"><tr><th className="px-3 py-2">State</th><th className="px-3 py-2">Condition</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{visibleRules.map((rule) => <tr key={rule.id} className={rule.isActive ? '' : 'opacity-60'}><td className="px-3 py-3"><span className={`rounded border px-2 py-1 text-xs font-semibold ${rule.isActive ? 'border-[#285f48] text-[#a9e8c6]' : 'border-[var(--border)] text-[var(--muted)]'}`}>{rule.isActive ? 'ENABLED' : 'DISABLED'}</span></td><td className="px-3 py-3"><div className="font-semibold">{rule.action} · {rule.field}</div><div className="mt-1 text-xs text-[var(--muted)]">{rule.operator} “{rule.value}”</div></td><td className="px-3 py-3 text-xs">{ruleSummary(rule)}</td><td className="px-3 py-3"><div className="flex w-36 gap-2"><TextInput value={priorityDrafts[rule.id] ?? String(rule.priority)} disabled={busy} inputMode="numeric" onChange={(event) => setPriorityDrafts((current) => ({ ...current, [rule.id]: event.target.value }))} /><Button type="button" variant="ghost" disabled={busy || priorityDrafts[rule.id] === String(rule.priority)} onClick={() => void patchRule(rule.id, { priority: Number(priorityDrafts[rule.id]) })}>Save</Button></div></td><td className="px-3 py-3"><div className="flex gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => void patchRule(rule.id, { isActive: !rule.isActive })}>{rule.isActive ? 'Disable' : 'Enable'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void deleteRule(rule.id)}>Delete</Button></div></td></tr>)}</tbody></table>{!visibleRules.length ? <div className="py-8 text-center text-sm text-[var(--muted)]">No profile rules match this search.</div> : null}</div>
      </div> : null}

      {tab === 'LEARNED' ? <div className="p-4"><div className="mb-3 text-xs text-[var(--muted)]">Learned mappings are exact remembered aliases. They are intentionally narrower than wildcard rules and are applied before unresolved values reach manual reconciliation.</div><div className="space-y-2">{aliasGroups.map((group) => <details key={group.key} className="rounded-md border border-[var(--border)]"><summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{group.kind.replaceAll('_', ' ')} · {group.aliases.length.toLocaleString()} source value{group.aliases.length === 1 ? '' : 's'} → target {group.targetId.slice(0, 8)}…</summary><div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-strong)]">{group.aliases.map((alias) => <div key={alias.id} className="py-1">“{alias.sourceValue}”{alias.contextKey ? ` · context ${alias.contextKey}` : ''}</div>)}</div></details>)}{!aliasGroups.length ? <div className="py-8 text-center text-sm text-[var(--muted)]">No learned mappings match this search.</div> : null}</div></div> : null}

      {tab === 'SYSTEM' ? <div className="p-4"><div className="mb-3 rounded-md border border-[#4b5f80] bg-[#151d2a] p-3 text-xs text-[#b9d1ff]">System rules are global deterministic inference built into NOC Orchestrator and are read-only here. Custom reusable rules are currently import-profile scoped; making custom global rules is a separate data-model capability rather than silently broadening a profile rule.</div><div className="grid gap-3 lg:grid-cols-2">{SYSTEM_RULES.map((rule) => <div key={rule.name} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="flex items-center justify-between gap-2"><div className="font-semibold">{rule.name}</div><span className="rounded border border-[#4b5f80] px-1.5 py-0.5 text-[10px] text-[#b9d1ff]">SYSTEM</span></div><div className="mt-2 text-xs text-[var(--muted)]">If: {rule.scope}</div><div className="mt-1 text-xs">Then: {rule.output}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{rule.type}</div></div>)}</div></div> : null}

      {tab === 'TEST' ? <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.7fr)]"><section className="rounded-md border border-[var(--border)] p-3"><h2 className="text-sm font-semibold">Test source context</h2><div className="mt-3 grid gap-2 md:grid-cols-2"><TextInput value={testValues.vendor} placeholder="Vendor" onChange={(event) => setTestValues((current) => ({ ...current, vendor: event.target.value }))} /><TextInput value={testValues.model} placeholder="Model" onChange={(event) => setTestValues((current) => ({ ...current, model: event.target.value }))} /><TextInput value={testValues.deviceType} placeholder="Device Type" onChange={(event) => setTestValues((current) => ({ ...current, deviceType: event.target.value }))} /><TextInput value={testValues.platform} placeholder="Software Platform" onChange={(event) => setTestValues((current) => ({ ...current, platform: event.target.value }))} /><TextInput value={testValues.firmware} placeholder="Effective Firmware" onChange={(event) => setTestValues((current) => ({ ...current, firmware: event.target.value }))} /><TextInput value={testValues.firmwareVersion} placeholder="Raw Firmware Version" onChange={(event) => setTestValues((current) => ({ ...current, firmwareVersion: event.target.value }))} /><TextInput value={testValues.softwareVersion} placeholder="Raw Software Version" onChange={(event) => setTestValues((current) => ({ ...current, softwareVersion: event.target.value }))} /></div><div className="mt-3 text-xs text-[var(--muted)]">This tester evaluates the selected profile’s active PREDICT rules in priority order. Built-in model classification runs separately in the reconciliation engine and is listed under System rules.</div></section><section className="rounded-md border border-[var(--border)] p-3"><h2 className="text-sm font-semibold">Evaluation result</h2><div className="mt-3 text-xs"><strong>{tested.matching.length}</strong> matching profile rule{tested.matching.length === 1 ? '' : 's'}</div><div className="mt-2 space-y-2">{tested.matching.map((rule) => <div key={rule.id} className="rounded border border-[#285f48] bg-[#142b22] p-2 text-xs"><div className="font-semibold">✓ Priority {rule.priority} · {rule.field} {rule.operator} “{rule.value}”</div><div className="mt-1 text-[var(--muted-strong)]">{ruleSummary(rule)}</div></div>)}</div><div className="mt-4 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs"><div>Preferred platform: <strong>{tested.prediction.preferredSoftwarePlatform ?? '—'}</strong></div><div className="mt-1">Firmware source: <strong>{tested.prediction.firmwareSource?.replaceAll('_', ' ') ?? 'Automatic'}</strong></div><div className="mt-1">Supported platforms: <strong>{tested.prediction.softwarePlatforms?.join(', ') || '—'}</strong></div><div className="mt-1">Firmware transforms: <strong>{tested.prediction.firmwareTransforms?.length ?? 0}</strong></div></div></section></div> : null}
    </section>
  </>
}
