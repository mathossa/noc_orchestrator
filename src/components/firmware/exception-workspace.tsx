'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  EXCEPTION_DURATIONS,
  EXCEPTION_SCOPES,
  EXCEPTION_SUBJECTS,
  nextQuarter,
} from '@/lib/firmware-exceptions'
import type {
  exceptionReferenceData,
  listFirmwareExceptions,
  previewFirmwareException,
} from '@/lib/firmware-exception-store'
import { PageHeader } from '@/components/ui/page-header'
type Data = Awaited<ReturnType<typeof listFirmwareExceptions>>
type References = Awaited<ReturnType<typeof exceptionReferenceData>>
type Preview = Awaited<ReturnType<typeof previewFirmwareException>>
const control =
  'mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-2 text-sm'
const button =
  'rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold disabled:opacity-50'
const label = (s: string) => s.toLowerCase().replaceAll('_', ' ')
async function api(query = '', body?: unknown) {
  const r = await fetch(
    `/api/v1/firmware-exceptions${query}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  )
  const p = await r.json()
  if (!r.ok) throw Error(p.error?.message ?? 'Request failed.')
  return p.data
}
export function ExceptionWorkspace({
  initialScope = 'DEVICE',
  initialScopeId = '',
}: {
  initialScope?: string
  initialScopeId?: string
}) {
  const [data, setData] = useState<Data | null>(null),
    [refs, setRefs] = useState<References | null>(null)
  const [form, setForm] = useState<Record<string, string>>({
    scope: EXCEPTION_SCOPES.includes(
      initialScope as (typeof EXCEPTION_SCOPES)[number],
    )
      ? initialScope
      : 'DEVICE',
    scopeId: initialScopeId,
    subject: 'RELEASE',
    duration: 'NEXT_REVIEW',
    reasonCode: 'CUSTOMER_DECLINED',
  })
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('ALL')
  const [reasonCode, setReasonCode] = useState(''),
    [reasonLabel, setReasonLabel] = useState(''),
    [replacement, setReplacement] = useState(false)
  const reload = useCallback(async () => {
    const [d, r] = await Promise.all([
      api(
        initialScope === 'DEVICE' && initialScopeId
          ? `?deviceId=${encodeURIComponent(initialScopeId)}`
          : '',
      ),
      api('?references=true'),
    ])
    setData(d)
    setRefs(r)
  }, [initialScope, initialScopeId])
  useEffect(() => {
    reload().catch((e) => setError(e.message))
  }, [reload])
  const update = (key: string, value: string) => {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'scope' ? { scopeId: '' } : {}),
    }))
    setPreview(null)
    setMessage('')
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }
  const input = () => ({
    ...form,
    expiresAt: form.expiresAt
      ? new Date(form.expiresAt).toISOString()
      : undefined,
  })
  const select = (
    name: string,
    title: string,
    options: { id: string; name: string }[],
  ) => (
    <label className="text-sm">
      {title}
      <select
        className={control}
        value={form[name] ?? ''}
        onChange={(e) => update(name, e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  )
  const field = (name: string, title: string, type = 'text') => (
    <label className="text-sm">
      {title}
      <input
        type={type}
        className={control}
        value={form[name] ?? ''}
        onChange={(e) => update(name, e.target.value)}
      />
    </label>
  )
  const now = new Date(),
    quarter = nextQuarter(now)
  const records =
    data?.records.filter((r) => {
      if (
        initialScopeId &&
        initialScope !== 'DEVICE' &&
        !(r.scope === initialScope && r.scopeId === initialScopeId)
      )
        return false
      switch (filter) {
        case 'EXPIRING':
          return (
            r.status === 'ACTIVE' &&
            !!r.expiresAt &&
            new Date(r.expiresAt) <= quarter
          )
        case 'PERMANENT':
          return r.duration === 'PERMANENT'
        case 'DECLINED':
          return r.reasonCode === 'CUSTOMER_DECLINED'
        case 'REPLACEMENT':
          return r.replacementRelated
        case 'PLATFORM':
          return r.subject === 'PLATFORM_MIGRATION'
        case 'REVIEW':
          return r.policyChangedDevices > 0 || r.status === 'EXPIRED'
        case 'ALL':
          return true
        default:
          return r.status === filter
      }
    }) ?? []
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firmware"
        title="Exceptions"
        description="Record why a recommendation is on hold, who it covers, and when to review it. Technical firmware state remains visible."
      />
      {error ? (
        <p
          role="alert"
          className="rounded border border-red-500 p-3 text-red-300"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-emerald-300">
          {message}
        </p>
      ) : null}
      {!data || !refs ? (
        <p>Loading exception data…</p>
      ) : (
        <>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="font-semibold">Add exception</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {select(
                'scope',
                'Scope',
                EXCEPTION_SCOPES.map((id) => ({ id, name: label(id) })),
              )}
              {select(
                'scopeId',
                'Applies to',
                refs.scopes[form.scope as keyof References['scopes']] ?? [],
              )}
              {select(
                'subject',
                'Coverage',
                EXCEPTION_SUBJECTS.map((id) => ({ id, name: label(id) })),
              )}
              {select(
                'reasonCode',
                'Reason',
                data.reasons
                  .filter((r) => r.isActive)
                  .map((r) => ({ id: r.code, name: r.label })),
              )}
              {select(
                'duration',
                'Duration',
                EXCEPTION_DURATIONS.map((id) => ({
                  id,
                  name:
                    id === 'NEXT_REVIEW'
                      ? 'Next quarterly review (3 months)'
                      : label(id),
                })),
              )}
              {['CUSTOM_DATE', 'UNTIL_EOL'].includes(form.duration)
                ? field(
                    'expiresAt',
                    form.duration === 'UNTIL_EOL'
                      ? 'Known device EOL date'
                      : 'Review / expiry date',
                    'datetime-local',
                  )
                : null}
              {form.subject === 'RELEASE'
                ? select('releaseId', 'Exact release / build', refs.releases)
                : null}
              {form.subject === 'TRAIN'
                ? select('trainId', 'Train', refs.trains)
                : null}
              {form.subject === 'RANGE' ? (
                <>
                  {select('vendorId', 'Vendor', refs.vendors)}
                  {field('platform', 'Platform')}
                  {field('minimumVersion', 'Minimum version (inclusive)')}
                  {field('maximumVersion', 'Maximum version (inclusive)')}
                </>
              ) : null}
              {form.subject === 'PLATFORM_MIGRATION' ? (
                <>
                  {field('fromPlatform', 'From platform')}
                  {field('toPlatform', 'To platform')}
                </>
              ) : null}
              {field(
                'contactReference',
                'Customer decision / contact reference',
              )}
              {field('ticketReference', 'Ticket reference')}
              <label className="text-sm md:col-span-3">
                Notes{form.reasonCode === 'OTHER' ? ' (required)' : ''}
                <textarea
                  rows={3}
                  className={control}
                  value={form.notes ?? ''}
                  onChange={(e) => update('notes', e.target.value)}
                />
              </label>
            </div>
            <p className="my-3 text-xs text-[var(--muted)]">
              Device → Site → Customer → Model → Family precedence. Until policy
              changes is evaluated separately for each device; new devices
              require a new decision. Other durations also cover devices later
              added to the scope. EOL requires a known date.
            </p>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                void run(async () =>
                  setPreview(
                    await api('', { action: 'preview', input: input() }),
                  ),
                )
              }
            >
              Preview affected devices
            </button>
            {preview ? (
              <div className="mt-4 rounded border border-[var(--border-strong)] p-4">
                <p>
                  <strong>{preview.affectedCount}</strong> current
                  recommendations covered across{' '}
                  <strong>{preview.totalDevices}</strong> devices in{' '}
                  {preview.scopeLabel}.
                </p>
                <details className="my-3 text-sm">
                  <summary>Inspect affected devices</summary>
                  <ul className="max-h-48 overflow-auto">
                    {preview.affectedDevices.map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/devices/${d.id}`}
                          className="text-[var(--accent-light)]"
                        >
                          {d.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
                <button
                  className={`${button} bg-[var(--accent)] text-[var(--accent-contrast)]`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api('', {
                        action: 'create',
                        input: input(),
                        token: preview.token,
                      })
                      setPreview(null)
                      await reload()
                      setMessage(
                        'Exception saved. Technical compliance is unchanged.',
                      )
                    })
                  }
                >
                  Confirm and save exception
                </button>
              </div>
            ) : null}
          </section>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Exceptions and review history</h2>
              <select
                aria-label="Filter exceptions"
                className={button}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  ['ALL', 'All records'],
                  ['ACTIVE', 'Active'],
                  ['EXPIRING', 'Expiring before next quarterly review'],
                  ['REVIEW', 'Expired / policy changed'],
                  ['PERMANENT', 'Permanent'],
                  ['DECLINED', 'Customer declined'],
                  ['PLATFORM', 'Platform holds'],
                  ['REPLACEMENT', 'EOL / replacement'],
                  ['SUPERSEDED', 'Superseded'],
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {initialScopeId ? (
              <Link
                className="text-sm text-[var(--accent-light)]"
                href="/firmware/exceptions"
              >
                Show all scopes →
              </Link>
            ) : null}
            {!records.length ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No exceptions match this view.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {records.map((r) => (
                  <article
                    className="rounded border border-[var(--border)] p-4"
                    key={r.id}
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="font-medium">
                        {data.reasons.find(
                          (reason) => reason.code === r.reasonCode,
                        )?.label ?? r.reasonCode}{' '}
                        · {r.scopeLabel}
                      </h3>
                      <span className="text-xs">{label(r.status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {label(r.scope)} · {label(r.subject)} ·{' '}
                      {label(r.duration)}
                      {r.expiresAt
                        ? ` · Review ${new Date(r.expiresAt).toLocaleDateString()}`
                        : ''}{' '}
                      · {r.activeDevices} matching devices
                      {r.policyChangedDevices
                        ? ` · ${r.policyChangedDevices} policy changes need review`
                        : ''}
                      {r.replacementRelated ? ' · Replacement follow-up' : ''}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {r.notes}
                    </p>
                    <details className="mt-3 text-xs">
                      <summary>
                        Decision evidence and affected inventory
                      </summary>
                      <p className="my-2">
                        Decided {new Date(r.decidedAt).toLocaleString()} · Actor{' '}
                        {r.actorUserId ?? 'Historical actor unavailable'} ·{' '}
                        {r.contactReference} · {r.ticketReference}
                      </p>
                      <p>
                        {r.releaseId
                          ? (refs.releases.find((x) => x.id === r.releaseId)
                              ?.name ?? r.releaseId)
                          : ''}
                        {r.trainId
                          ? (refs.trains.find((x) => x.id === r.trainId)
                              ?.name ?? r.trainId)
                          : ''}
                        {r.subject === 'RANGE'
                          ? `${r.platform}: ${r.minimumVersion} – ${r.maximumVersion}`
                          : ''}
                        {r.subject === 'PLATFORM_MIGRATION'
                          ? `${r.fromPlatform} → ${r.toPlatform}`
                          : ''}
                      </p>
                      {data.resolutions
                        .filter((d) => d.scopedExceptionIds.includes(r.id))
                        .map((d) => (
                          <p key={d.deviceId}>
                            <Link
                              href={`/devices/${d.deviceId}`}
                              className="text-[var(--accent-light)]"
                            >
                              {d.name}
                            </Link>{' '}
                            · {label(d.compliance)} · {label(d.recommendation)}{' '}
                            ·{' '}
                            {d.selectedId === r.id
                              ? 'Effective exception'
                              : d.applicableIds.includes(r.id)
                                ? 'More specific / newer exception takes precedence'
                                : 'Not suppressing this recommendation'}
                          </p>
                        ))}
                      {r.legacyEvidence ? (
                        <p>
                          Original lifecycle decision and audit history
                          retained.
                        </p>
                      ) : null}
                    </details>
                    {!r.supersededAt ? (
                      <button
                        disabled={busy}
                        className={`${button} mt-3`}
                        onClick={() =>
                          void run(async () => {
                            await api('', { action: 'supersede', id: r.id })
                            await reload()
                            setMessage(
                              'Exception ended; its history is retained.',
                            )
                          })
                        }
                      >
                        End exception
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
          <details className="rounded border border-[var(--border)] p-4">
            <summary className="text-sm">
              Add reason code (administrator)
            </summary>
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                aria-label="Reason code"
                placeholder="REASON_CODE"
                className={button}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value.toUpperCase())}
              />
              <input
                aria-label="Reason label"
                placeholder="Reason label"
                className={button}
                value={reasonLabel}
                onChange={(e) => setReasonLabel(e.target.value)}
              />
              <label className="text-sm">
                <input
                  type="checkbox"
                  checked={replacement}
                  onChange={(e) => setReplacement(e.target.checked)}
                />{' '}
                Replacement / EOL follow-up
              </label>
              <button
                disabled={busy}
                className={button}
                onClick={() =>
                  void run(async () => {
                    await api('', {
                      action: 'reason',
                      input: {
                        code: reasonCode,
                        label: reasonLabel,
                        replacementRelated: replacement,
                      },
                    })
                    await reload()
                    setReasonCode('')
                    setReasonLabel('')
                    setMessage('Reason added.')
                  })
                }
              >
                Add reason
              </button>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
