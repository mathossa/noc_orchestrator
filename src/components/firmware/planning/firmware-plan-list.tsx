'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  FormField,
  SelectInput,
  TextInput,
} from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import {
  FIRMWARE_WORK_PLAN_STATES,
  isActiveFirmwareWorkPlanState,
  type FirmwareWorkPlanState,
} from '@/lib/firmware-work-planning'
import {
  type DeviceReferences,
  type PlanListResponse,
  dateTime,
  dateTimeLocalToIso,
  requestJson,
} from './planning-client'
import {
  PlanStatePill,
  PlanningError,
  PlanningSection,
} from './planning-ui'

export type PlanningView = 'active' | 'history'

const ACTIVE_STATES = FIRMWARE_WORK_PLAN_STATES.filter(
  isActiveFirmwareWorkPlanState,
)
const HISTORY_STATES = FIRMWARE_WORK_PLAN_STATES.filter(
  (state) => !isActiveFirmwareWorkPlanState(state),
)

const RECOMMENDATION_FILTERS = [
  'NO_ACTION',
  'UPDATE_RECOMMENDED',
  'UPDATE_REQUIRED',
  'PLATFORM_MIGRATION',
  'REVIEW_REQUIRED',
] as const

export function FirmwarePlanList({
  initialView = 'active',
}: {
  initialView?: PlanningView
}) {
  const view: PlanningView =
    initialView === 'history' ? 'history' : 'active'
  const [plans, setPlans] = useState<PlanListResponse | null>(null)
  const [references, setReferences] = useState<DeviceReferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({
    customerId: '',
    siteId: '',
    vendorId: '',
    deviceModelFamilyId: '',
    deviceModelId: '',
    state: '',
    recommendation: '',
    scheduledFrom: '',
    scheduledUntil: '',
  })

  useEffect(() => {
    let active = true
    void Promise.all([
      requestJson<{ data: DeviceReferences['customers'] }>('/api/v1/customers'),
      requestJson<{ data: DeviceReferences['sites'] }>('/api/v1/sites'),
      requestJson<{
        data: DeviceReferences['models']
        references: {
          vendors: DeviceReferences['vendors']
          families: NonNullable<DeviceReferences['families']>
        }
      }>('/api/v1/models'),
    ])
      .then(([customers, sites, models]) => {
        if (active)
          setReferences({
            customers: customers.data,
            sites: sites.data,
            models: models.data,
            vendors: models.references.vendors,
            families: models.references.families,
            deviceTypes: [],
          })
      })
      .catch(() => {
        // Filters are secondary; plan loading remains useful without references.
      })
    return () => {
      active = false
    }
  }, [])

  const allowedStates = useMemo(
    () => (view === 'active' ? ACTIVE_STATES : HISTORY_STATES),
    [view],
  )

  const loadPlans = useCallback(
    async (requestedPage: number) => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
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
        if (filters.vendorId) params.set('vendorId', filters.vendorId)
        if (filters.deviceModelFamilyId)
          params.set('deviceModelFamilyId', filters.deviceModelFamilyId)
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
        params.set('page', String(requestedPage))
        params.set('pageSize', '25')
        const payload = await requestJson<PlanListResponse>(
          `/api/v1/firmware-work-plans?${params}`,
        )
        setPlans(payload)
        setPage(payload.pagination.page)
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load maintenance plans.',
        )
      } finally {
        setLoading(false)
      }
    },
    [allowedStates, filters],
  )

  useEffect(() => {
    const handle = window.setTimeout(() => void loadPlans(1), 0)
    return () => window.clearTimeout(handle)
  }, [loadPlans])

  const visibleSites = useMemo(
    () =>
      (references?.sites ?? []).filter(
        (site) =>
          !filters.customerId || site.customerId === filters.customerId,
      ),
    [filters.customerId, references],
  )

  const visibleFamilies = useMemo(
    () =>
      (references?.families ?? []).filter(
        (family) =>
          !filters.vendorId || family.vendorId === filters.vendorId,
      ),
    [filters.vendorId, references],
  )

  const visibleModels = useMemo(
    () =>
      (references?.models ?? []).filter(
        (model) =>
          (!filters.vendorId || model.vendor.id === filters.vendorId) &&
          (!filters.deviceModelFamilyId ||
            model.familyId === filters.deviceModelFamilyId),
      ),
    [filters.deviceModelFamilyId, filters.vendorId, references],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firmware"
        title="Planning"
        description="Create, revisit and operate persistent firmware maintenance plans."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/planning/new"
              className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)] hover:opacity-90"
            >
              + Create maintenance plan
            </Link>
            <Link
              href="/firmware/exceptions"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
            >
              Exceptions
            </Link>
          </div>
        }
      />

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
          Completed / cancelled
        </Link>
      </div>

      <PlanningSection
        title={view === 'active' ? 'Existing maintenance plans' : 'Plan history'}
        description={
          view === 'active'
            ? 'Open a plan to continue customer approval, scheduling or execution. Filters are optional.'
            : 'Completed and cancelled plans remain immutable historical work.'
        }
      >
        <div className="space-y-4">
          <details className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)]">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
              Filters
            </summary>
            <div className="grid gap-3 border-t border-[var(--border)] p-4 md:grid-cols-3">
              <FormField label="Customer" htmlFor="plan-filter-customer">
                <SelectInput
                  id="plan-filter-customer"
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
              <FormField label="Site" htmlFor="plan-filter-site">
                <SelectInput
                  id="plan-filter-site"
                  value={filters.siteId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      siteId: event.target.value,
                    }))
                  }
                >
                  <option value="">All sites</option>
                  {visibleSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="State" htmlFor="plan-filter-state">
                <SelectInput
                  id="plan-filter-state"
                  value={filters.state}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      state: event.target.value,
                    }))
                  }
                >
                  <option value="">All states in this view</option>
                  {allowedStates.map((state) => (
                    <option key={state} value={state}>
                      {state
                        .toLowerCase()
                        .replaceAll('_', ' ')
                        .replace(/^./, (value) => value.toUpperCase())}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Vendor" htmlFor="plan-filter-vendor">
                <SelectInput
                  id="plan-filter-vendor"
                  value={filters.vendorId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      vendorId: event.target.value,
                      deviceModelFamilyId: '',
                      deviceModelId: '',
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
              <FormField
                label="Model family"
                htmlFor="plan-filter-model-family"
              >
                <SelectInput
                  id="plan-filter-model-family"
                  value={filters.deviceModelFamilyId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      deviceModelFamilyId: event.target.value,
                      deviceModelId: '',
                    }))
                  }
                >
                  <option value="">All model families</option>
                  {visibleFamilies.map((family) => (
                    <option key={family.id} value={family.id}>
                      {family.name}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField label="Model" htmlFor="plan-filter-model">
                <SelectInput
                  id="plan-filter-model"
                  value={filters.deviceModelId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      deviceModelId: event.target.value,
                    }))
                  }
                >
                  <option value="">All models</option>
                  {visibleModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.vendor.name} · {model.model}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField
                label="Recommendation"
                htmlFor="plan-filter-recommendation"
              >
                <SelectInput
                  id="plan-filter-recommendation"
                  value={filters.recommendation}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      recommendation: event.target.value,
                    }))
                  }
                >
                  <option value="">All recommendations</option>
                  {RECOMMENDATION_FILTERS.map((recommendation) => (
                    <option key={recommendation} value={recommendation}>
                      {recommendation
                        .toLowerCase()
                        .replaceAll('_', ' ')
                        .replace(/^./, (value) => value.toUpperCase())}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField
                label="Scheduled from"
                htmlFor="plan-filter-scheduled-from"
              >
                <TextInput
                  id="plan-filter-scheduled-from"
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
                htmlFor="plan-filter-scheduled-until"
              >
                <TextInput
                  id="plan-filter-scheduled-until"
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
              <div className="flex items-end gap-2 md:col-span-3">
                <Button
                  variant="primary"
                  disabled={loading}
                  onClick={() => void loadPlans(1)}
                >
                  Apply filters
                </Button>
                <Button
                  disabled={loading}
                  onClick={() =>
                    setFilters({
                      customerId: '',
                      siteId: '',
                      vendorId: '',
                      deviceModelFamilyId: '',
                      deviceModelId: '',
                      state: '',
                      recommendation: '',
                      scheduledFrom: '',
                      scheduledUntil: '',
                    })
                  }
                >
                  Reset
                </Button>
              </div>
            </div>
          </details>

          <PlanningError message={error} />

          {loading ? (
            <p className="py-4 text-sm text-[var(--muted)]">
              Loading maintenance plans…
            </p>
          ) : !plans?.data.length ? (
            <div className="rounded-md border border-dashed border-[var(--border-strong)] p-6">
              <h3 className="font-semibold">
                {view === 'active'
                  ? 'No active maintenance plans'
                  : 'No completed or cancelled plans'}
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {view === 'active'
                  ? 'Create a plan once, then return here whenever the maintenance workflow continues.'
                  : 'Terminal plans will remain available here as history.'}
              </p>
              {view === 'active' ? (
                <Link
                  href="/planning/new"
                  className="mt-4 inline-flex rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-contrast)]"
                >
                  + Create maintenance plan
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {plans.data.map((plan) => (
                <Link
                  key={plan.id}
                  href={`/planning/${plan.id}`}
                  className="block rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">
                          {plan.title || 'Untitled firmware maintenance'}
                        </h3>
                        <PlanStatePill
                          state={plan.state}
                          stale={plan.stale}
                        />
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {plan.customers.map((customer) => customer.name).join(', ') ||
                          'No customer snapshot'}
                        {' · '}
                        {plan.sites
                          .map((site) => site.name ?? 'No site')
                          .join(', ') || 'No site snapshot'}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">
                        {plan.targetCount}
                      </div>
                      <div className="text-xs text-[var(--muted)]">
                        target{plan.targetCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                        Proposed window
                      </div>
                      <div className="mt-1">{dateTime(plan.proposedFor)}</div>
                      {plan.proposedMaintenanceWindowReference ? (
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {plan.proposedMaintenanceWindowReference}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                        Confirmed schedule
                      </div>
                      <div className="mt-1">{dateTime(plan.scheduledFor)}</div>
                      {plan.maintenanceWindowReference ? (
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {plan.maintenanceWindowReference}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                        Firmware targets
                      </div>
                      <div className="mt-1 text-xs leading-5">
                        {plan.targetDistribution
                          .slice(0, 3)
                          .map(
                            (target) =>
                              `${target.version} × ${target.count}`,
                          )
                          .join(' · ') || 'No target distribution'}
                        {plan.targetDistribution.length > 3
                          ? ` · +${plan.targetDistribution.length - 3} more`
                          : ''}
                      </div>
                    </div>
                  </div>

                  {plan.stale ? (
                    <div className="mt-3 rounded-md border border-[#9a6234] bg-[#342218] px-3 py-2 text-xs text-[#ffd0a0]">
                      Review attention required before execution. Saved targets
                      have not been rewritten.
                    </div>
                  ) : null}
                </Link>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-xs text-[var(--muted)]">
                  Page {plans.pagination.page} of {plans.pagination.totalPages} ·{' '}
                  {plans.pagination.total} plan
                  {plans.pagination.total === 1 ? '' : 's'}
                </span>
                <div className="flex gap-2">
                  <Button
                    disabled={page <= 1 || loading}
                    onClick={() => void loadPlans(Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    disabled={
                      page >= plans.pagination.totalPages || loading
                    }
                    onClick={() =>
                      void loadPlans(
                        Math.min(plans.pagination.totalPages, page + 1),
                      )
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PlanningSection>
    </div>
  )
}
