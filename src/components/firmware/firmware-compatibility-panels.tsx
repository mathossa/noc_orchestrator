'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type ApiError = { error?: { message?: string } }

type ModelCompatibilityView = {
  model: { id: string; model: string; familyId: string | null; vendorId: string }
  supportedPlatforms: string[]
  rules: Array<{
    id: string
    inherited: boolean
    decision: 'ALLOW' | 'DENY'
    sourceType: 'CATALOG' | 'CONFIGURED_RULE'
    platform: string
    firmwareTrainName: string | null
    logicalVersion: string | null
    firmwareReleaseVersion: string | null
    imageCode: string | null
    explanation: string
  }>
  overrides: Array<{
    id: string
    firmwareReleaseId: string
    firmwareRelease: { id: string; version: string; platform: string; imageCode: string | null } | null
    decision: 'ALLOW' | 'DENY'
    reason: string
    version: number
    createdAt: string
  }>
  availableReleases: Array<{ id: string; version: string; platform: string; imageCode: string | null; logicalVersion: string }>
}

type ReleaseCompatibilityView = {
  release: { id: string; version: string; platform: string; imageCode: string | null }
  counts: { compatible: number; incompatible: number; unknown: number }
  models: Array<{
    model: { id: string; model: string }
    result: {
      status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN'
      provenance: { kind: string; sourceType: string; explanation: string; inherited: boolean }
    }
  }>
}

function targetLabel(rule: ModelCompatibilityView['rules'][number]) {
  const details = [rule.platform]
  if (rule.firmwareTrainName) details.push(rule.firmwareTrainName)
  if (rule.logicalVersion) details.push(rule.logicalVersion)
  if (rule.firmwareReleaseVersion) details.push(rule.firmwareReleaseVersion)
  if (rule.imageCode) details.push(`image ${rule.imageCode}`)
  return details.join(' · ')
}

