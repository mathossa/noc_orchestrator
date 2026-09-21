'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { DeviceModelDetailRecord } from '@/lib/device-models'
import type { FirmwarePolicyMode } from '@/lib/firmware-policies'

type Compatibility = {
  status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN'
  provenance: { explanation: string }
}
type Train = {
  id: string
  name: string
  vendorId: string
  platform: string
  isActive: boolean
}
const modes: Array<{
  value: FirmwarePolicyMode
  label: string
  description: string
}> = [
  {
    value: 'EXACT',
    label: 'Exact release',
    description:
      'Only the preferred release or an explicitly permitted equivalent is accepted.',
  },
  {
    value: 'MINIMUM',
    label: 'Minimum version',
    description:
      'Accept firmware at or above the minimum. Recommend an update when below preferred.',
  },
  {
    value: 'RANGE',
    label: 'Approved range',
    description:
      'Accept firmware within the configured bounds. Newer than the maximum requires review.',
  },
  {
    value: 'LATEST_APPROVED_IN_TRAIN',
    label: 'Latest approved in train',
    description:
      'Preferred follows explicitly policy-approved releases in this train. Importing or verifying a release alone does not move it.',
  },
]
type EditorModel = Pick<
  DeviceModelDetailRecord,
  'id' | 'vendorId' | 'desiredFirmware' | 'availableFirmware' | 'effectiveCatalogDefaults'
>

function initialForm(model: EditorModel) {
  const p = model.desiredFirmware
  return {
    policyMode: p.policyMode ?? ('EXACT' as FirmwarePolicyMode),
    targetFirmwareReleaseId: p.release?.id ?? '',
    minimumFirmwareReleaseId: p.minimumRelease?.id ?? '',
    maximumFirmwareReleaseId: p.maximumRelease?.id ?? '',
    firmwareTrainId: p.firmwareTrain?.id ?? '',
    minimumInclusive: p.minimumInclusive,
    maximumInclusive: p.maximumInclusive,
  }
}
const selectStyle =
  'mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--foreground)]'

