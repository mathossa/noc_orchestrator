'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  FormField,
  TextArea,
  TextInput,
} from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import type { FirmwareWorkPlanState } from '@/lib/firmware-work-planning'
import {
  type ClientError,
  type PlanDetail,
  type PlanEvent,
  canConfirmProposedSchedule,
  dateTime,
  dateTimeLocalToIso,
  groupPlanTargets,
  labelValue,
  requestJson,
  toLocalDateTimeValue,
} from './planning-client'
import {
  PlanStatePill,
  PlanningError,
  PlanningSection,
  PlanningStatus,
  planStateLabel,
} from './planning-ui'

function proposalEventMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return null
  const record = metadata as Record<string, unknown>
  if (record.kind !== 'PROPOSED_MAINTENANCE_WINDOW_AMENDED') return null
  const before =
    record.before && typeof record.before === 'object'
      ? (record.before as Record<string, unknown>)
      : null
  const after =
    record.after && typeof record.after === 'object'
      ? (record.after as Record<string, unknown>)
      : null
  return { before, after }
}

function proposalValue(
  value: Record<string, unknown> | null,
  key: string,
) {
  const field = value?.[key]
  return typeof field === 'string' ? field : null
}

function eventTitle(event: PlanEvent) {
  if (proposalEventMetadata(event.metadata))
    return 'Proposed maintenance window amended'
  if (!event.fromState) return labelValue(event.toState)
  if (event.fromState === event.toState)
    return `${labelValue(event.toState)} updated`
  return `${labelValue(event.fromState)} → ${labelValue(event.toState)}`
}

