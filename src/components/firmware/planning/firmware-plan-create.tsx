'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  FormField,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/ui/form-controls'
import { PageHeader } from '@/components/ui/page-header'
import { FIRMWARE_UPGRADE_CAPABILITIES } from '@/lib/firmware-work-planning'
import {
  type ClientError,
  type DeviceChoice,
  type DevicePayload,
  type DeviceReferences,
  type PlanPreview,
  commonSwitchAndAccessPointTypeIds,
  dateTimeLocalToIso,
  groupPreviewTargets,
  groupScopeDevices,
  labelValue,
  requestJson,
  resolveSiteScopeDevices,
  toggleSelection,
} from './planning-client'
import {
  PlanningError,
  PlanningSection,
  PlanningStatus,
} from './planning-ui'

type ScopeMode = 'sites' | 'devices'

const dispositionLabel: Record<
  PlanPreview['targets'][number]['disposition'],
  string
> = {
  INCLUDED: 'Included',
  INACTIVE_DEVICE: 'Inactive',
  ALREADY_PLANNED: 'Already planned',
  ACTIVE_EXCEPTION: 'Active exception',
  NO_ACTION: 'No action',
  REVIEW_REQUIRED: 'Review required',
}

export function FirmwarePlanCreate() {
  const router = useRouter()
  const [scopeMode, setScopeMode] = useState<ScopeMode>('sites')
  const [references, setReferences] = useState<DeviceReferences | null>(null)
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([])
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([])
  const [selectedDeviceTypeIds, setSelectedDeviceTypeIds] = useState<string[]>(
    [],
  )
  const [resolvedDevices, setResolvedDevices] = useState<DeviceChoice[]>([])
  const [selectedDevices, setSelectedDevices] = useState<
    Record<string, DeviceChoice>
  >({})
  const [deviceRows, setDeviceRows] = useState<DevicePayload | null>(null)
  const [deviceLoading, setDeviceLoading] = useState(false)
  const [deviceFilters, setDeviceFilters] = useState({
    q: '',
    customer: '',
    site: '',
    deviceType: '',
    model: '',
  })
  const [creation, setCreation] = useState({
    title: '',
    reason: '',
    notes: '',
    proposedFor: '',
    proposedMaintenanceWindowReference: '',
    upgradeCapability: 'UNKNOWN',
  })
  const [overrideIds, setOverrideIds] = useState<string[]>([])
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [previewDirty, setPreviewDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [timeZone, setTimeZone] = useState('browser local time')

  useEffect(() => {
    setTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'browser local time',
    )
  }, [])

  useEffect(() => {
    let active = true
    setReferenceLoading(true)
    void requestJson<DevicePayload>(
      '/api/v1/devices?page=1&pageSize=25&sort=customer&direction=asc',
    )
      .then((payload) => {
        if (!active) return
        setReferences({
          customers: payload.meta.customers,
          sites: payload.meta.sites,
          models: payload.meta.models,
          vendors: payload.meta.vendors,
          deviceTypes: payload.meta.deviceTypes,
        })
      })
      .catch((loadError) => {
        if (active)
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load planning reference data.',
          )
      })
      .finally(() => {
        if (active) setReferenceLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function invalidatePreview() {
    if (preview) setPreviewDirty(true)
  }

  function changeScopeMode(mode: ScopeMode) {
    setScopeMode(mode)
    setResolvedDevices([])
    setPreview(null)
    setPreviewDirty(false)
    setOverrideIds([])
    setError('')
    setMessage('')
  }

  function toggleCustomer(customerId: string) {
    const removing = selectedCustomerIds.includes(customerId)
    setSelectedCustomerIds((current) =>
      toggleSelection(current, customerId),
    )
    if (removing) {
      const customerSiteIds = new Set(
        (references?.sites ?? [])
          .filter((site) => site.customerId === customerId)
          .map((site) => site.id),
      )
      setSelectedSiteIds((current) =>
        current.filter((siteId) => !customerSiteIds.has(siteId)),
      )
    }
    invalidatePreview()
  }

  function toggleSite(siteId: string) {
    setSelectedSiteIds((current) => toggleSelection(current, siteId))
    invalidatePreview()
  }

  function toggleDeviceType(deviceTypeId: string) {
    setSelectedDeviceTypeIds((current) =>
      toggleSelection(current, deviceTypeId),
    )
    invalidatePreview()
  }

  function updateCreation<K extends keyof typeof creation>(
    key: K,
    value: (typeof creation)[K],
  ) {
    setCreation((current) => ({ ...current, [key]: value }))
    invalidatePreview()
  }

  const selectedCustomers = useMemo(
    () =>
      (references?.customers ?? []).filter((customer) =>
        selectedCustomerIds.includes(customer.id),
      ),
    [references, selectedCustomerIds],
  )

  const siteSelectionByCustomer = useMemo(
    () =>
      selectedCustomers.map((customer) => ({
        customer,
        sites: (references?.sites ?? []).filter(
          (site) => site.customerId === customer.id && site.isActive,
        ),
      })),
    [references, selectedCustomers],
  )

  const commonAccessTypeIds = useMemo(
    () =>
      commonSwitchAndAccessPointTypeIds(
        (references?.deviceTypes ?? []).filter((type) => type.isActive),
      ),
    [references],
  )

  const selectedSiteLabels = useMemo(
    () =>
      (references?.sites ?? []).filter((site) =>
        selectedSiteIds.includes(site.id),
      ),
    [references, selectedSiteIds],
  )

  const selectedTypeLabels = useMemo(
    () =>
      (references?.deviceTypes ?? []).filter((type) =>
        selectedDeviceTypeIds.includes(type.id),
      ),
    [references, selectedDeviceTypeIds],
  )

  const loadIndividualDevices = useCallback(
    async (page: number) => {
      if (scopeMode !== 'devices') return
      setDeviceLoading(true)
      setError('')
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
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load devices.',
        )
      } finally {
        setDeviceLoading(false)
      }
    },
    [deviceFilters, scopeMode],
  )

  useEffect(() => {
    if (scopeMode !== 'devices') return
    const handle = window.setTimeout(
      () => void loadIndividualDevices(1),
      150,
    )
    return () => window.clearTimeout(handle)
  }, [loadIndividualDevices, scopeMode])

  const individualSites = useMemo(
    () =>
      (references?.sites ?? []).filter(
        (site) =>
          !deviceFilters.customer ||
          site.customerId === deviceFilters.customer,
      ),
    [deviceFilters.customer, references],
  )

  const individualModels = useMemo(
    () =>
      (references?.models ?? []).filter(
        (model) =>
          !deviceFilters.deviceType ||
          model.deviceType.id === deviceFilters.deviceType,
      ),
    [deviceFilters.deviceType, references],
  )

  function toggleIndividualDevice(device: DeviceChoice) {
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

  function planningInput(deviceIds: string[]) {
    return {
      deviceIds,
      title: creation.title || null,
      reason: creation.reason || null,
      notes: creation.notes || null,
      proposedFor: creation.proposedFor
        ? dateTimeLocalToIso(creation.proposedFor)
        : null,
      proposedMaintenanceWindowReference:
        creation.proposedMaintenanceWindowReference || null,
      exceptionOverrideDeviceIds: overrideIds,
      upgradeCapability: creation.upgradeCapability,
    }
  }

  async function resolveCurrentScope() {
    if (scopeMode === 'sites') {
      if (!selectedSiteIds.length)
        throw new Error('Select at least one site.')
      if (!selectedDeviceTypeIds.length)
        throw new Error('Select at least one device type.')
      return resolveSiteScopeDevices(
        selectedSiteIds,
        selectedDeviceTypeIds,
      )
    }

    const devices = Object.values(selectedDevices)
    if (!devices.length) throw new Error('Select at least one device.')
    return devices
  }

  async function runPreview() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const devices = await resolveCurrentScope()
      if (!devices.length)
        throw new Error(
          'No active devices match the selected sites and device types.',
        )
      const payload = await requestJson<{ data: PlanPreview }>(
        '/api/v1/firmware-work-plans',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'preview',
            input: planningInput(devices.map((device) => device.id)),
          }),
        },
      )
      setResolvedDevices(devices)
      setPreview(payload.data)
      setPreviewDirty(false)
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Planning preview failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function createPlan() {
    if (!preview || previewDirty) {
      setError('Run and review a fresh server preview first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const deviceIds = resolvedDevices.map((device) => device.id)
      const payload = await requestJson<{ data: { id: string } }>(
        '/api/v1/firmware-work-plans',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            input: planningInput(deviceIds),
            token: preview.token,
          }),
        },
      )
      router.push(`/planning/${payload.data.id}`)
    } catch (createError) {
      const typed = createError as ClientError
      if (typed.code === 'STALE_PREVIEW') {
        setPreview(null)
        setPreviewDirty(false)
        setError(
          'The preview is stale. Run it again and review changed inclusion, exceptions and exact targets before creating the plan.',
        )
      } else
        setError(
          createError instanceof Error
            ? createError.message
            : 'Plan creation failed.',
        )
    } finally {
      setBusy(false)
    }
  }

  const scopeGroups = useMemo(
    () => groupScopeDevices(resolvedDevices),
    [resolvedDevices],
  )
  const previewGroups = useMemo(
    () => (preview ? groupPreviewTargets(preview.targets) : []),
    [preview],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firmware planning"
        title="Create maintenance plan"
        description="Choose a site-oriented scope or explicit individual devices, resolve it to exact device IDs, then review the authoritative firmware preview before saving."
        actions={
          <Link
            href="/planning"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Back to plans
          </Link>
        }
      />

      <PlanningError message={error} />
      <PlanningStatus message={message} />

      <PlanningSection
        title="1. Select scope"
        description="Site scope is the normal path. Individual device selection remains available for exceptions and one-off work."
      >
        <div className="space-y-5">
          <div className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1">
            <button
              type="button"
              onClick={() => changeScopeMode('sites')}
              aria-pressed={scopeMode === 'sites'}
              className={`rounded px-3 py-2 text-sm font-semibold ${
                scopeMode === 'sites'
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-light)]'
                  : 'text-[var(--muted-strong)]'
              }`}
            >
              Sites
            </button>
            <button
              type="button"
              onClick={() => changeScopeMode('devices')}
              aria-pressed={scopeMode === 'devices'}
              className={`rounded px-3 py-2 text-sm font-semibold ${
                scopeMode === 'devices'
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-light)]'
                  : 'text-[var(--muted-strong)]'
              }`}
            >
              Individual devices
            </button>
          </div>

          {scopeMode === 'sites' ? (
            referenceLoading ? (
              <p className="text-sm text-[var(--muted)]">
                Loading customers, sites and device types…
              </p>
            ) : (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold">Customers</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Select one or more customers. Each selected customer exposes
                    its sites below.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(references?.customers ?? [])
                      .filter((customer) => customer.isActive)
                      .map((customer) => (
                        <label
                          key={customer.id}
                          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.includes(customer.id)}
                            onChange={() => toggleCustomer(customer.id)}
                          />
                          {customer.name}
                        </label>
                      ))}
                  </div>
                </div>

                {selectedCustomerIds.length ? (
                  <div>
                    <h3 className="text-sm font-semibold">Sites</h3>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {siteSelectionByCustomer.map(({ customer, sites }) => (
                        <div
                          key={customer.id}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"
                        >
                          <div className="font-semibold">{customer.name}</div>
                          {!sites.length ? (
                            <p className="mt-2 text-xs text-[var(--muted)]">
                              No active sites.
                            </p>
                          ) : (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {sites.map((site) => (
                                <label
                                  key={site.id}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedSiteIds.includes(site.id)}
                                    onChange={() => toggleSite(site.id)}
                                  />
                                  {site.name}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-[var(--border-strong)] p-4 text-sm text-[var(--muted)]">
                    Choose customer(s) to select one or more sites.
                  </p>
                )}

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">Device types</h3>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Canonical device-type IDs determine which devices inside
                        the selected sites are resolved.
                      </p>
                    </div>
                    {commonAccessTypeIds.length ? (
                      <Button
                        onClick={() => {
                          setSelectedDeviceTypeIds(commonAccessTypeIds)
                          invalidatePreview()
                        }}
                      >
                        Select switches + access points
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(references?.deviceTypes ?? [])
                      .filter((type) => type.isActive)
                      .map((type) => (
                        <label
                          key={type.id}
                          className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedDeviceTypeIds.includes(type.id)}
                            onChange={() => toggleDeviceType(type.id)}
                          />
                          {type.name}
                        </label>
                      ))}
                  </div>
                </div>

                <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm">
                  <div className="font-semibold">Selected site scope</div>
                  <div className="mt-1 text-[var(--muted)]">
                    {selectedSiteLabels.length
                      ? selectedSiteLabels
                          .map((site) => site.name)
                          .join(', ')
                      : 'No sites selected'}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {selectedTypeLabels.length
                      ? selectedTypeLabels
                          .map((type) => type.name)
                          .join(', ')
                      : 'No device types selected'}
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <FormField label="Search" htmlFor="individual-search">
                  <TextInput
                    id="individual-search"
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
                <FormField label="Customer" htmlFor="individual-customer">
                  <SelectInput
                    id="individual-customer"
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
                <FormField label="Site" htmlFor="individual-site">
                  <SelectInput
                    id="individual-site"
                    value={deviceFilters.site}
                    onChange={(event) =>
                      setDeviceFilters((current) => ({
                        ...current,
                        site: event.target.value,
                      }))
                    }
                  >
                    <option value="">All sites</option>
                    {individualSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Device type" htmlFor="individual-type">
                  <SelectInput
                    id="individual-type"
                    value={deviceFilters.deviceType}
                    onChange={(event) =>
                      setDeviceFilters((current) => ({
                        ...current,
                        deviceType: event.target.value,
                        model: '',
                      }))
                    }
                  >
                    <option value="">All device types</option>
                    {(references?.deviceTypes ?? []).map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
                <FormField label="Model" htmlFor="individual-model">
                  <SelectInput
                    id="individual-model"
                    value={deviceFilters.model}
                    onChange={(event) =>
                      setDeviceFilters((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  >
                    <option value="">All models</option>
                    {individualModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.vendor.name} · {model.model}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </div>

              <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                {deviceLoading ? (
                  <p className="p-4 text-sm text-[var(--muted)]">
                    Loading devices…
                  </p>
                ) : !deviceRows?.data.length ? (
                  <p className="p-4 text-sm text-[var(--muted)]">
                    No devices match these filters.
                  </p>
                ) : (
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">Select</th>
                        <th className="px-3 py-2">Device</th>
                        <th className="px-3 py-2">Customer / site</th>
                        <th className="px-3 py-2">Type / model</th>
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
                              onChange={() => toggleIndividualDevice(device)}
                            />
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {device.name}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {device.customer.name}
                            <div className="text-[var(--muted)]">
                              {device.site?.name ?? 'No site'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {device.deviceModel.deviceType.name}
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
                            {labelValue(
                              device.firmwareCompliance.recommendation,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {deviceRows ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-[var(--muted)]">
                    {Object.keys(selectedDevices).length} selected · page{' '}
                    {deviceRows.meta.pagination.page} of{' '}
                    {deviceRows.meta.pagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      disabled={deviceRows.meta.pagination.page <= 1}
                      onClick={() =>
                        void loadIndividualDevices(
                          deviceRows.meta.pagination.page - 1,
                        )
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      disabled={
                        deviceRows.meta.pagination.page >=
                        deviceRows.meta.pagination.totalPages
                      }
                      onClick={() =>
                        void loadIndividualDevices(
                          deviceRows.meta.pagination.page + 1,
                        )
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </PlanningSection>

      <PlanningSection
        title="2. Proposal"
        description="The proposed maintenance date and reference are part of the customer proposal. A draft may still be created without a date."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Plan title" htmlFor="plan-title">
            <TextInput
              id="plan-title"
              value={creation.title}
              onChange={(event) =>
                updateCreation('title', event.target.value)
              }
              placeholder="Quarterly firmware maintenance"
            />
          </FormField>
          <FormField
            label="Proposed maintenance date/time"
            htmlFor="plan-proposed-for"
            description={timeZone}
          >
            <TextInput
              id="plan-proposed-for"
              type="datetime-local"
              value={creation.proposedFor}
              onChange={(event) =>
                updateCreation('proposedFor', event.target.value)
              }
            />
          </FormField>
          <FormField
            label="Proposed window reference"
            htmlFor="plan-proposed-window-reference"
          >
            <TextInput
              id="plan-proposed-window-reference"
              value={creation.proposedMaintenanceWindowReference}
              onChange={(event) =>
                updateCreation(
                  'proposedMaintenanceWindowReference',
                  event.target.value,
                )
              }
              placeholder="Customer MW / ticket reference"
            />
          </FormField>
          <FormField
            label="Upgrade capability"
            htmlFor="plan-upgrade-capability"
            description="Planning evidence only; it does not promise outage behavior."
          >
            <SelectInput
              id="plan-upgrade-capability"
              value={creation.upgradeCapability}
              onChange={(event) =>
                updateCreation('upgradeCapability', event.target.value)
              }
            >
              {FIRMWARE_UPGRADE_CAPABILITIES.map((capability) => (
                <option key={capability} value={capability}>
                  {labelValue(capability)}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Reason" htmlFor="plan-reason">
              <TextInput
                id="plan-reason"
                value={creation.reason}
                onChange={(event) =>
                  updateCreation('reason', event.target.value)
                }
                placeholder="Why this maintenance is being proposed"
              />
            </FormField>
          </div>
          <div className="md:col-span-2">
            <FormField label="Notes" htmlFor="plan-notes">
              <TextArea
                id="plan-notes"
                rows={3}
                value={creation.notes}
                onChange={(event) =>
                  updateCreation('notes', event.target.value)
                }
              />
            </FormField>
          </div>
        </div>
      </PlanningSection>

      <PlanningSection
        title="3. Resolve and preview"
        description="Scope resolution enumerates every page of the existing device API. The resulting explicit device IDs are then passed to the existing #60 preview, which remains authoritative for exceptions, recommendations, compatibility and exact firmware targets."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => void runPreview()}
              disabled={busy}
            >
              {busy ? 'Resolving…' : 'Resolve scope and preview'}
            </Button>
            {previewDirty ? (
              <span className="text-xs font-semibold text-[#f0b574]">
                Scope or proposal changed — preview again before creation.
              </span>
            ) : null}
          </div>

          {scopeGroups.length ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">
                Resolved scope · {resolvedDevices.length} device
                {resolvedDevices.length === 1 ? '' : 's'}
              </h3>
              {scopeGroups.map((customer) => (
                <div
                  key={customer.customerId}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3"
                >
                  <div className="font-semibold">{customer.customerName}</div>
                  <div className="mt-3 space-y-3">
                    {customer.sites.map((site) => (
                      <div key={site.siteId ?? 'no-site'}>
                        <div className="text-sm font-semibold">
                          {site.siteName}
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {site.deviceTypes.map((deviceType) => (
                            <div
                              key={deviceType.deviceTypeId}
                              className="rounded border border-[var(--border)] bg-[var(--surface)] p-3"
                            >
                              <div className="flex justify-between gap-3 text-sm">
                                <span className="font-semibold">
                                  {deviceType.deviceTypeName}
                                </span>
                                <span>{deviceType.count}</span>
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">
                                {deviceType.models
                                  .map(
                                    (model) =>
                                      `${model.modelName} × ${model.count}`,
                                  )
                                  .join(' · ')}
                              </div>
                              <details className="mt-2 text-xs">
                                <summary className="cursor-pointer text-[var(--accent-light)]">
                                  Review devices
                                </summary>
                                <ul className="mt-2 space-y-1 text-[var(--muted-strong)]">
                                  {deviceType.devices.map((device) => (
                                    <li key={device.id}>{device.name}</li>
                                  ))}
                                </ul>
                              </details>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-4 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4">
              <div>
                <h3 className="font-semibold">Authoritative plan preview</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  This is the existing confirmation-token preview. It snapshots
                  exact selected devices and remains invalidated by relevant
                  inventory, policy, exception, compatibility or planning
                  changes.
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
                      {labelValue(key)}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-sm font-semibold">
                  Current → exact intended firmware
                </h4>
                <div className="mt-2 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] uppercase tracking-[0.08em] text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">Customer / site</th>
                        <th className="px-3 py-2">Model</th>
                        <th className="px-3 py-2">Current</th>
                        <th className="px-3 py-2">Target</th>
                        <th className="px-3 py-2">Disposition</th>
                        <th className="px-3 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {previewGroups.map((group) => (
                        <tr
                          key={JSON.stringify([
                            group.customerId,
                            group.siteId,
                            group.modelName,
                            group.observedVersion,
                            group.targetVersion,
                            group.disposition,
                          ])}
                        >
                          <td className="px-3 py-2">
                            {group.customerName}
                            <div className="text-[var(--muted)]">
                              {group.siteName}
                            </div>
                          </td>
                          <td className="px-3 py-2">{group.modelName}</td>
                          <td className="px-3 py-2 font-mono">
                            {group.observedVersion}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {group.targetVersion}
                          </td>
                          <td className="px-3 py-2">
                            {dispositionLabel[group.disposition]}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {group.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold">
                  Exact target distribution
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

              <details className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                  Review devices, exclusions and exceptions (
                  {preview.targets.length})
                </summary>
                <div className="overflow-x-auto border-t border-[var(--border)]">
                  <table className="w-full min-w-[1100px] text-left text-xs">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-raised)] uppercase tracking-[0.08em] text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">Device</th>
                        <th className="px-3 py-2">Disposition</th>
                        <th className="px-3 py-2">Current → target</th>
                        <th className="px-3 py-2">Exception evidence</th>
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
                              <Link
                                href={`/planning/${target.activePlanId}`}
                                className="mt-1 inline-block text-[var(--accent-light)] hover:underline"
                              >
                                Open active plan
                              </Link>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {target.observedFirmwareVersion ?? 'Unknown'} →{' '}
                            {target.targetVersion ?? 'Unresolved'}
                            {target.targetPlatform
                              ? ` · ${target.targetPlatform}`
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
                                {target.disposition === 'ACTIVE_EXCEPTION' ||
                                target.exceptionOverride ? (
                                  <label className="mt-2 flex items-start gap-2">
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
                                                (id) =>
                                                  id !== target.deviceId,
                                              ),
                                        )
                                        setPreviewDirty(true)
                                      }}
                                    />
                                    <span>
                                      Explicitly override this active exception
                                      for this device in this plan
                                    </span>
                                  </label>
                                ) : null}
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
              </details>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => void createPlan()}
                  disabled={
                    busy || previewDirty || preview.counts.included < 1
                  }
                >
                  Confirm preview and create plan
                </Button>
                <span className="text-xs text-[var(--muted)]">
                  Successful creation opens the persistent plan workspace.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </PlanningSection>
    </div>
  )
}