export function ModelFirmwareCompatibilityPanel({ modelId }: { modelId: string }) {
  const [data, setData] = useState<ModelCompatibilityView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [releaseId, setReleaseId] = useState('')
  const [decision, setDecision] = useState<'ALLOW' | 'DENY'>('ALLOW')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const response = await fetch(`/api/v1/models/${modelId}/firmware-compatibility`, { cache: 'no-store' })
    const payload = (await response.json()) as { data?: ModelCompatibilityView } & ApiError
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Compatibility could not be loaded.')
    setData(payload.data)
  }

  useEffect(() => {
    let cancelled = false
    void load().catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Compatibility could not be loaded.')
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const selectedRelease = useMemo(() => data?.availableReleases.find((release) => release.id === releaseId) ?? null, [data, releaseId])

  async function saveOverride() {
    if (!releaseId || !reason.trim()) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/models/${modelId}/firmware-compatibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmwareReleaseId: releaseId, decision, reason }),
      })
      const payload = (await response.json()) as { data?: ModelCompatibilityView } & ApiError
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Compatibility override could not be saved.')
      setData(payload.data)
      setReason('')
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Compatibility override could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function clearOverride(firmwareReleaseId: string) {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/models/${modelId}/firmware-compatibility`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmwareReleaseId }),
      })
      const payload = (await response.json()) as { data?: ModelCompatibilityView } & ApiError
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Compatibility override could not be cleared.')
      setData(payload.data)
    } catch (clearError: unknown) {
      setError(clearError instanceof Error ? clearError.message : 'Compatibility override could not be cleared.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Firmware compatibility</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">Compatibility is explicit evidence, separate from desired policy. Concrete-model rules override inherited family rules; manual overrides are audited and take highest precedence.</p>
        </div>
        {data ? <div className="flex flex-wrap gap-2">{data.supportedPlatforms.length ? data.supportedPlatforms.map((platform) => <span key={platform} className="rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs font-semibold">{platform}</span>) : <span className="text-xs text-[var(--muted)]">No supported platform proven</span>}</div> : null}
      </div>

      {error ? <div className="mt-4 rounded-md border border-red-800/60 bg-red-950/20 px-3 py-2 text-sm text-red-300">{error}</div> : null}
      {!data && !error ? <div className="mt-4 text-sm text-[var(--muted)]">Loading compatibility…</div> : null}

      {data ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Rules and provenance</h3>
            {data.rules.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">No model or family compatibility evidence is configured. Unmatched firmware therefore resolves to UNKNOWN.</p> : <div className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">{data.rules.map((rule) => <div key={rule.id} className="p-3"><div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-semibold ${rule.decision === 'ALLOW' ? 'bg-emerald-950/40 text-emerald-300' : 'bg-red-950/40 text-red-300'}`}>{rule.decision}</span><span className="text-[var(--muted-strong)]">{rule.inherited ? 'Inherited family rule' : 'Concrete model rule'}</span><span className="text-[var(--muted)]">{rule.sourceType}</span></div><div className="mt-2 font-mono text-sm text-[var(--foreground)]">{targetLabel(rule)}</div><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{rule.explanation}</p></div>)}</div>}

            <h3 className="mt-5 text-sm font-semibold text-[var(--foreground)]">Active manual overrides</h3>
            {data.overrides.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">No manual compatibility overrides.</p> : <div className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">{data.overrides.map((override) => <div key={override.id} className="flex items-start justify-between gap-3 p-3"><div><div className="text-sm font-semibold"><span className={override.decision === 'ALLOW' ? 'text-emerald-300' : 'text-red-300'}>{override.decision}</span> · {override.firmwareRelease?.version ?? override.firmwareReleaseId}</div><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{override.reason}</p><div className="mt-1 text-[11px] text-[var(--muted)]">Manual override v{override.version}</div></div><button type="button" disabled={saving} onClick={() => void clearOverride(override.firmwareReleaseId)} className="rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--surface-raised)] disabled:opacity-50">Clear</button></div>)}</div>}
          </div>

          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Manual override</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Use only when catalog compatibility is incomplete or wrong. This does not rewrite the underlying rule and is fully reversible.</p>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" htmlFor="compat-release">Firmware release</label>
            <select id="compat-release" value={releaseId} onChange={(event) => setReleaseId(event.target.value)} className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"><option value="">Choose release…</option>{data.availableReleases.map((release) => <option key={release.id} value={release.id}>{release.version} · {release.platform}{release.imageCode ? ` · ${release.imageCode}` : ''}</option>)}</select>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" htmlFor="compat-decision">Decision</label>
            <select id="compat-decision" value={decision} onChange={(event) => setDecision(event.target.value as 'ALLOW' | 'DENY')} className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm"><option value="ALLOW">Allow</option><option value="DENY">Deny</option></select>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]" htmlFor="compat-reason">Reason</label>
            <textarea id="compat-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Vendor bulletin, lab validation, support confirmation…" />
            {selectedRelease ? <p className="mt-2 text-xs text-[var(--muted)]">Override target: <Link className="text-[var(--accent-light)] hover:underline" href={`/firmware/${selectedRelease.id}`}>{selectedRelease.version}</Link></p> : null}
            <button type="button" disabled={saving || !releaseId || !reason.trim()} onClick={() => void saveOverride()} className="mt-4 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50">{saving ? 'Saving…' : 'Save override'}</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function ReleaseModelCompatibilityPanel({ releaseId }: { releaseId: string }) {
  const [data, setData] = useState<ReleaseCompatibilityView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/v1/firmware-releases/${releaseId}/compatibility`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: ReleaseCompatibilityView } & ApiError
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Compatibility could not be loaded.')
        if (!cancelled) setData(payload.data)
      })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Compatibility could not be loaded.') })
    return () => { cancelled = true }
  }, [releaseId])

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">Model compatibility</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Exact compatibility for this canonical release. UNKNOWN means no evidence exists; it is never treated as implicit support.</p>
      {error ? <div className="mt-4 text-sm text-red-300">{error}</div> : null}
      {data ? <><div className="mt-4 grid gap-3 sm:grid-cols-3"><CompatCount label="Compatible" value={data.counts.compatible} /><CompatCount label="Incompatible" value={data.counts.incompatible} /><CompatCount label="Unknown" value={data.counts.unknown} /></div><div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">{data.models.length === 0 ? <div className="p-4 text-sm text-[var(--muted)]">No active models exist for this vendor.</div> : data.models.map(({ model, result }) => <div key={model.id} className="flex flex-wrap items-start justify-between gap-3 p-3"><div><Link href={`/models/${model.id}`} className="font-medium text-[var(--accent-light)] hover:underline">{model.model}</Link><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{result.provenance.explanation}</p></div><div className="text-right"><div className={`text-xs font-semibold ${result.status === 'COMPATIBLE' ? 'text-emerald-300' : result.status === 'INCOMPATIBLE' ? 'text-red-300' : 'text-amber-300'}`}>{result.status}</div><div className="mt-1 text-[11px] text-[var(--muted)]">{result.provenance.kind}{result.provenance.inherited ? ' · inherited' : ''}</div></div></div>)}</div></> : !error ? <div className="mt-4 text-sm text-[var(--muted)]">Loading compatibility…</div> : null}
    </section>
  )
}

function CompatCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div></div>
}