export function FirmwarePlanDetail({ planId }: { planId: string }) {
  const [detail, setDetail] = useState<PlanDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [transitionReason, setTransitionReason] = useState('')
  const [transitionNotes, setTransitionNotes] = useState('')
  const [manualScheduledFor, setManualScheduledFor] = useState('')
  const [manualWindowReference, setManualWindowReference] = useState('')
  const [proposedFor, setProposedFor] = useState('')
  const [proposedReference, setProposedReference] = useState('')
  const [proposalReason, setProposalReason] = useState('')
  const [proposalNotes, setProposalNotes] = useState('')
  const [timeZone, setTimeZone] = useState('browser local time')

  useEffect(() => {
    setTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'browser local time',
    )
  }, [])

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await requestJson<{ data: PlanDetail }>(
        `/api/v1/firmware-work-plans/${encodeURIComponent(planId)}`,
      )
      setDetail(payload.data)
      setProposedFor(toLocalDateTimeValue(payload.data.proposedFor))
      setProposedReference(
        payload.data.proposedMaintenanceWindowReference ?? '',
      )
      setManualScheduledFor(
        payload.data.proposedFor
          ? toLocalDateTimeValue(payload.data.proposedFor)
          : '',
      )
      setManualWindowReference(
        payload.data.proposedMaintenanceWindowReference ?? '',
      )
      setTransitionReason('')
      setTransitionNotes('')
      setProposalReason('')
      setProposalNotes('')
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load maintenance plan.',
      )
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  const groups = useMemo(
    () => (detail ? groupPlanTargets(detail.targets) : []),
    [detail],
  )

  const proposalEditable =
    detail?.state === 'PROPOSED' ||
    detail?.state === 'AWAITING_CUSTOMER' ||
    detail?.state === 'APPROVED'

  async function amendProposal() {
    if (!detail || !proposalEditable) return
    if (!proposalReason.trim()) {
      setError(
        'Record a reason for the proposal amendment so the change is auditable.',
      )
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await requestJson(
        `/api/v1/firmware-work-plans/${encodeURIComponent(detail.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedState: detail.state,
            expectedUpdatedAt: new Date(detail.updatedAt).toISOString(),
            proposedFor: proposedFor
              ? dateTimeLocalToIso(proposedFor)
              : null,
            proposedMaintenanceWindowReference:
              proposedReference || null,
            reason: proposalReason,
            notes: proposalNotes || undefined,
          }),
        },
      )
      setMessage(
        'Proposed maintenance window amended. The change was appended to plan history.',
      )
      await loadDetail()
    } catch (amendError) {
      const typed = amendError as ClientError
      setError(
        typed.code === 'STALE_WRITE'
          ? 'This plan changed after it was displayed. Reload and review the latest proposal before amending it.'
          : amendError instanceof Error
            ? amendError.message
            : 'Could not amend the proposed maintenance window.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function transition(
    toState: FirmwareWorkPlanState,
    scheduleMode?: 'proposal' | 'manual',
  ) {
    if (!detail) return
    if (toState === 'DONE') {
      if (
        !window.confirm(
          'Mark this work plan done? This records workflow completion only and does not verify observed firmware.',
        )
      )
        return
    }
    if (toState === 'CANCELLED') {
      if (
        !window.confirm(
          'Cancel this work plan? Prior snapshots and history remain auditable.',
        )
      )
        return
    }
    if (
      toState === 'SCHEDULED' &&
      scheduleMode === 'manual' &&
      !manualScheduledFor
    ) {
      setError('Choose an explicit schedule date and time.')
      return
    }

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const body: Record<string, unknown> = {
        expectedState: detail.state,
        expectedUpdatedAt: new Date(detail.updatedAt).toISOString(),
        toState,
        reason: transitionReason || undefined,
        notes: transitionNotes || undefined,
      }
      if (toState === 'SCHEDULED' && scheduleMode === 'manual') {
        body.scheduledFor = dateTimeLocalToIso(manualScheduledFor)
        body.maintenanceWindowReference =
          manualWindowReference || undefined
      }
      await requestJson(
        `/api/v1/firmware-work-plans/${encodeURIComponent(detail.id)}/transitions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      setMessage(
        toState === 'SCHEDULED' && scheduleMode === 'proposal'
          ? 'Customer-approved proposal confirmed as the schedule.'
          : toState === 'IN_PROGRESS'
            ? 'Work marked in progress. No device execution was started by NOC Orchestrator.'
            : toState === 'DONE'
              ? 'Workflow completion recorded. Observed firmware remains independent.'
              : `Plan moved to ${planStateLabel[toState].toLowerCase()}.`,
      )
      await loadDetail()
    } catch (transitionError) {
      const typed = transitionError as ClientError
      setError(
        typed.code === 'STALE_WRITE'
          ? 'This plan changed after it was displayed. Refresh and review the latest state before applying an action.'
          : transitionError instanceof Error
            ? transitionError.message
            : 'Workflow transition failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading && !detail)
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Firmware planning"
          title="Maintenance plan"
          description="Loading persistent plan workspace…"
        />
        <p className="text-sm text-[var(--muted)]">Loading plan…</p>
      </div>
    )

  if (!detail)
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Firmware planning"
          title="Maintenance plan"
          description="The requested plan could not be loaded."
          actions={
            <Link
              href="/planning"
              className="rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold"
            >
              Back to plans
            </Link>
          }
        />
        <PlanningError message={error || 'Maintenance plan not found.'} />
      </div>
    )

  const terminal = detail.state === 'DONE' || detail.state === 'CANCELLED'
  const customerNames = detail.customers
    .map((customer) => customer.name)
    .join(', ')
  const siteNames = detail.sites
    .map((site) => site.name ?? 'No site')
    .join(', ')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firmware planning"
        title={detail.title || 'Untitled firmware maintenance'}
        description="Persistent maintenance workspace for exact saved targets, customer approval, scheduling, execution state and append-only history."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void loadDetail()} disabled={loading}>
              Refresh
            </Button>
            <Link
              href="/planning"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
            >
              Back to plans
            </Link>
          </div>
        }
      />

      <PlanningError message={error} />
      <PlanningStatus message={message} />

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <PlanStatePill state={detail.state} stale={detail.stale} />
              {terminal ? (
                <span className="text-xs text-[var(--muted)]">
                  Read-only historical work
                </span>
              ) : null}
            </div>
            <div className="mt-3 text-sm">
              <span className="font-semibold">{customerNames || '—'}</span>
              <span className="text-[var(--muted)]">
                {' '}
                · {siteNames || 'No site snapshot'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold">{detail.targetCount}</div>
            <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              exact target{detail.targetCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
              Proposed window
            </div>
            <div className="mt-1 text-sm">{dateTime(detail.proposedFor)}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {detail.proposedMaintenanceWindowReference ??
                'No proposal reference'}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
              Confirmed schedule
            </div>
            <div className="mt-1 text-sm">{dateTime(detail.scheduledFor)}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {detail.maintenanceWindowReference ??
                'Not confirmed / no reference'}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
              Upgrade capability
            </div>
            <div className="mt-1 text-sm">
              {labelValue(detail.upgradeCapability)}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
              Last change
            </div>
            <div className="mt-1 text-sm">{dateTime(detail.updatedAt)}</div>
          </div>
        </div>
      </section>

      {detail.stale ? (
        <div className="rounded-lg border border-[#9a6234] bg-[#342218] p-4 text-[#ffd0a0]">
          <h2 className="font-semibold">
            Review attention required before execution
          </h2>
          <p className="mt-1 text-sm">
            Current inventory or policy context drifted from the immutable
            target snapshot. The plan has not been silently retargeted.
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {Object.entries(detail.staleReasonCounts).map(
              ([reason, count]) => (
                <li key={reason}>
                  {labelValue(reason)}: {count} target
                  {count === 1 ? '' : 's'}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      <PlanningSection
        title="Scope & firmware"
        description="Grouped immutable target snapshots. Device type is not reconstructed historically; customer, site, model and exact current → target evidence come from the saved plan."
      >
        <div className="space-y-3">
          {groups.map((group) => (
            <div
              key={JSON.stringify([
                group.customerId,
                group.siteId,
                group.modelName,
                group.observedVersion,
                group.targetVersion,
                group.targetVariant,
                group.targetImageCode,
              ])}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {group.customerName} · {group.siteName}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {group.modelName}
                  </div>
                </div>
                <div className="text-sm font-semibold">
                  {group.count} device{group.count === 1 ? '' : 's'}
                </div>
              </div>
              <div className="mt-3 font-mono text-sm">
                {group.observedVersion} → {group.targetVersion}
                <span className="font-sans text-xs text-[var(--muted)]">
                  {' '}
                  · {group.targetPlatform}
                  {group.targetVariant ? ` · ${group.targetVariant}` : ''}
                  {group.targetImageCode
                    ? ` · ${group.targetImageCode}`
                    : ''}
                </span>
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-semibold text-[var(--accent-light)]">
                  Review devices
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[800px] text-left">
                    <thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                      <tr>
                        <th className="px-2 py-2">Device</th>
                        <th className="px-2 py-2">Recommendation</th>
                        <th className="px-2 py-2">Exception evidence</th>
                        <th className="px-2 py-2">Current attention</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {group.targets.map((target) => (
                        <tr key={target.snapshot.id}>
                          <td className="px-2 py-2">
                            <Link
                              href={`/devices/${target.snapshot.deviceId}`}
                              className="font-semibold text-[var(--accent-light)] hover:underline"
                            >
                              {target.snapshot.deviceName}
                            </Link>
                          </td>
                          <td className="px-2 py-2">
                            {labelValue(target.snapshot.recommendation)}
                          </td>
                          <td className="px-2 py-2">
                            {target.snapshot.exceptionOverride
                              ? 'Explicit override recorded'
                              : target.snapshot.exceptionSnapshot
                                ? 'Exception snapshot retained'
                                : 'None'}
                          </td>
                          <td className="px-2 py-2">
                            {target.staleness.stale
                              ? target.staleness.reasons
                                  .map(labelValue)
                                  .join(', ')
                              : 'No stale reasons'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ))}
        </div>
      </PlanningSection>

      {proposalEditable ? (
        <PlanningSection
          title="Customer proposal"
          description="Amend the proposal before scheduling when the customer requests a different date or maintenance-window reference. The amendment is appended to history."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <FormField
              label="Proposed maintenance date/time"
              htmlFor="detail-proposed-for"
              description={timeZone}
            >
              <TextInput
                id="detail-proposed-for"
                type="datetime-local"
                value={proposedFor}
                onChange={(event) => setProposedFor(event.target.value)}
              />
            </FormField>
            <FormField
              label="Proposed window reference"
              htmlFor="detail-proposed-reference"
            >
              <TextInput
                id="detail-proposed-reference"
                value={proposedReference}
                onChange={(event) =>
                  setProposedReference(event.target.value)
                }
              />
            </FormField>
            <FormField
              label="Amendment reason"
              htmlFor="detail-proposal-reason"
              description="Required by this workspace for clear audit evidence."
            >
              <TextInput
                id="detail-proposal-reason"
                value={proposalReason}
                onChange={(event) => setProposalReason(event.target.value)}
              />
            </FormField>
            <FormField
              label="Amendment notes"
              htmlFor="detail-proposal-notes"
            >
              <TextArea
                id="detail-proposal-notes"
                rows={2}
                value={proposalNotes}
                onChange={(event) => setProposalNotes(event.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-3">
            <Button
              onClick={() => void amendProposal()}
              disabled={busy}
            >
              Save proposal amendment
            </Button>
          </div>
        </PlanningSection>
      ) : null}

      <PlanningSection
        title="Customer & scheduling"
        description="The proposed window is customer-facing intent. The confirmed schedule remains separate until approval/scheduling succeeds."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              Proposed
            </div>
            <div className="mt-2 text-sm">{dateTime(detail.proposedFor)}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {detail.proposedMaintenanceWindowReference ??
                'No proposal reference'}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              Scheduled
            </div>
            <div className="mt-2 text-sm">{dateTime(detail.scheduledFor)}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {detail.maintenanceWindowReference ??
                'No confirmed schedule reference'}
            </div>
          </div>
        </div>
      </PlanningSection>

      <PlanningSection
        title="Workflow"
        description={
          terminal
            ? 'Completed and cancelled plans are historical and no longer editable.'
            : 'Workflow changes planning state only. It does not contact devices or install firmware.'
        }
      >
        {terminal ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm text-[var(--muted)]">
            {planStateLabel[detail.state]} is terminal. The exact target
            snapshots and event history remain available above and below.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Reason" htmlFor="workflow-reason">
                <TextInput
                  id="workflow-reason"
                  value={transitionReason}
                  onChange={(event) =>
                    setTransitionReason(event.target.value)
                  }
                />
              </FormField>
              <FormField label="Notes" htmlFor="workflow-notes">
                <TextInput
                  id="workflow-notes"
                  value={transitionNotes}
                  onChange={(event) =>
                    setTransitionNotes(event.target.value)
                  }
                />
              </FormField>
            </div>

            {detail.state === 'APPROVED' && !detail.proposedFor ? (
              <div className="grid gap-3 md:grid-cols-2">
                <FormField
                  label="Schedule date/time"
                  htmlFor="manual-scheduled-for"
                  description={timeZone}
                >
                  <TextInput
                    id="manual-scheduled-for"
                    type="datetime-local"
                    value={manualScheduledFor}
                    onChange={(event) =>
                      setManualScheduledFor(event.target.value)
                    }
                  />
                </FormField>
                <FormField
                  label="Maintenance-window reference"
                  htmlFor="manual-window-reference"
                >
                  <TextInput
                    id="manual-window-reference"
                    value={manualWindowReference}
                    onChange={(event) =>
                      setManualWindowReference(event.target.value)
                    }
                  />
                </FormField>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {detail.state === 'PROPOSED' ? (
                <>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void transition('AWAITING_CUSTOMER')
                    }
                  >
                    Request customer approval
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void transition('APPROVED')}
                  >
                    Record approval without final schedule
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void transition('CANCELLED')}
                  >
                    Cancel plan
                  </Button>
                </>
              ) : null}

              {detail.state === 'AWAITING_CUSTOMER' ? (
                <>
                  {canConfirmProposedSchedule(
                    detail.state,
                    detail.proposedFor,
                  ) ? (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void transition('SCHEDULED', 'proposal')
                      }
                    >
                      Customer approved proposed window
                    </Button>
                  ) : null}
                  <Button
                    disabled={busy}
                    onClick={() => void transition('APPROVED')}
                  >
                    Approval only
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void transition('PROPOSED')}
                  >
                    Return to proposed
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void transition('CANCELLED')}
                  >
                    Cancel plan
                  </Button>
                </>
              ) : null}

              {detail.state === 'APPROVED' ? (
                <>
                  {canConfirmProposedSchedule(
                    detail.state,
                    detail.proposedFor,
                  ) ? (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void transition('SCHEDULED', 'proposal')
                      }
                    >
                      Schedule proposed window
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void transition('SCHEDULED', 'manual')
                      }
                    >
                      Schedule
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    onClick={() => void transition('PROPOSED')}
                  >
                    Return to proposed
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void transition('CANCELLED')}
                  >
                    Cancel plan
                  </Button>
                </>
              ) : null}

              {detail.state === 'SCHEDULED' ? (
                <>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void transition('IN_PROGRESS')}
                  >
                    Start work
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void transition('APPROVED')}
                  >
                    Return to approved
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void transition('CANCELLED')}
                  >
                    Cancel plan
                  </Button>
                </>
              ) : null}

              {detail.state === 'IN_PROGRESS' ? (
                <>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void transition('DONE')}
                  >
                    Complete work
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void transition('CANCELLED')}
                  >
                    Cancel plan
                  </Button>
                </>
              ) : null}
            </div>

            {detail.state === 'AWAITING_CUSTOMER' &&
            !canConfirmProposedSchedule(
              detail.state,
              detail.proposedFor,
            ) ? (
              <p className="text-xs text-[#f0b574]">
                Direct customer-approved → scheduled is unavailable until a
                proposed maintenance date is stored. Amend the proposal above
                first.
              </p>
            ) : null}
          </div>
        )}
      </PlanningSection>

      <PlanningSection
        title="History"
        description="Append-only plan events, including proposal amendments and state transitions."
      >
        {!detail.events.length ? (
          <p className="text-sm text-[var(--muted)]">
            No planning events recorded.
          </p>
        ) : (
          <ol className="space-y-2">
            {detail.events.map((event) => {
              const proposal = proposalEventMetadata(event.metadata)
              return (
                <li
                  key={event.id}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"
                >
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-semibold">{eventTitle(event)}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {dateTime(event.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Actor:{' '}
                    {event.actorUserId ??
                      'Historical/authenticated actor unavailable'}
                  </div>
                  {proposal ? (
                    <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                      <div className="rounded border border-[var(--border)] p-2">
                        <div className="font-semibold">Before</div>
                        <div className="mt-1">
                          {dateTime(
                            proposalValue(proposal.before, 'proposedFor'),
                          )}
                        </div>
                        <div className="text-[var(--muted)]">
                          {proposalValue(
                            proposal.before,
                            'proposedMaintenanceWindowReference',
                          ) ?? 'No reference'}
                        </div>
                      </div>
                      <div className="rounded border border-[var(--border)] p-2">
                        <div className="font-semibold">After</div>
                        <div className="mt-1">
                          {dateTime(
                            proposalValue(proposal.after, 'proposedFor'),
                          )}
                        </div>
                        <div className="text-[var(--muted)]">
                          {proposalValue(
                            proposal.after,
                            'proposedMaintenanceWindowReference',
                          ) ?? 'No reference'}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {event.reason ? (
                    <p className="mt-2 text-sm">{event.reason}</p>
                  ) : null}
                  {event.notes ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted-strong)]">
                      {event.notes}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
      </PlanningSection>

    </div>
  )
}
