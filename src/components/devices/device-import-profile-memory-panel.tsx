'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectInput, TextInput } from '@/components/ui/form-controls'

type Rule = {
  id: string
  action: string
  field: string
  operator: string
  value: string
  result: unknown
  isActive: boolean
}

type Alias = {
  id: string
  kind: string
  sourceValue: string
  contextKey: string
  targetId: string
}

type Named = { id: string; name: string; code?: string | null; platform?: string | null; model?: string }
type Assist = {
  workspace: {
    batch: { profileId: string | null; profileName: string | null }
    options: {
      customers: Named[]
      sites: Named[]
      vendors: Named[]
      deviceTypes: Named[]
      models: Array<Named & { vendor: { name: string } }>
      firmwareReleases: Array<{ id: string; platform: string; version: string; vendor: { name: string } }>
    }
  }
  profileRules: {
    profile: { id: string; name: string } | null
    rules: Rule[]
    aliases: Alias[]
  }
}

type AssistPayload = { data?: Assist; error?: { message?: string } }

type FirmwareRuleDraft = {
  field: 'vendor' | 'model' | 'platform' | 'firmware' | 'firmwareVersion' | 'softwareVersion'
  operator: 'EQUALS' | 'PREFIX' | 'CONTAINS'
  value: string
  preferredSoftwarePlatform: string
  firmwareSource: '' | 'FIRMWARE_VERSION' | 'SOFTWARE_VERSION'
  firmwareTransformOperation: '' | 'EXTRACT_VERSION' | 'REMOVE_PREFIX' | 'REPLACE'
  firmwareTransformValue: string
  firmwareTransformReplacement: string
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function isFirmwarePredictionRule(rule: Rule) {
  if (rule.action !== 'PREDICT') return false
  if (['firmware', 'firmwareVersion', 'softwareVersion'].includes(rule.field)) return true
  const result = record(rule.result)
  return Boolean(result.firmwareSource) || (Array.isArray(result.firmwareTransforms) && result.firmwareTransforms.length > 0)
}

function ruleOutput(rule: Rule) {
  if (rule.action === 'IGNORE') return 'Ignore matching device rows'
  const result = record(rule.result)
  const parts: string[] = []
  if (typeof result.preferredSoftwarePlatform === 'string' && result.preferredSoftwarePlatform) parts.push(`Platform: ${result.preferredSoftwarePlatform}`)
  if (result.firmwareSource === 'FIRMWARE_VERSION') parts.push('Source: Firmware Version')
  if (result.firmwareSource === 'SOFTWARE_VERSION') parts.push('Source: Software Version')
  if (Array.isArray(result.firmwareTransforms)) {
    for (const entry of result.firmwareTransforms) {
      const transform = record(entry)
      if (transform.operation === 'EXTRACT_VERSION') parts.push('Extract version')
      if (transform.operation === 'REMOVE_PREFIX' && typeof transform.value === 'string') parts.push(`Remove prefix “${transform.value}”`)
      if (transform.operation === 'REPLACE' && typeof transform.value === 'string') parts.push(`Replace “${transform.value}”`)
    }
  }
  if (typeof result.vendorTargetId === 'string') parts.push('Vendor prediction')
  if (typeof result.deviceTypeTargetId === 'string') parts.push('Device Type prediction')
  if (typeof result.productFamilyId === 'string') parts.push('Product Family prediction')
  if (Array.isArray(result.softwarePlatforms) && result.softwarePlatforms.length) parts.push(`Platforms: ${result.softwarePlatforms.join(', ')}`)
  if (Array.isArray(result.modelTransforms) && result.modelTransforms.length) parts.push('Model cleanup')
  return parts.join(' · ') || 'Prediction output'
}

function aliasTarget(alias: Alias, assist: Assist) {
  if (alias.kind === 'CUSTOMER') return assist.workspace.options.customers.find((item) => item.id === alias.targetId)?.name ?? alias.targetId
  if (alias.kind === 'SITE') return assist.workspace.options.sites.find((item) => item.id === alias.targetId)?.name ?? alias.targetId
  if (alias.kind === 'VENDOR') return assist.workspace.options.vendors.find((item) => item.id === alias.targetId)?.name ?? alias.targetId
  if (alias.kind === 'DEVICE_TYPE') return assist.workspace.options.deviceTypes.find((item) => item.id === alias.targetId)?.name ?? alias.targetId
  if (alias.kind === 'DEVICE_MODEL') {
    const model = assist.workspace.options.models.find((item) => item.id === alias.targetId)
    return model ? `${model.vendor.name} · ${model.model ?? model.name}` : alias.targetId
  }
  const release = assist.workspace.options.firmwareReleases.find((item) => item.id === alias.targetId)
  return release ? `${release.vendor.name} · ${release.platform} · ${release.version}` : alias.targetId
}

export function DeviceImportProfileMemoryPanel({ batchId }: { batchId: string }) {
  const [assist, setAssist] = useState<Assist | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [firmwareDraft, setFirmwareDraft] = useState<FirmwareRuleDraft>({
    field: 'firmwareVersion',
    operator: 'EQUALS',
    value: '',
    preferredSoftwarePlatform: '',
    firmwareSource: '',
    firmwareTransformOperation: '',
    firmwareTransformValue: '',
    firmwareTransformReplacement: '',
  })

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/device-import/batches/${batchId}/assist`)
    const payload = await response.json() as AssistPayload
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Import profile memory could not be loaded.')
    setAssist(payload.data)
  }, [batchId])

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/device-import/batches/${batchId}/assist`).then(async (response) => {
      const payload = await response.json() as AssistPayload
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Import profile memory could not be loaded.')
      return payload.data
    }).then(
      (data) => { if (!cancelled) setAssist(data) },
      (loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Import profile memory could not be loaded.') },
    )
    return () => { cancelled = true }
  }, [batchId])

  const aliasesByTarget = useMemo(() => {
    if (!assist) return []
    const groups = new Map<string, { key: string; kind: string; target: string; aliases: Alias[] }>()
    for (const alias of assist.profileRules.aliases) {
      const key = `${alias.kind}|${alias.targetId}`
      const current = groups.get(key)
      if (current) current.aliases.push(alias)
      else groups.set(key, { key, kind: alias.kind, target: aliasTarget(alias, assist), aliases: [alias] })
    }
    return [...groups.values()].sort((left, right) => left.kind.localeCompare(right.kind) || right.aliases.length - left.aliases.length || left.target.localeCompare(right.target))
  }, [assist])

  if (!assist?.workspace.batch.profileId) return null

  const profileId = assist.workspace.batch.profileId
  const rules = assist.profileRules.rules
  const firmwareRules = rules.filter(isFirmwarePredictionRule)
  const otherPredictionRules = rules.filter((rule) => rule.action === 'PREDICT' && !isFirmwarePredictionRule(rule))
  const learnedRules = rules.filter((rule) => rule.action !== 'PREDICT')
  const platforms = [...new Set([
    ...assist.workspace.options.models.map((item) => item.platform).filter((value): value is string => Boolean(value)),
    ...assist.workspace.options.firmwareReleases.map((item) => item.platform).filter(Boolean),
  ])].sort((left, right) => left.localeCompare(right))

  async function updateRule(rule: Rule, method: 'PATCH' | 'DELETE') {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules/${rule.id}`, {
        method,
        headers: method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'PATCH' ? JSON.stringify({ isActive: !rule.isActive }) : undefined,
      })
      const payload = await response.json() as { data?: unknown; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The rule could not be updated.')
      await load()
      setNotice(method === 'DELETE' ? 'Rule deleted.' : `Rule ${rule.isActive ? 'disabled' : 'enabled'}.`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'The rule could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  async function forgetAliases(aliasIds: string[]) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/aliases`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliasIds }),
      })
      const payload = await response.json() as { data?: { deleted: number }; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The learned mappings could not be forgotten.')
      await load()
      setNotice(`${payload.data.deleted.toLocaleString()} learned mapping${payload.data.deleted === 1 ? '' : 's'} forgotten.`)
    } catch (forgetError) {
      setError(forgetError instanceof Error ? forgetError.message : 'The learned mappings could not be forgotten.')
    } finally {
      setBusy(false)
    }
  }

  async function saveFirmwareRule() {
    if (!firmwareDraft.value.trim()) return
    const needsValue = ['REMOVE_PREFIX', 'REPLACE'].includes(firmwareDraft.firmwareTransformOperation)
    if (needsValue && !firmwareDraft.firmwareTransformValue.trim()) {
      setError('Enter the Firmware text/prefix the cleanup should use.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/v1/device-import/profiles/${profileId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: firmwareDraft.field,
          operator: firmwareDraft.operator,
          value: firmwareDraft.value,
          result: {
            preferredSoftwarePlatform: firmwareDraft.preferredSoftwarePlatform || null,
            firmwareSource: firmwareDraft.firmwareSource || null,
            firmwareTransforms: firmwareDraft.firmwareTransformOperation
              ? [{
                  operation: firmwareDraft.firmwareTransformOperation,
                  value: firmwareDraft.firmwareTransformOperation === 'EXTRACT_VERSION' ? undefined : firmwareDraft.firmwareTransformValue,
                  replacement: firmwareDraft.firmwareTransformOperation === 'REPLACE' ? firmwareDraft.firmwareTransformReplacement : undefined,
                }]
              : [],
          },
        }),
      })
      const payload = await response.json() as { data?: unknown; error?: { message?: string } }
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'The Firmware rule could not be saved.')
      setFirmwareDraft((current) => ({ ...current, value: '', preferredSoftwarePlatform: '', firmwareSource: '', firmwareTransformOperation: '', firmwareTransformValue: '', firmwareTransformReplacement: '' }))
      await load()
      setNotice('Firmware prediction rule saved and predictions recalculated.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The Firmware rule could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const ruleRows = (items: Rule[]) => items.length
    ? <div className="divide-y divide-[var(--border)]">{items.map((rule) => <div key={rule.id} className="grid gap-2 px-3 py-3 text-sm lg:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)_auto] lg:items-center"><div><span className={`mr-2 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${rule.isActive ? 'border-[#285f48] text-[#a9e8c6]' : 'border-[var(--border)] text-[var(--muted)]'}`}>{rule.isActive ? 'ACTIVE' : 'DISABLED'}</span><strong>If {rule.field} {rule.operator.toLocaleLowerCase()} “{rule.value}”</strong></div><div className="text-xs text-[var(--muted)]">{ruleOutput(rule)}</div><div className="flex gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => void updateRule(rule, 'PATCH')}>{rule.isActive ? 'Disable' : 'Enable'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void updateRule(rule, 'DELETE')}>Delete</Button></div></div>)}</div>
    : <div className="px-3 py-3 text-sm text-[var(--muted)]">None.</div>

  return <details className="mb-5 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
    <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">Profile rules &amp; learned mappings · {assist.workspace.batch.profileName ?? assist.profileRules.profile?.name ?? 'Import profile'}</summary>
    <div className="border-t border-[var(--border)] p-4 sm:p-5">
      <p className="text-sm text-[var(--muted)]">Firmware rules are separated from Model/classification rules. Learned exact mappings are grouped by their canonical target so large customer/site lists stay readable; the exact source values remain separate under the hood.</p>
      {error ? <div className="mt-3 rounded-md border border-[#754040] bg-[#2a1b1b] px-3 py-2 text-sm text-[#f0b0b0]">{error}</div> : null}
      {notice ? <div className="mt-3 rounded-md border border-[#285f48] bg-[#142b22] px-3 py-2 text-sm text-[#a9e8c6]">{notice}</div> : null}

      <details open className="mt-4 overflow-hidden rounded-md border border-[var(--border)]">
        <summary className="cursor-pointer bg-[var(--surface-raised)] px-3 py-3 font-semibold">Firmware prediction rules · {firmwareRules.length.toLocaleString()}</summary>
        <div className="border-t border-[var(--border)] p-3">
          <div className="grid gap-3 lg:grid-cols-[170px_170px_minmax(220px,1fr)]">
            <label className="text-xs font-semibold text-[var(--muted-strong)]">If field<SelectInput className="mt-1" value={firmwareDraft.field} disabled={busy} onChange={(event) => setFirmwareDraft((current) => ({ ...current, field: event.target.value as FirmwareRuleDraft['field'] }))}><option value="vendor">Vendor</option><option value="model">Model</option><option value="platform">Software Platform</option><option value="firmware">Effective Firmware</option><option value="firmwareVersion">Raw Firmware Version</option><option value="softwareVersion">Raw Software Version</option></SelectInput></label>
            <label className="text-xs font-semibold text-[var(--muted-strong)]">Condition<SelectInput className="mt-1" value={firmwareDraft.operator} disabled={busy} onChange={(event) => setFirmwareDraft((current) => ({ ...current, operator: event.target.value as FirmwareRuleDraft['operator'] }))}><option value="EQUALS">Equals</option><option value="PREFIX">Starts with</option><option value="CONTAINS">Contains</option></SelectInput></label>
            <label className="text-xs font-semibold text-[var(--muted-strong)]">Source value<TextInput className="mt-1" value={firmwareDraft.value} disabled={busy} placeholder="e.g. 0.1, Dublin, C2960X" onChange={(event) => setFirmwareDraft((current) => ({ ...current, value: event.target.value }))} /></label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold text-[var(--muted-strong)]">Preferred Software Platform<TextInput className="mt-1" list={`profile-platforms-${batchId}`} value={firmwareDraft.preferredSoftwarePlatform} disabled={busy} placeholder="Optional" onChange={(event) => setFirmwareDraft((current) => ({ ...current, preferredSoftwarePlatform: event.target.value }))} /></label>
            <label className="text-xs font-semibold text-[var(--muted-strong)]">Firmware source<SelectInput className="mt-1" value={firmwareDraft.firmwareSource} disabled={busy} onChange={(event) => setFirmwareDraft((current) => ({ ...current, firmwareSource: event.target.value as FirmwareRuleDraft['firmwareSource'] }))}><option value="">Automatic / effective</option><option value="FIRMWARE_VERSION">Firmware Version column</option><option value="SOFTWARE_VERSION">Software Version column</option></SelectInput></label>
            <label className="text-xs font-semibold text-[var(--muted-strong)]">Firmware cleanup<SelectInput className="mt-1" value={firmwareDraft.firmwareTransformOperation} disabled={busy} onChange={(event) => setFirmwareDraft((current) => ({ ...current, firmwareTransformOperation: event.target.value as FirmwareRuleDraft['firmwareTransformOperation'], firmwareTransformValue: event.target.value === 'EXTRACT_VERSION' ? '' : current.firmwareTransformValue }))}><option value="">None</option><option value="EXTRACT_VERSION">Extract version</option><option value="REMOVE_PREFIX">Remove prefix</option><option value="REPLACE">Replace text</option></SelectInput></label>
            <label className="text-xs font-semibold text-[var(--muted-strong)]">Cleanup value<TextInput className="mt-1" value={firmwareDraft.firmwareTransformValue} disabled={busy || !['REMOVE_PREFIX', 'REPLACE'].includes(firmwareDraft.firmwareTransformOperation)} placeholder="Prefix/text" onChange={(event) => setFirmwareDraft((current) => ({ ...current, firmwareTransformValue: event.target.value }))} /></label>
          </div>
          {firmwareDraft.firmwareTransformOperation === 'REPLACE' ? <div className="mt-3 max-w-md"><label className="text-xs font-semibold text-[var(--muted-strong)]">Replace with<TextInput className="mt-1" value={firmwareDraft.firmwareTransformReplacement} disabled={busy} onChange={(event) => setFirmwareDraft((current) => ({ ...current, firmwareTransformReplacement: event.target.value }))} /></label></div> : null}
          <datalist id={`profile-platforms-${batchId}`}>{platforms.map((platform) => <option key={platform} value={platform} />)}</datalist>
          <div className="mt-3 flex justify-end"><Button type="button" variant="primary" disabled={busy || !firmwareDraft.value.trim()} onClick={() => void saveFirmwareRule()}>{busy ? 'Saving…' : 'Save Firmware rule'}</Button></div>
        </div>
        <div className="border-t border-[var(--border)]">{ruleRows(firmwareRules)}</div>
      </details>

      <details className="mt-3 overflow-hidden rounded-md border border-[var(--border)]">
        <summary className="cursor-pointer bg-[var(--surface-raised)] px-3 py-3 font-semibold">Model / classification prediction rules · {otherPredictionRules.length.toLocaleString()}</summary>
        <div className="border-t border-[var(--border)]">{ruleRows(otherPredictionRules)}</div>
      </details>

      <details className="mt-3 overflow-hidden rounded-md border border-[var(--border)]">
        <summary className="cursor-pointer bg-[var(--surface-raised)] px-3 py-3 font-semibold">Learned ignore / classification rules · {learnedRules.length.toLocaleString()}</summary>
        <div className="border-t border-[var(--border)]">{ruleRows(learnedRules)}</div>
      </details>

      <details className="mt-3 overflow-hidden rounded-md border border-[var(--border)]">
        <summary className="cursor-pointer bg-[var(--surface-raised)] px-3 py-3 font-semibold">Learned exact mappings · {assist.profileRules.aliases.length.toLocaleString()} values in {aliasesByTarget.length.toLocaleString()} groups</summary>
        <div className="border-t border-[var(--border)] p-3">
          <div className="space-y-2">{aliasesByTarget.map((group) => <details key={group.key} className="overflow-hidden rounded border border-[var(--border)]"><summary className="cursor-pointer px-3 py-2 text-sm"><strong>{group.kind.replaceAll('_', ' ')}</strong> → {group.target} <span className="text-[var(--muted)]">· {group.aliases.length.toLocaleString()} source value{group.aliases.length === 1 ? '' : 's'}</span></summary><div className="border-t border-[var(--border)]"><div className="flex justify-end px-3 py-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => void forgetAliases(group.aliases.map((alias) => alias.id))}>Forget group</Button></div><div className="divide-y divide-[var(--border)]">{group.aliases.map((alias) => <div key={alias.id} className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[minmax(260px,1fr)_minmax(220px,1fr)_auto] md:items-center"><span>If value equals “{alias.sourceValue}”</span><span className="text-xs text-[var(--muted)]">Link → {group.target}</span><Button type="button" variant="ghost" disabled={busy} onClick={() => void forgetAliases([alias.id])}>Forget</Button></div>)}</div></div></details>)}</div>
        </div>
      </details>
    </div>
  </details>
}