export function DesiredFirmwareEditor({
  model,
  compatibility,
  onSaved,
}: {
  model: EditorModel
  compatibility: Map<string, Compatibility>
  onSaved: (model: DeviceModelDetailRecord) => void
}) {
  const [form, setForm] = useState(() => initialForm(model))
  const [trains, setTrains] = useState<Train[]>([])
  const [trainError, setTrainError] = useState<string | null>(null)
  const [loadingTrains, setLoadingTrains] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(() => Boolean(model.desiredFirmware.policyId))
  useEffect(() => {
    let cancelled = false
    void fetch('/api/v1/firmware-trains', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok)
          throw new Error(
            payload.error?.message ?? 'Firmware trains could not be loaded.',
          )
        if (!cancelled) setTrains(payload.data ?? [])
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setTrainError(
            e instanceof Error
              ? e.message
              : 'Firmware trains could not be loaded.',
          )
      })
      .finally(() => {
        if (!cancelled) setLoadingTrains(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const p = model.desiredFirmware
  const moving = form.policyMode === 'LATEST_APPROVED_IN_TRAIN'
  const bounded = form.policyMode === 'MINIMUM' || form.policyMode === 'RANGE'
  const preferred = model.availableFirmware.releases.find(
    (r) => r.id === form.targetFirmwareReleaseId,
  )
  const releases = model.availableFirmware.releases.filter(
    (r) => r.selectable && compatibility.get(r.id)?.status !== 'INCOMPATIBLE',
  )
  const eligibleTrains = trains.filter(
    (t) => t.vendorId === model.vendorId && t.isActive,
  )
  function update(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
    setMessage(null)
  }
  function releaseSelector(
    field:
      | 'targetFirmwareReleaseId'
      | 'minimumFirmwareReleaseId'
      | 'maximumFirmwareReleaseId',
    label: string,
    required: boolean,
  ) {
    const options = releases.filter(
      (r) =>
        field === 'targetFirmwareReleaseId' ||
        r.platform === preferred?.platform,
    )
    const selected = model.availableFirmware.releases.find(
      (r) => r.id === form[field],
    )
    return (
      <label className="block text-sm font-medium" htmlFor={`policy-${field}`}>
        {label}
        <select
          id={`policy-${field}`}
          className={selectStyle}
          value={form[field]}
          required={required}
          disabled={
            saving || (field !== 'targetFirmwareReleaseId' && !preferred)
          }
          onChange={(e) => {
            const value = e.target.value
            const next = model.availableFirmware.releases.find(
              (r) => r.id === value,
            )
            update(
              field === 'targetFirmwareReleaseId' &&
                next?.platform !== preferred?.platform
                ? {
                    [field]: value,
                    minimumFirmwareReleaseId: '',
                    maximumFirmwareReleaseId: '',
                  }
                : { [field]: value },
            )
          }}
        >
          <option value="">{required ? 'Choose a release' : 'No bound'}</option>
          {form[field] && !options.some((r) => r.id === form[field]) ? (
            <option value={form[field]} disabled>
              {selected?.version ?? form[field]} · unavailable for new policy
            </option>
          ) : null}
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.version} · {r.platform} ·{' '}
              {compatibility.get(r.id)?.status === 'COMPATIBLE'
                ? 'compatible'
                : 'compatibility unknown'}
            </option>
          ))}
        </select>
      </label>
    )
  }
  async function save(clear = false) {
    if (
      !clear &&
      form.policyMode === 'RANGE' &&
      !form.minimumFirmwareReleaseId &&
      !form.maximumFirmwareReleaseId
    ) {
      setError('Choose a minimum and/or maximum for an approved range.')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/v1/models/${model.id}/desired-firmware`,
        {
          method: clear ? 'DELETE' : 'PUT',
          headers: clear ? undefined : { 'Content-Type': 'application/json' },
          body: clear ? undefined : JSON.stringify(form),
        },
      )
      const payload = (await response.json()) as {
        data?: DeviceModelDetailRecord
        error?: { message?: string }
      }
      if (!response.ok || !payload.data)
        throw new Error(
          payload.error?.message ?? 'Desired firmware could not be saved.',
        )
      onSaved(payload.data)
      setForm(initialForm(payload.data))
      if (clear) setOverrideOpen(false)
      setMessage(
        clear
          ? 'Model override removed. Devices now inherit the applicable scoped policy or Firmware Catalog default.'
          : 'Model override saved. Open a device to inspect its effective target and compatibility.',
      )
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Desired firmware could not be saved.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <section
      id="desired-firmware-policy"
      className="scroll-mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold">Firmware target</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Normal behavior is automatic: devices inherit the Firmware Catalog default for their observed supported platform. Configure a model override only when this model must deliberately differ.
        </p>
      </div>
      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase text-[var(--muted)]">
            Model override
          </h3>
          {p.policyId ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-[var(--muted)]">Mode</dt>
                <dd>{modes.find((m) => m.value === p.policyMode)?.label}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Platform</dt>
                <dd>{p.desiredPlatform}</dd>
              </div>
              {p.policyMode === 'LATEST_APPROVED_IN_TRAIN' ? (
                <div>
                  <dt className="text-[var(--muted)]">Train</dt>
                  <dd>{p.firmwareTrain?.name ?? 'Unresolved train'}</dd>
                  <dd className="mt-1 text-xs text-[var(--muted)]">
                    The preferred release is resolved from approved releases
                    when evaluating devices.
                  </dd>
                </div>
              ) : (
                <div>
                  <dt className="text-[var(--muted)]">Preferred release</dt>
                  <dd>
                    {p.release ? (
                      <Link
                        href={`/firmware/${p.release.id}`}
                        className="font-mono text-[var(--accent-light)]"
                      >
                        {p.release.version}
                      </Link>
                    ) : (
                      'Unresolved'
                    )}
                  </dd>
                </div>
              )}
              {p.release ? (
                <>
                  <div>
                    <dt className="text-[var(--muted)]">Catalog state</dt>
                    <dd>
                      {p.release.catalogState}
                      {p.release.isActive ? '' : ' · archived'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Compatibility</dt>
                    <dd>
                      {compatibility.get(p.release.id)?.status ?? 'UNKNOWN'}
                    </dd>
                  </div>
                </>
              ) : null}
              {p.minimumRelease ? (
                <div>
                  <dt className="text-[var(--muted)]">Minimum</dt>
                  <dd>
                    {p.minimumRelease.version} ·{' '}
                    {p.minimumInclusive ? 'inclusive' : 'exclusive'}
                  </dd>
                </div>
              ) : null}
              {p.maximumRelease ? (
                <div>
                  <dt className="text-[var(--muted)]">Maximum</dt>
                  <dd>
                    {p.maximumRelease.version} ·{' '}
                    {p.maximumInclusive ? 'inclusive' : 'exclusive'}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <div className="mt-3 space-y-3 text-sm text-[var(--muted)]">
              <p>No model override. Scoped policies still take precedence; otherwise the Firmware Catalog drives compliance automatically.</p>
              {model.effectiveCatalogDefaults.length > 0 ? (
                <div className="space-y-2">
                  {model.effectiveCatalogDefaults.map((catalogDefault) => (
                    <div key={catalogDefault.releaseId} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/firmware/${catalogDefault.releaseId}`} className="font-mono font-semibold text-[var(--accent-light)] hover:underline">
                          {catalogDefault.version}
                        </Link>
                        <span className="text-xs">{catalogDefault.deviceCount} device{catalogDefault.deviceCount === 1 ? '' : 's'}</span>
                      </div>
                      <div className="mt-1 text-xs">{catalogDefault.platform} · {catalogDefault.trainName} · catalog default</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-5">No catalog target is currently resolved from devices using this model. For multi-platform models, the observed current firmware platform selects the applicable catalog default.</p>
              )}
            </div>
          )}
        </div>
        {!p.policyId && !overrideOpen ? (
          <div className="h-fit rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <h3 className="text-sm font-semibold">Model override</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              You normally do not need this. Add an override only when this model should intentionally use a different target than the catalog default.
            </p>
            <button
              type="button"
              onClick={() => setOverrideOpen(true)}
              className="mt-4 rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface)]"
            >
              Configure model override
            </button>
          </div>
        ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className="block text-sm font-medium" htmlFor="policy-mode">
            Policy mode
            <select
              id="policy-mode"
              className={selectStyle}
              value={form.policyMode}
              disabled={saving}
              onChange={(e) =>
                update({ policyMode: e.target.value as FirmwarePolicyMode })
              }
            >
              {modes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5 text-[var(--muted)]">
            {modes.find((m) => m.value === form.policyMode)?.description}
          </p>
          {moving ? (
            <label className="block text-sm font-medium" htmlFor="policy-train">
              Approved firmware train
              <select
                id="policy-train"
                className={selectStyle}
                value={form.firmwareTrainId}
                required
                disabled={saving || loadingTrains}
                onChange={(e) => update({ firmwareTrainId: e.target.value })}
              >
                <option value="">
                  {loadingTrains ? 'Loading trains…' : 'Choose a train'}
                </option>
                {form.firmwareTrainId &&
                !eligibleTrains.some((t) => t.id === form.firmwareTrainId) ? (
                  <option value={form.firmwareTrainId} disabled>
                    {p.firmwareTrain?.name ?? form.firmwareTrainId} ·
                    unavailable
                  </option>
                ) : null}
                {eligibleTrains.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.platform}
                  </option>
                ))}
              </select>
              {trainError ? (
                <p role="alert" className="mt-2 text-red-300">
                  {trainError}
                </p>
              ) : null}
            </label>
          ) : (
            releaseSelector(
              'targetFirmwareReleaseId',
              'Preferred release',
              true,
            )
          )}
          {bounded ? (
            <>
              {releaseSelector(
                'minimumFirmwareReleaseId',
                'Minimum release',
                form.policyMode === 'MINIMUM',
              )}
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.minimumInclusive}
                  disabled={saving || !form.minimumFirmwareReleaseId}
                  onChange={(e) =>
                    update({ minimumInclusive: e.target.checked })
                  }
                />
                Include the minimum version
              </label>
            </>
          ) : null}
          {form.policyMode === 'RANGE' ? (
            <>
              {releaseSelector(
                'maximumFirmwareReleaseId',
                'Maximum release',
                false,
              )}
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.maximumInclusive}
                  disabled={saving || !form.maximumFirmwareReleaseId}
                  onChange={(e) =>
                    update({ maximumInclusive: e.target.checked })
                  }
                />
                Include the maximum version
              </label>
            </>
          ) : null}
          <p className="text-xs leading-5 text-[var(--muted)]">
            Only active, policy-eligible releases are offered. Unknown image
            compatibility can be saved as intent and remains review-required.
            Known incompatibility is rejected.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || (moving && (loadingTrains || !!trainError))}
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save model override'}
            </button>
            {p.policyId ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(true)}
                className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm disabled:opacity-50"
              >
                Remove model override
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setOverrideOpen(false)
                  setError(null)
                }}
                className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="text-sm text-emerald-300">
              {message}
            </p>
          ) : null}
        </form>
        )}
      </div>
    </section>
  )
}
