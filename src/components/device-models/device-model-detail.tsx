'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ErrorState, LoadingState } from '@/components/ui/page-state'
import { PageHeader } from '@/components/ui/page-header'
import { SummaryStat } from '@/components/ui/summary-stat'
import type { DeviceModelDetailRecord } from '@/lib/device-models'

type ApiError = { error?: { message?: string } }

export function DeviceModelDetail({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<DeviceModelDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void fetch(`/api/v1/models/${modelId}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: DeviceModelDetailRecord } & ApiError
        if (!response.ok) throw new Error(payload.error?.message ?? 'Device model could not be loaded.')
        if (!cancelled) setModel(payload.data ?? null)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Device model could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [modelId])

  if (loading) return <LoadingState title="Loading device model" description="Reading firmware lifecycle context…" />
  if (error || !model) {
    return (
      <ErrorState
        title="Device model could not be loaded"
        description={error ?? 'The model record is unavailable.'}
        action={
          <Link
            href="/models"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Back to models
          </Link>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={`${model.vendor.name} · ${model.deviceType.name}`}
        title={model.model}
        description="Model-level firmware lifecycle context: inventory usage, current firmware distribution, workflow decisions, and future desired firmware policy."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/models"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
            >
              Manage models
            </Link>
            <Link
              href={`/devices?model=${encodeURIComponent(model.id)}`}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              Devices using model
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Devices" value={model.deviceCount} detail="Inventory records using this model." />
        <SummaryStat label="Customers" value={model.customers.length} detail="Customers with at least one device using this model." />
        <SummaryStat label="Desired firmware" value="—" detail="Model desired-state policy is implemented in Issue #9." />
        <SummaryStat label="Planned" value={model.workflowCounts.planned} detail="Devices with a planned lifecycle decision." />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading
              title="Firmware lifecycle"
              description="Current inventory observations are shown now; desired and available firmware remain owned by their dedicated issues."
            />
            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
              <PlaceholderBlock label="Desired firmware" value="Not configured yet" detail="Issue #9 will provide model-level desired firmware policy." />
              <PlaceholderBlock label="Available releases" value="Catalog pending" detail="Issue #7 will provide compatible firmware catalog presentation." />
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading
              title="Current firmware distribution"
              description="Recorded current firmware across devices using this model. This is inventory state, not live network polling."
            />
            {model.firmwareDistribution.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">No devices currently use this model.</div>
            ) : (
              <div className="noc-scrollbar overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <caption className="sr-only">Current firmware distribution</caption>
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Version</th>
                      <th className="px-4 py-3 font-semibold">Platform</th>
                      <th className="px-4 py-3 text-right font-semibold">Devices</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {model.firmwareDistribution.map((firmware) => (
                      <tr key={firmware.firmwareReleaseId ?? 'unrecorded'}>
                        <td className="px-4 py-3 font-medium text-[var(--foreground)]">{firmware.version}</td>
                        <td className="px-4 py-3 text-[var(--muted-strong)]">{firmware.platform ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-strong)]">{firmware.deviceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Workflow distribution" description="Lifecycle decisions remain separate from technical firmware compliance." />
            <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Planned', model.workflowCounts.planned],
                ['Ignored', model.workflowCounts.ignored],
                ['Customer declined', model.workflowCounts.customerDeclined],
                ['Done', model.workflowCounts.done],
                ['No decision', model.workflowCounts.undecided],
              ].map(([label, value]) => (
                <div key={label} className="bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <SectionHeading title="Customers using this model" description="Derived from device inventory assignments." />
            {model.customers.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">No customer devices use this model yet.</div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {model.customers.map((customer) => (
                  <div key={customer.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <Link href={`/customers/${customer.id}`} className="font-medium text-[var(--foreground)] hover:text-[var(--accent-light)]">
                      {customer.name}
                    </Link>
                    <span className="text-sm tabular-nums text-[var(--muted)]">{customer.deviceCount} device{customer.deviceCount === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Model information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <DetailRow label="Vendor" value={model.vendor.name} />
            <DetailRow label="Device type" value={model.deviceType.name} />
            <DetailRow label="Platform" value={model.platform ?? '—'} />
            <DetailRow label="Status" value={model.isActive ? 'Active' : 'Archived'} />
            <DetailRow label="Source" value={model.source} />
            <DetailRow label="External provider" value={model.externalProvider ?? '—'} />
            <DetailRow label="External ID" value={model.externalId ?? '—'} />
            <DetailRow label="Last synchronized" value={model.lastSynchronizedAt ? new Date(model.lastSynchronizedAt).toLocaleString() : 'Never / manual'} />
          </dl>
          {model.notes ? (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Notes</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-strong)]">{model.notes}</p>
            </div>
          ) : null}
        </section>
      </div>
    </>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-[var(--border)] px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
    </div>
  )
}

function PlaceholderBlock({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-[var(--surface)] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-base font-semibold text-[var(--foreground)]">{value}</div>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--muted-strong)]">{value}</dd>
    </div>
  )
}
