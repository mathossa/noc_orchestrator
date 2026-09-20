'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FIRMWARE_UPGRADE_CAPABILITIES,
  FIRMWARE_WORK_PLAN_STATES,
  canTransitionFirmwareWorkPlan,
  isActiveFirmwareWorkPlanState,
  type FirmwareWorkPlanState,
} from '@/lib/firmware-work-planning'
import { Button } from '@/components/ui/button'
import {
  FormField,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'

type PlanningView = 'active' | 'history'

type PlanSummary = {
  id: string
  state: FirmwareWorkPlanState
  title: string | null
  reason: string | null
  notes: string | null
  upgradeCapability: string
  createdAt: string
  updatedAt: string
  scheduledFor: string | null
  maintenanceWindowReference: string | null
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  targetCount: number
  stale: boolean
  staleReasonCounts: Record<string, number>
  customers: Array<{ id: string; name: string; targetCount: number }>
  sites: Array<{
    id: string | null
    name: string | null
    customerId: string
    targetCount: number
  }>
  targetDistribution: Array<{
    firmwareReleaseId: string
    version: string
    logicalVersion: string
    platform: string
    variant: string | null
    imageCode: string | null
    count: number
  }>
}

type PlanTarget = {
  snapshot: {
    id: string
    deviceId: string
    deviceName: string
    customerId: string
    customerName: string
    siteId: string | null
    siteName: string | null
    deviceModelId: string
    deviceModelName: string
    observedFirmwareVersion: string | null
    observedFirmwareRawVersion: string | null
    observedAt: string | null
    policyScope: string | null
    policyTrackName: string | null
    recommendation: string
    preferredTargetVersion: string | null
    targetFirmwareReleaseId: string
    targetVersion: string
    targetLogicalVersion: string
    targetPlatform: string
    targetVariant: string | null
    targetImageCode: string | null
    compatibilityStatus: string | null
    exceptionOverride: boolean
    exceptionSnapshot: Record<string, unknown> | null
    upgradeCapability: string
  }
  staleness: { stale: boolean; reasons: string[] }
  activeException: { id: string; reasonCode?: string } | null
}

type PlanEvent = {
  id: string
  fromState: string | null
  toState: string
  actorUserId: string | null
  reason: string | null
  notes: string | null
  createdAt: string
  metadata: unknown
}

type PlanDetail = PlanSummary & {
  events: PlanEvent[]
  targets: PlanTarget[]
}

type PlanListResponse = {
  data: PlanSummary[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type DeviceChoice = {
  id: string
  name: string
  customerId: string
  customer: { id: string; name: string }
  site: { id: string; name: string } | null
  deviceModelId: string
  deviceModel: {
    id: string
    model: string
    vendor: { id: string; name: string }
  }
  firmwareCompliance: { recommendation: string; explanation?: string }
  currentFirmwareRelease: { id: string; version: string } | null
  currentFirmwareNormalizedVersion: string | null
  currentFirmwareRawVersion: string | null
}

type DeviceReferences = {
  customers: Array<{ id: string; name: string; isActive: boolean }>
  sites: Array<{
    id: string
    name: string
    customerId: string
    isActive: boolean
  }>
  models: Array<{
    id: string
    model: string
    vendor: { id: string; name: string }
    isActive: boolean
  }>
  vendors: Array<{ id: string; name: string; isActive: boolean }>
}

type DevicePayload = {
  data: DeviceChoice[]
  meta: DeviceReferences & {
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
}

type PreviewTarget = {
  deviceId: string
  deviceName: string
  customerName: string
  siteName: string | null
  deviceModelName: string
  disposition:
    | 'INCLUDED'
    | 'INACTIVE_DEVICE'
    | 'ALREADY_PLANNED'
    | 'ACTIVE_EXCEPTION'
    | 'NO_ACTION'
    | 'REVIEW_REQUIRED'
  detail: string
  activePlanId: string | null
  effectiveExceptionId: string | null
  effectiveExceptionReason: string | null
  exceptionOverride: boolean
  recommendation: string
  observedFirmwareVersion: string | null
  targetFirmwareReleaseId: string | null
  targetVersion: string | null
  targetPlatform: string | null
  targetVariant: string | null
  targetImageCode: string | null
}

type PlanPreview = {
  input: unknown
  token: string
  counts: {
    requested: number
    included: number
    inactive: number
    alreadyPlanned: number
    activeException: number
    noAction: number
    reviewRequired: number
    exceptionOverrides: number
  }
  targetDistribution: Array<{
    firmwareReleaseId: string
    platform: string
    version: string
    imageCode: string | null
    count: number
  }>
  targets: PreviewTarget[]
}

type ClientError = Error & { status?: number; code?: string }

const ACTIVE_STATES = FIRMWARE_WORK_PLAN_STATES.filter(
  isActiveFirmwareWorkPlanState,
)
const HISTORY_STATES = FIRMWARE_WORK_PLAN_STATES.filter(
  (state) => !isActiveFirmwareWorkPlanState(state),
)

const stateLabel: Record<FirmwareWorkPlanState, string> = {
  PROPOSED: 'Proposed',
  AWAITING_CUSTOMER: 'Awaiting customer',
  APPROVED: 'Approved',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}

const dispositionLabel: Record<PreviewTarget['disposition'], string> = {
  INCLUDED: 'Included',
  INACTIVE_DEVICE: 'Inactive',
  ALREADY_PLANNED: 'Already planned',
  ACTIVE_EXCEPTION: 'Active exception',
  NO_ACTION: 'No action',
  REVIEW_REQUIRED: 'Review required',
}

const actionLabel: Record<FirmwareWorkPlanState, string> = {
  PROPOSED: 'Return to proposed',
  AWAITING_CUSTOMER: 'Wait for customer',
  APPROVED: 'Approve',
  SCHEDULED: 'Schedule',
  IN_PROGRESS: 'Start work',
  DONE: 'Complete work',
  CANCELLED: 'Cancel plan',
}

function label(value: string) {
  return value.toLowerCase().replaceAll('_', ' ')
}

function dateTime(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value
}

function dateTimeLocalToIso(value: string) {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('Choose a valid local date and time.')
  return parsed.toISOString()
}

function toLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json()
  if (!response.ok) {
    const error = new Error(
      payload.error?.message ?? 'The request could not be completed.',
    ) as ClientError
    error.status = response.status
    error.code = payload.error?.code
    throw error
  }
  return payload as T
}

function StatePill({
  state,
  stale = false,
}: {
  state: FirmwareWorkPlanState
  stale?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-1 text-xs font-semibold">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-[#f0a75a]' : 'bg-[var(--accent)]'}`}
      />
      {stateLabel[state]}
      {stale ? ' · stale' : ''}
    </span>
  )
}

function MissingServerFiltersNotice() {
  return (
    <div className="rounded-md border border-[#7a6234] bg-[#2a2418] px-3 py-2 text-xs leading-5 text-[#f2d28c]">
      Vendor and model-family filtering are intentionally not applied on this
      list yet. The planning query store has no server-side capability for
      those filters, so filtering one client page would be misleading.
    </div>
  )
}

export function FirmwarePlanningWorkspace({
  initialView = 'active',
}: {
  initialView?: PlanningView
}) {
  const view: PlanningView =
    initialView === 'history' ? 'history' : 'active'

  const [plans, setPlans] = useState<PlanListResponse | null>(null)
  const [planPage, setPlanPage] = useState(1)
  const [planLoading, setPlanLoading] = useState(true)
  const [planError, setPlanError] = useState('')
  const [message, setMessage] = useState('')
  const [filters, setFilters] = useState({
    customerId: '',
    siteId: '',
    deviceModelId: '',
    state: '',
    recommendation: '',
    scheduledFrom: '',
    scheduledUntil: '',
  })

  const [references, setReferences] = useState<DeviceReferences | null>(null)
  const [deviceRows, setDeviceRows] = useState<DevicePayload | null>(null)
  const [deviceLoading, setDeviceLoading] = useState(true)
  const [devicePage, setDevicePage] = useState(1)
  const [deviceFilters, setDeviceFilters] = useState({
    q: '',
    customer: '',
    site: '',
    vendor: '',
    model: '',
  })
  const [selectedDevices, setSelectedDevices] = useState<
    Record<string, DeviceChoice>
  >({})

  const [creation, setCreation] = useState({
    title: '',
    reason: '',
    notes: '',
    upgradeCapability: 'UNKNOWN',
  })
  const [overrideIds, setOverrideIds] = useState<string[]>([])
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [previewDirty, setPreviewDirty] = useState(false)
  const [creationBusy, setCreationBusy] = useState(false)
  const [creationError, setCreationError] = useState('')

  const [detail, setDetail] = useState<PlanDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [transitionBusy, setTransitionBusy] = useState(false)
  const [transitionReason, setTransitionReason] = useState('')
  const [transitionNotes, setTransitionNotes] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [maintenanceWindowReference, setMaintenanceWindowReference] =
    useState('')
  const [timeZone, setTimeZone] = useState('browser local time')

  useEffect(() => {
    setTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'browser local time',
    )
  }, [])

  const loadPlans = useCallback(
    async (page = planPage) => {
      setPlanLoading(true)
      setPlanError('')
      try {
        const params = new URLSearchParams()
        const allowedStates = view === 'active' ? ACTIVE_STATES : HISTORY_STATES
        const selectedState = filters.state as FirmwareWorkPlanState
        params.set(
          'state',
          selectedState && allowedStates.includes(selectedState)
            ? selectedState
            : allowedStates.join(','),
        )
        if (filters.customerId)
          params.set('customerId', filters.customerId)
        if (filters.siteId) params.set('siteId', filters.siteId)
        if (filters.deviceModelId)
          params.set('deviceModelId', filters.deviceModelId)
        if (filters.recommendation)
          params.set('recommendation', filters.recommendation)
        if (filters.scheduledFrom)
          params.set(
            'scheduledFrom',
            dateTimeLocalToIso(filters.scheduledFrom),
          )
        if (filters.scheduledUntil)
          params.set(
            'scheduledUntil',
            dateTimeLocalToIso(filters.scheduledUntil),
          )
        params.set('page', String(page))
        params.set('pageSize', '25')
        const payload = await requestJson<PlanListResponse>(
          `/api/v1/firmware-work-plans?${params}`,
        )
        setPlans(payload)
        setPlanPage(payload.pagination.page)
      } catch (error) {
        setPlanError(
          error instanceof Error ? error.message : 'Could not load plans.',
        )
      } finally {
        setPlanLoading(false)
      }
    },
    [filters, planPage, view],
  )

  useEffect(() => {
    void loadPlans(1)
    // Filters are deliberately applied explicitly with the Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const loadDevices = useCallback(
    async (page = devicePage) => {
      setDeviceLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '25',
          sort: 'customer',
          direction: 'asc',
        })
        for (const [key, value] of Object.entries(deviceFilters))
          if (value) params.set(key, value)
        const payload = await requestJson<DevicePayload>(
          `/api/v1/devices?${params}`,
        )
        setDeviceRows(payload)
        setReferences({
          customers: payload.meta.customers,
          sites: payload.meta.sites,
          models: payload.meta.models,
          vendors: payload.meta.vendors,
        })
        setDevicePage(payload.meta.pagination.page)
      } catch (error) {
        setCreationError(
          error instanceof Error ? error.message : 'Could not load devices.',
        )
      } finally {
        setDeviceLoading(false)
      }
    },
    [deviceFilters, devicePage],
  )

  useEffect(() => {
    void loadDevices(1)
    // Filter changes should update the device chooser immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deviceFilters.q,
    deviceFilters.customer,
    deviceFilters.site,
    deviceFilters.vendor,
    deviceFilters.model,
  ])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError('')
    try {
      const payload = await requestJson<{ data: PlanDetail }>(
        `/api/v1/firmware-work-plans/${encodeURIComponent(id)}`,
      )
      setDetail(payload.data)
      setScheduledFor(toLocalDateTimeValue(payload.data.scheduledFor))
      setMaintenanceWindowReference(
        payload.data.maintenanceWindowReference ?? '',
      )
      setTransitionReason('')
      setTransitionNotes('')
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : 'Could not load plan.',
      )
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const planSites = useMemo(
    () =>
      (references?.sites ?? []).filter(
        (site) => !filters.customerId || site.customerId === filters.customerId,
      ),
    [filters.customerId, references],
  )

  const creationSites = useMemo(
    () =>
      (references?.sites ?? []).filter(
        (site) =>
          !deviceFilters.customer ||
          site.customerId === deviceFilters.customer,
      ),
    [deviceFilters.customer, references],
  )

  const creationModels = useMemo(
    () =>
      (references?.models ?? []).filter(
        (model) =>
          !deviceFilters.vendor ||
          model.vendor.id === deviceFilters.vendor,
      ),
    [deviceFilters.vendor, references],
  )

  const selectedIds = Object.keys(selectedDevices)

  function invalidatePreview() {
    if (preview) setPreviewDirty(true)
  }

  function updateCreation<K extends keyof typeof creation>(
    key: K,
    value: (typeof creation)[K],
  ) {
    setCreation((current) => ({ ...current, [key]: value }))
    invalidatePreview()
  }

  function toggleDevice(device: DeviceChoice) {
    setSelectedDevices((current) => {
      const next = { ...current }
      if (next[device.id]) {
        delete next[device.id]
        setOverrideIds((ids) => ids.filter((id) => id !== device.id))
      } else next[device.id] = device
      return next
    })
    invalidatePreview()
  }

  function planningInput() {
    return {
      deviceIds: selectedIds,
      title: creation.title || null,
      reason: creation.reason || null,
      notes: creation.notes || null,
      exceptionOverrideDeviceIds: overrideIds,
      upgradeCapability: creation.upgradeCapability,
    }
  }

  async function runPreview() {
    if (!selectedIds.length) {
      setCreationError('Select at least one device.')
      return
    }
    setCreationBusy(true)
    setCreationError('')
    setMessage('')
    try {
      const payload = await requestJson<{ data: PlanPreview }>(
        '/api/v1/firmware-work-plans',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'preview',
            input: planningInput(),
          }),
        },
      )
      setPreview(payload.data)
      setPreviewDirty(false)
    } catch (error) {
      setCreationError(
        error instanceof Error ? error.message : 'Preview failed.',
      )
    } finally {
      setCreationBusy(false)
    }
  }

  async function createPlan() {
    if (!preview || previewDirty) {
      setCreationError('Run and review a fresh server preview first.')
      return
    }
    setCreationBusy(true)
    setCreationError('')
    try {
      const payload = await requestJson<{ data: { id: string } }>(
        '/api/v1/firmware-work-plans',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            input: planningInput(),
            token: preview.token,
          }),
        },
      )
      setMessage(
        'Work plan created. This records planning intent only; no device was contacted.',
      )
      setPreview(null)
      setPreviewDirty(false)
      setSelectedDevices({})
      setOverrideIds([])
      await loadPlans(1)
      await loadDetail(payload.data.id)
    } catch (error) {
      const typed = error as ClientError
      if (typed.code === 'STALE_PREVIEW') {
        setPreview(null)
        setPreviewDirty(false)
        setCreationError(
          'The preview is stale. Run a new preview and review the changed inclusion, exceptions, and exact targets before creating the plan.',
        )
      } else
        setCreationError(
          error instanceof Error ? error.message : 'Plan creation failed.',
        )
    } finally {
      setCreationBusy(false)
    }
  }

  async function transition(toState: FirmwareWorkPlanState) {
    if (!detail) return
    if (toState === 'SCHEDULED' && !scheduledFor) {
      setDetailError('Choose an explicit schedule date and time.')
      return
    }
    if (
      toState === 'DONE' &&
      !window.confirm(
        'Mark this work plan done? This records workflow completion only. It does not verify that firmware was installed, that a device was contacted, or that observed firmware changed.',
      )
    )
      return
    if (
      toState === 'CANCELLED' &&
      !window.confirm(
        'Cancel this work plan? The cancellation and prior transition history will remain auditable.',
      )
    )
      return

    setTransitionBusy(true)
    setDetailError('')
    setMessage('')
    try {
      const body: Record<string, unknown> = {
        expectedState: detail.state,
        expectedUpdatedAt: new Date(detail.updatedAt).toISOString(),
        toState,
        reason: transitionReason || undefined,
        notes: transitionNotes || undefined,
      }
      if (toState === 'SCHEDULED') {
        body.scheduledFor = dateTimeLocalToIso(scheduledFor)
        body.maintenanceWindowReference =
          maintenanceWindowReference || undefined
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
        toState === 'IN_PROGRESS'
          ? 'Work marked in progress. No device execution was started by NOC Orchestrator.'
          : toState === 'DONE'
            ? 'Workflow completion recorded. Observed firmware remains independent.'
            : `Plan moved to ${stateLabel[toState].toLowerCase()}.`,
      )
      await Promise.all([loadPlans(planPage), loadDetail(detail.id)])
    } catch (error) {
      const typed = error as ClientError
      if (typed.code === 'STALE_WRITE')
        setDetailError(
          'This plan changed since it was displayed. Refresh the plan and review the new state before choosing an action. Your action was not retried.',
        )
      else
        setDetailError(
          error instanceof Error ? error.message : 'Transition failed.',
        )
    } finally {
      setTransitionBusy(false)
    }
  }

  const allowedTransitions = detail
    ? FIRMWARE_WORK_PLAN_STATES.filter((candidate) =>
        canTransitionFirmwareWorkPlan(detail.state, candidate),
      )
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firmware"
        title="Planning"
        description="Turn current firmware recommendations into explicit, auditable work without changing technical compliance, accepted exceptions, or observed firmware."
        actions={
          <div className="flex gap-2">
            <Link
              href="/firmware/exceptions"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
            >
              Exceptions
            </Link>
            <Link
              href="/devices"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
            >
              Devices
            </Link>
          </div>
        }
      />

      {message ? (
        <div
          role="status"
          className="rounded-md border border-[#285f48] bg-[#142b22] px-4 py-3 text-sm text-[#a9e8c6]"
        >
          {message}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        <Link
          href="/planning"
          aria-current={view === 'active' ? 'page' : undefined}
          className={`rounded-md border px-3 py-2 text-sm font-semibold ${
            view === 'active'
              ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
              : 'border-[var(--border-strong)] bg-[var(--surface-raised)]'
          }`}
        >
          Active work
        </Link>
        <Link
          href="/planning?view=history"
          aria-current={view === 'history' ? 'page' : undefined}
          className={`rounded-md border px-3 py-2 text-sm font-semibold ${
            view === 'history'
              ? 'border-[var(--accent-muted)] bg-[var(--accent-soft)] text-[var(--accent-light)]'
              : 'border-[var(--border-strong)] bg-[var(--surface-raised)]'
          }`}
        >
          Completed / cancelled history
        </Link>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <h2 className="font-semibold">
            {view === 'active' ? 'Active plans' : 'Historical plans'}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Filters below are sent to the planning query store before
            pagination. Historical DONE/CANCELLED records keep their snapshots
            and are not re-evaluated against today&apos;s catalog.
          </p>
        </div>

        <div className="grid gap-3 border-b border-[var(--border)] p-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Customer" htmlFor="plan-customer">
            <SelectInput
              id="plan-customer"
              value={filters.customerId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  customerId: event.target.value,
                  siteId: '',
                }))
              }
            >
              <option value="">All customers</option>
              {(references?.customers ?? []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField label="Site" htmlFor="plan-site">
            <SelectInput
              id="plan-site"
              value={filters.siteId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  siteId: event.target.value,
                }))
              }
            >
              <option value="">All sites</option>
              {planSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField label="Model" htmlFor="plan-model">
            <SelectInput
              id="plan-model"
              value={filters.deviceModelId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  deviceModelId: event.target.value,
                }))
              }
            >
              <option value="">All models</option>
              {(references?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.vendor.name} · {model.model}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField
            label="Vendor"
            htmlFor="plan-vendor-unavailable"
            description="Requires server-side planning-query support."
          >
            <SelectInput id="plan-vendor-unavailable" value="" disabled>
              <option>Not available yet</option>
            </SelectInput>
          </FormField>
          <FormField
            label="Model family"
            htmlFor="plan-family-unavailable"
            description="Requires server-side planning-query support."
          >
            <SelectInput id="plan-family-unavailable" value="" disabled>
              <option>Not available yet</option>
            </SelectInput>
          </FormField>
          <FormField label="State" htmlFor="plan-state">
            <SelectInput
              id="plan-state"
              value={filters.state}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  state: event.target.value,
                }))
              }
            >
              <option value="">All {view} states</option>
              {(view === 'active' ? ACTIVE_STATES : HISTORY_STATES).map(
                (state) => (
                  <option key={state} value={state}>
                    {stateLabel[state]}
                  </option>
                ),
              )}
            </SelectInput>
          </FormField>
          <FormField label="Recommendation" htmlFor="plan-recommendation">
            <SelectInput
              id="plan-recommendation"
              value={filters.recommendation}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  recommendation: event.target.value,
                }))
              }
            >
              <option value="">All recommendations</option>
              <option value="UPDATE_REQUIRED">Update required</option>
              <option value="UPDATE_RECOMMENDED">Update recommended</option>
              <option value="PLATFORM_MIGRATION">Platform migration</option>
            </SelectInput>
          </FormField>
          <FormField
            label="Scheduled from"
            htmlFor="plan-scheduled-from"
            description={timeZone}
          >
            <TextInput
              id="plan-scheduled-from"
              type="datetime-local"
              value={filters.scheduledFrom}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  scheduledFrom: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField
            label="Scheduled until"
            htmlFor="plan-scheduled-until"
            description={timeZone}
          >
            <TextInput
              id="plan-scheduled-until"
              type="datetime-local"
              value={filters.scheduledUntil}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  scheduledUntil: event.target.value,
                }))
              }
            />
          </FormField>
          <div className="flex items-end gap-2">
            <Button
              variant="primary"
              onClick={() => void loadPlans(1)}
              disabled={planLoading}
            >
              Apply filters
            </Button>
            <Button
              onClick={() =>
                setFilters({
                  customerId: '',
                  siteId: '',
                  deviceModelId: '',
                  state: '',
                  recommendation: '',
                  scheduledFrom: '',
                  scheduledUntil: '',
                })
              }
              disabled={planLoading}
            >
              Reset fields
            </Button>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <MissingServerFiltersNotice />
          </div>
        </div>

        {planError ? (
          <div
            role="alert"
            className="m-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]"
          >
            {planError}
          </div>
        ) : null}

        {planLoading ? (
          <p className="p-5 text-sm text-[var(--muted)]">Loading plans…</p>
        ) : !plans?.data.length ? (
          <div className="p-5">
            <h3 className="font-semibold">No plans match this view</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {view === 'active'
                ? 'Create a plan below from explicitly selected devices, or change the server-backed filters.'
                : 'Completed and cancelled work will remain available here as append-oriented history.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Customers / sites</th>
                    <th className="px-4 py-3">Targets</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {plans.data.map((plan) => (
                    <tr key={plan.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">
                          {plan.title || 'Untitled firmware work'}
                        </div>
                        <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                          {plan.id}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatePill state={plan.state} stale={plan.stale} />
                        {plan.stale ? (
                          <div className="mt-1 text-xs text-[#f0b574]">
                            Review live drift before execution.
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {plan.customers
                          .map((customer) => customer.name)
                          .join(', ') || '—'}
                        <div className="mt-1 text-[var(--muted)]">
                          {plan.sites
                            .map((site) => site.name ?? 'No site')
                            .join(', ')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {plan.targetCount} device
                        {plan.targetCount === 1 ? '' : 's'}
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {plan.targetDistribution
                            .map(
                              (item) =>
                                `${item.version}${item.imageCode ? ` / ${item.imageCode}` : ''} × ${item.count}`,
                            )
                            .join(', ') || 'No target distribution'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {dateTime(plan.scheduledFor)}
                        {plan.maintenanceWindowReference ? (
                          <div className="mt-1 text-[var(--muted)]">
                            {plan.maintenanceWindowReference}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {dateTime(plan.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          onClick={() => void loadDetail(plan.id)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
              <span className="text-xs text-[var(--muted)]">
                Page {plans.pagination.page} of {plans.pagination.totalPages} ·{' '}
                {plans.pagination.total} plan
                {plans.pagination.total === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={plans.pagination.page <= 1 || planLoading}
                  onClick={() =>
                    void loadPlans(Math.max(1, plans.pagination.page - 1))
                  }
                >
                  Previous
                </Button>
                <Button
                  disabled={
                    plans.pagination.page >= plans.pagination.totalPages ||
                    planLoading
                  }
                  onClick={() =>
                    void loadPlans(
                      Math.min(
                        plans.pagination.totalPages,
                        plans.pagination.page + 1,
                      ),
                    )
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      {view === 'active' ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="font-semibold">Create from selected devices</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Selection is explicit. The server preview decides inclusion,
              accepted-exception handling, already-planned devices, review
              requirements, and the exact release/image snapshot.
            </p>
          </div>

          {creationError ? (
            <div
              role="alert"
              className="mb-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]"
            >
              {creationError}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Search inventory" htmlFor="planning-device-search">
              <TextInput
                id="planning-device-search"
                value={deviceFilters.q}
                onChange={(event) =>
                  setDeviceFilters((current) => ({
                    ...current,
                    q: event.target.value,
                  }))
                }
                placeholder="Device, customer, model…"
              />
            </FormField>
            <FormField label="Customer" htmlFor="planning-device-customer">
              <SelectInput
                id="planning-device-customer"
                value={deviceFilters.customer}
                onChange={(event) =>
                  setDeviceFilters((current) => ({
                    ...current,
                    customer: event.target.value,
                    site: '',
                  }))
                }
              >
                <option value="">All customers</option>
                {(references?.customers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Site" htmlFor="planning-device-site">
              <SelectInput
                id="planning-device-site"
                value={deviceFilters.site}
                onChange={(event) =>
                  setDeviceFilters((current) => ({
                    ...current,
                    site: event.target.value,
                  }))
                }
              >
                <option value="">All sites</option>
                {creationSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Vendor" htmlFor="planning-device-vendor">
              <SelectInput
                id="planning-device-vendor"
                value={deviceFilters.vendor}
                onChange={(event) =>
                  setDeviceFilters((current) => ({
                    ...current,
                    vendor: event.target.value,
                    model: '',
                  }))
                }
              >
                <option value="">All vendors</option>
                {(references?.vendors ?? []).map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Model" htmlFor="planning-device-model">
              <SelectInput
                id="planning-device-model"
                value={deviceFilters.model}
                onChange={(event) =>
                  setDeviceFilters((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              >
                <option value="">All models</option>
                {creationModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.vendor.name} · {model.model}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)]">
            {deviceLoading ? (
              <p className="p-4 text-sm text-[var(--muted)]">
                Loading selectable devices…
              </p>
            ) : !deviceRows?.data.length ? (
              <p className="p-4 text-sm text-[var(--muted)]">
                No devices match these inventory filters.
              </p>
            ) : (
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Select</th>
                    <th className="px-3 py-2">Device</th>
                    <th className="px-3 py-2">Customer / site</th>
                    <th className="px-3 py-2">Vendor / model</th>
                    <th className="px-3 py-2">Current</th>
                    <th className="px-3 py-2">Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {deviceRows.data.map((device) => (
                    <tr key={device.id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${device.name}`}
                          checked={Boolean(selectedDevices[device.id])}
                          onChange={() => toggleDevice(device)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/devices/${device.id}`}
                          className="font-semibold text-[var(--accent-light)] hover:underline"
                        >
                          {device.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {device.customer.name}
                        <div className="text-[var(--muted)]">
                          {device.site?.name ?? 'No site'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {device.deviceModel.vendor.name}
                        <div className="text-[var(--muted)]">
                          {device.deviceModel.model}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {device.currentFirmwareRelease?.version ??
                          device.currentFirmwareNormalizedVersion ??
                          device.currentFirmwareRawVersion ??
                          'Unknown'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {label(device.firmwareCompliance.recommendation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {deviceRows ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[var(--muted)]">
                {selectedIds.length} explicitly selected · device page{' '}
                {deviceRows.meta.pagination.page} of{' '}
                {deviceRows.meta.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={deviceRows.meta.pagination.page <= 1}
                  onClick={() =>
                    void loadDevices(
                      Math.max(1, deviceRows.meta.pagination.page - 1),
                    )
                  }
                >
                  Previous devices
                </Button>
                <Button
                  disabled={
                    deviceRows.meta.pagination.page >=
                    deviceRows.meta.pagination.totalPages
                  }
                  onClick={() =>
                    void loadDevices(
                      Math.min(
                        deviceRows.meta.pagination.totalPages,
                        deviceRows.meta.pagination.page + 1,
                      ),
                    )
                  }
                >
                  Next devices
                </Button>
              </div>
            </div>
          ) : null}

          {selectedIds.length ? (
            <details className="mt-3 rounded-md border border-[var(--border)] p-3 text-sm">
              <summary className="cursor-pointer font-semibold">
                Selected devices ({selectedIds.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.values(selectedDevices).map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => toggleDevice(device)}
                    className="rounded-full border border-[var(--border-strong)] px-2 py-1 text-xs hover:bg-[var(--surface-raised)]"
                  >
                    {device.name} ×
                  </button>
                ))}
              </div>
            </details>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Plan title" htmlFor="planning-title">
              <TextInput
                id="planning-title"
                value={creation.title}
                onChange={(event) =>
                  updateCreation('title', event.target.value)
                }
                placeholder="Quarterly access switch upgrades"
              />
            </FormField>
            <FormField
              label="Upgrade capability"
              htmlFor="planning-capability"
              description="Describes planning evidence only; it does not promise outage behavior."
            >
              <SelectInput
                id="planning-capability"
                value={creation.upgradeCapability}
                onChange={(event) =>
                  updateCreation('upgradeCapability', event.target.value)
                }
              >
                {FIRMWARE_UPGRADE_CAPABILITIES.map((capability) => (
                  <option key={capability} value={capability}>
                    {label(capability)}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <div className="md:col-span-2">
              <FormField label="Reason" htmlFor="planning-reason">
                <TextInput
                  id="planning-reason"
                  value={creation.reason}
                  onChange={(event) =>
                    updateCreation('reason', event.target.value)
                  }
                  placeholder="Why this work is being planned"
                />
              </FormField>
            </div>
            <div className="md:col-span-2 xl:col-span-4">
              <FormField label="Notes" htmlFor="planning-notes">
                <TextArea
                  id="planning-notes"
                  value={creation.notes}
                  onChange={(event) =>
                    updateCreation('notes', event.target.value)
                  }
                  rows={3}
                />
              </FormField>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => void runPreview()}
              disabled={creationBusy || !selectedIds.length}
            >
              {creationBusy ? 'Working…' : 'Preview selected devices'}
            </Button>
            {previewDirty ? (
              <span className="self-center text-xs font-semibold text-[#f0b574]">
                Selection or planning input changed — run the server preview
                again.
              </span>
            ) : null}
          </div>

          {preview ? (
            <div className="mt-5 space-y-4 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4">
              <div>
                <h3 className="font-semibold">Server preview</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Review every exclusion and exact target before confirming.
                  This token becomes invalid if inventory, policy, exceptions,
                  compatibility, or planning state changes.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                {Object.entries(preview.counts).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="text-xl font-semibold">{value}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                      {label(key)}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-sm font-semibold">
                  Exact target / image distribution
                </h4>
                {!preview.targetDistribution.length ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    No devices are currently eligible for inclusion.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {preview.targetDistribution.map((target) => (
                      <li key={target.firmwareReleaseId}>
                        {target.platform} · {target.version}
                        {target.imageCode ? ` · ${target.imageCode}` : ''} ·{' '}
                        {target.count} device
                        {target.count === 1 ? '' : 's'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full min-w-[1100px] text-left text-xs">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] uppercase tracking-[0.08em] text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">Device</th>
                      <th className="px-3 py-2">Disposition</th>
                      <th className="px-3 py-2">Recommendation</th>
                      <th className="px-3 py-2">Observed</th>
                      <th className="px-3 py-2">Exact target / image</th>
                      <th className="px-3 py-2">Exception</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {preview.targets.map((target) => (
                      <tr key={target.deviceId}>
                        <td className="px-3 py-2">
                          <div className="font-semibold">
                            {target.deviceName}
                          </div>
                          <div className="text-[var(--muted)]">
                            {target.customerName} /{' '}
                            {target.siteName ?? 'No site'} ·{' '}
                            {target.deviceModelName}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">
                            {dispositionLabel[target.disposition]}
                          </div>
                          <div className="mt-1 text-[var(--muted)]">
                            {target.detail}
                          </div>
                          {target.activePlanId ? (
                            <button
                              type="button"
                              onClick={() =>
                                void loadDetail(target.activePlanId!)
                              }
                              className="mt-1 text-[var(--accent-light)] hover:underline"
                            >
                              Review active plan
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {label(target.recommendation)}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {target.observedFirmwareVersion ?? 'Unknown'}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {target.targetVersion ?? 'Unresolved'}
                          {target.targetPlatform
                            ? ` · ${target.targetPlatform}`
                            : ''}
                          {target.targetVariant
                            ? ` · ${target.targetVariant}`
                            : ''}
                          {target.targetImageCode
                            ? ` · ${target.targetImageCode}`
                            : ''}
                        </td>
                        <td className="px-3 py-2">
                          {target.effectiveExceptionId ? (
                            <>
                              <div>
                                {target.effectiveExceptionReason ??
                                  target.effectiveExceptionId}
                              </div>
                              <label className="mt-1 flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={overrideIds.includes(
                                    target.deviceId,
                                  )}
                                  onChange={(event) => {
                                    setOverrideIds((current) =>
                                      event.target.checked
                                        ? [
                                            ...new Set([
                                              ...current,
                                              target.deviceId,
                                            ]),
                                          ]
                                        : current.filter(
                                            (id) => id !== target.deviceId,
                                          ),
                                    )
                                    setPreviewDirty(true)
                                  }}
                                />
                                <span>
                                  Explicitly override this active exception for
                                  this device in this plan
                                </span>
                              </label>
                            </>
                          ) : (
                            'None'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => void createPlan()}
                  disabled={
                    creationBusy ||
                    previewDirty ||
                    preview.counts.included < 1
                  }
                >
                  Confirm preview and create plan
                </Button>
                <span className="text-xs text-[var(--muted)]">
                  Creating the plan does not clear exceptions and does not
                  execute firmware.
                </span>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        aria-live="polite"
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Plan detail</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Immutable target snapshots are shown alongside current stale
              evidence and append-oriented transition history.
            </p>
          </div>
          {detail ? (
            <Button
              onClick={() => void loadDetail(detail.id)}
              disabled={detailLoading}
            >
              Refresh plan
            </Button>
          ) : null}
        </div>

        {detailError ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[#754040] bg-[#2a1b1b] px-4 py-3 text-sm text-[#f0b0b0]"
          >
            {detailError}
          </div>
        ) : null}

        {detailLoading ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Loading plan detail…
          </p>
        ) : !detail ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Choose Review on a plan to inspect its exact target snapshots and
            history.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {detail.stale ? (
              <div className="rounded-md border border-[#9a6234] bg-[#342218] p-4 text-[#ffd0a0]">
                <div className="font-semibold">
                  Stale plan — review current assumptions before execution
                </div>
                <p className="mt-1 text-sm">
                  NOC Orchestrator has not retargeted this plan. The saved
                  target remains the intended historical snapshot until a
                  separate supported workflow changes it.
                </p>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {Object.entries(detail.staleReasonCounts).map(
                    ([reason, count]) => (
                      <li key={reason}>
                        {label(reason)}: {count} target
                        {count === 1 ? '' : 's'}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-[var(--border)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  State
                </div>
                <div className="mt-2">
                  <StatePill state={detail.state} stale={detail.stale} />
                </div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  Targets
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {detail.targetCount}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  Scheduled
                </div>
                <div className="mt-1 text-sm">
                  {dateTime(detail.scheduledFor)}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {detail.maintenanceWindowReference ??
                    'No maintenance-window reference'}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  Last change
                </div>
                <div className="mt-1 text-sm">
                  {dateTime(detail.updatedAt)}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold">Exact device snapshots</h3>
              <div className="mt-2 overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="w-full min-w-[1300px] text-left text-xs">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] uppercase tracking-[0.08em] text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">Device</th>
                      <th className="px-3 py-2">Observed at planning</th>
                      <th className="px-3 py-2">Policy / recommendation</th>
                      <th className="px-3 py-2">Exact intended target</th>
                      <th className="px-3 py-2">Exception evidence</th>
                      <th className="px-3 py-2">Current stale evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {detail.targets.map((target) => (
                      <tr key={target.snapshot.id}>
                        <td className="px-3 py-2">
                          <Link
                            href={`/devices/${target.snapshot.deviceId}`}
                            className="font-semibold text-[var(--accent-light)] hover:underline"
                          >
                            {target.snapshot.deviceName}
                          </Link>
                          <div className="mt-1 text-[var(--muted)]">
                            {target.snapshot.customerName} /{' '}
                            {target.snapshot.siteName ?? 'No site'} ·{' '}
                            {target.snapshot.deviceModelName}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {target.snapshot.observedFirmwareVersion ??
                            target.snapshot.observedFirmwareRawVersion ??
                            'Unknown'}
                          <div className="mt-1 font-sans text-[var(--muted)]">
                            {dateTime(target.snapshot.observedAt)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {label(target.snapshot.recommendation)}
                          <div className="mt-1 text-[var(--muted)]">
                            {target.snapshot.policyTrackName ??
                              target.snapshot.policyScope ??
                              'Policy source unknown'}
                          </div>
                          {target.snapshot.preferredTargetVersion ? (
                            <div className="mt-1 text-[var(--muted)]">
                              Preferred then:{' '}
                              {target.snapshot.preferredTargetVersion}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {target.snapshot.targetVersion} ·{' '}
                          {target.snapshot.targetPlatform}
                          {target.snapshot.targetVariant
                            ? ` · ${target.snapshot.targetVariant}`
                            : ''}
                          {target.snapshot.targetImageCode
                            ? ` · ${target.snapshot.targetImageCode}`
                            : ''}
                          <div className="mt-1 font-sans text-[var(--muted)]">
                            {label(target.snapshot.upgradeCapability)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {target.snapshot.exceptionOverride ? (
                            <>
                              <div className="font-semibold text-[#f0c36b]">
                                Explicit override recorded
                              </div>
                              <pre className="mt-1 max-w-xs whitespace-pre-wrap font-sans text-[var(--muted)]">
                                {JSON.stringify(
                                  target.snapshot.exceptionSnapshot,
                                  null,
                                  2,
                                )}
                              </pre>
                            </>
                          ) : target.snapshot.exceptionSnapshot ? (
                            <pre className="max-w-xs whitespace-pre-wrap font-sans text-[var(--muted)]">
                              {JSON.stringify(
                                target.snapshot.exceptionSnapshot,
                                null,
                                2,
                              )}
                            </pre>
                          ) : (
                            'No exception snapshot'
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {target.staleness.stale ? (
                            <ul className="list-disc pl-4 text-[#f0b574]">
                              {target.staleness.reasons.map((reason) => (
                                <li key={reason}>{label(reason)}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-[var(--muted)]">
                              No stale reasons
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {isActiveFirmwareWorkPlanState(detail.state) ? (
              <div className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4">
                <h3 className="font-semibold">Workflow action</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Starting or completing work here changes workflow state only.
                  It does not contact a device, install firmware, verify
                  success, or update observed firmware.
                </p>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <FormField label="Reason" htmlFor="transition-reason">
                    <TextInput
                      id="transition-reason"
                      value={transitionReason}
                      onChange={(event) =>
                        setTransitionReason(event.target.value)
                      }
                    />
                  </FormField>
                  <FormField label="Notes" htmlFor="transition-notes">
                    <TextInput
                      id="transition-notes"
                      value={transitionNotes}
                      onChange={(event) =>
                        setTransitionNotes(event.target.value)
                      }
                    />
                  </FormField>
                </div>

                {allowedTransitions.includes('SCHEDULED') ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <FormField
                      label="Schedule date and time"
                      htmlFor="transition-scheduled-for"
                      description={`Interpreted in ${timeZone}; the API receives the resulting timezone-qualified instant.`}
                    >
                      <TextInput
                        id="transition-scheduled-for"
                        type="datetime-local"
                        value={scheduledFor}
                        onChange={(event) =>
                          setScheduledFor(event.target.value)
                        }
                      />
                    </FormField>
                    <FormField
                      label="Maintenance-window reference"
                      htmlFor="transition-maintenance-window"
                      description="Optional reference only; no automatic window selection is performed."
                    >
                      <TextInput
                        id="transition-maintenance-window"
                        value={maintenanceWindowReference}
                        onChange={(event) =>
                          setMaintenanceWindowReference(event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {allowedTransitions.map((toState) => (
                    <Button
                      key={toState}
                      variant={
                        toState === 'CANCELLED'
                          ? 'danger'
                          : toState === 'DONE'
                            ? 'primary'
                            : 'secondary'
                      }
                      disabled={transitionBusy}
                      onClick={() => void transition(toState)}
                    >
                      {actionLabel[toState]}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm text-[var(--muted)]">
                {stateLabel[detail.state]} is terminal. Historical snapshots and
                events remain visible, but no further transitions are offered.
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold">Transition history</h3>
              {!detail.events.length ? (
                <p className="mt-2 text-sm text-[var(--muted)]">
                  No transition events recorded.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {detail.events.map((event) => (
                    <li
                      key={event.id}
                      className="rounded-md border border-[var(--border)] p-3"
                    >
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="font-semibold">
                          {event.fromState
                            ? `${label(event.fromState)} → ${label(event.toState)}`
                            : label(event.toState)}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {dateTime(event.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        Actor:{' '}
                        {event.actorUserId ??
                          'Historical/authenticated actor unavailable'}
                      </div>
                      {event.reason ? (
                        <p className="mt-2 text-sm">{event.reason}</p>
                      ) : null}
                      {event.notes ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted-strong)]">
                          {event.notes}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export { MissingServerFiltersNotice }
