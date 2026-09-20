'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
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
  type DeviceReferences,
  type PlanningCandidateDevice,
  type PlanPreview,
  commonSwitchAndAccessPointTypeIds,
  dateTimeLocalToIso,
  groupPreviewExceptions,
  groupPreviewTargets,
  groupScopeDevices,
  labelValue,
  planningDeviceTypeOptions,
  requestJson,
  resolveSiteScopeDevices,
  toggleSelection,
} from './planning-client'
import {
  PlanningError,
  PlanningSection,
  PlanningStatus,
} from './planning-ui'

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
  const [references, setReferences] = useState<DeviceReferences | null>(null)
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([])
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([])
  const [selectedDeviceTypeIds, setSelectedDeviceTypeIds] = useState<string[]>(
    [],
  )
  const [resolvedDevices, setResolvedDevices] = useState<PlanningCandidateDevice[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [siteSearch, setSiteSearch] = useState('')
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
  useEffect(() => {
    let active = true
    void Promise.all([
      requestJson<{ data: DeviceReferences['customers'] }>('/api/v1/customers'),
      requestJson<{ data: DeviceReferences['sites'] }>('/api/v1/sites'),
      requestJson<{
        data: DeviceReferences['models']
        references: {
          vendors: DeviceReferences['vendors']
          deviceTypes: DeviceReferences['deviceTypes']
        }
      }>('/api/v1/models'),
    ])
      .then(([customers, sites, models]) => {
        if (!active) return
        setReferences({
          customers: customers.data,
          sites: sites.data,
          models: models.data,
          vendors: models.references.vendors,
          deviceTypes: models.references.deviceTypes,
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

  function resetResolvedScope() {
    setResolvedDevices([])
    setPreview(null)
    setPreviewDirty(false)
    setOverrideIds([])
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
    resetResolvedScope()
  }

  function toggleSite(siteId: string) {
    setSelectedSiteIds((current) => toggleSelection(current, siteId))
    resetResolvedScope()
  }

  function toggleDeviceTypeOption(typeIds: string[]) {
    setSelectedDeviceTypeIds((current) => {
      const selected = typeIds.every((id) => current.includes(id))
      return selected
        ? current.filter((id) => !typeIds.includes(id))
        : [...new Set([...current, ...typeIds])]
    })
    resetResolvedScope()
  }

  function updateCreation<K extends keyof typeof creation>(
    key: K,
    value: (typeof creation)[K],
  ) {
    setCreation((current) => ({ ...current, [key]: value }))
    invalidatePreview()
  }

  const activeCustomers = useMemo(
    () =>
      (references?.customers ?? [])
        .filter((customer) => customer.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [references],
  )

  const visibleCustomers = useMemo(() => {
    const query = customerSearch.trim().toLocaleLowerCase()
    if (!query) return activeCustomers
    return activeCustomers.filter((customer) =>
      customer.name.toLocaleLowerCase().includes(query),
    )
  }, [activeCustomers, customerSearch])

  const customerNameById = useMemo(
    () =>
      new Map(
        (references?.customers ?? []).map((customer) => [
          customer.id,
          customer.name,
        ]),
      ),
    [references],
  )

  const visibleSites = useMemo(() => {
    const query = siteSearch.trim().toLocaleLowerCase()
    return (references?.sites ?? [])
      .filter(
        (site) =>
          site.isActive &&
          selectedCustomerIds.includes(site.customerId) &&
          (!query ||
            site.name.toLocaleLowerCase().includes(query) ||
            (customerNameById.get(site.customerId) ?? '')
              .toLocaleLowerCase()
              .includes(query)),
      )
      .sort(
        (a, b) =>
          (customerNameById.get(a.customerId) ?? '').localeCompare(
            customerNameById.get(b.customerId) ?? '',
          ) || a.name.localeCompare(b.name),
      )
  }, [
    customerNameById,
    references,
    selectedCustomerIds,
    siteSearch,
  ])

  const deviceTypeOptions = useMemo(
    () => planningDeviceTypeOptions(references?.deviceTypes ?? []),
    [references],
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
      deviceTypeOptions
        .filter((option) =>
          option.typeIds.every((id) => selectedDeviceTypeIds.includes(id)),
        )
        .map((option) => option.label),
    [deviceTypeOptions, selectedDeviceTypeIds],
  )

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
    if (!selectedSiteIds.length)
      throw new Error('Select at least one site.')
    if (!selectedDeviceTypeIds.length)
      throw new Error('Select at least one device type.')
    return resolveSiteScopeDevices(selectedSiteIds, selectedDeviceTypeIds)
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
  const exceptionGroups = useMemo(
    () => (preview ? groupPreviewExceptions(preview.targets) : []),
    [preview],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firmware planning"
        title="Create maintenance plan"
        description="Select customers and sites, choose the infrastructure types included in the maintenance, then review the authoritative firmware preview before saving."
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
        description="Planning is site-based. Search and select one or more customers, then choose the sites and infrastructure types for this maintenance."
      >
        {referenceLoading ? (
          <p className="text-sm text-[var(--muted)]">
            Loading customers, sites and device types…
          </p>
        ) : (
          <div className="space-y-6">
            <div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-[260px] flex-1">
                  <FormField
                    label="Customers"
                    htmlFor="planning-customer-search"
                    description={`${selectedCustomerIds.length} selected · ${activeCustomers.length} active`}
                  >
                    <TextInput
                      id="planning-customer-search"
                      value={customerSearch}
                      onChange={(event) => setCustomerSearch(event.target.value)}
                      placeholder="Search customer…"
                    />
                  </FormField>
                </div>
                <Button
                  onClick={() => {
                    const visibleIds = visibleCustomers.map(
                      (customer) => customer.id,
                    )
                    setSelectedCustomerIds((current) => [
                      ...new Set([...current, ...visibleIds]),
                    ])
                    resetResolvedScope()
                  }}
                  disabled={!visibleCustomers.length}
                >
                  Select all matching
                </Button>
              </div>
              <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)]">
                {!visibleCustomers.length ? (
                  <p className="p-3 text-sm text-[var(--muted)]">
                    No customers match this search.
                  </p>
                ) : (
                  visibleCustomers.map((customer) => (
                    <label
                      key={customer.id}
                      className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-sm last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCustomerIds.includes(customer.id)}
                        onChange={() => toggleCustomer(customer.id)}
                      />
                      <span>{customer.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {selectedCustomerIds.length ? (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-[260px] flex-1">
                    <FormField
                      label="Sites"
                      htmlFor="planning-site-search"
                      description={`${selectedSiteIds.length} selected across ${selectedCustomerIds.length} customer${selectedCustomerIds.length === 1 ? '' : 's'}`}
                    >
                      <TextInput
                        id="planning-site-search"
                        value={siteSearch}
                        onChange={(event) => setSiteSearch(event.target.value)}
                        placeholder="Search site or customer…"
                      />
                    </FormField>
                  </div>
                  <Button
                    onClick={() => {
                      const visibleIds = visibleSites.map((site) => site.id)
                      setSelectedSiteIds((current) => [
                        ...new Set([...current, ...visibleIds]),
                      ])
                      resetResolvedScope()
                    }}
                    disabled={!visibleSites.length}
                  >
                    Select all matching
                  </Button>
                </div>
                <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)]">
                  {!visibleSites.length ? (
                    <p className="p-3 text-sm text-[var(--muted)]">
                      No active sites match the selected customers and search.
                    </p>
                  ) : (
                    visibleSites.map((site) => (
                      <label
                        key={site.id}
                        className="grid grid-cols-[auto_1fr] gap-x-3 border-b border-[var(--border)] px-3 py-2 text-sm last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedSiteIds.includes(site.id)}
                          onChange={() => toggleSite(site.id)}
                        />
                        <span>
                          <span className="font-semibold">{site.name}</span>
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {customerNameById.get(site.customerId) ?? 'Unknown customer'}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-[var(--border-strong)] p-4 text-sm text-[var(--muted)]">
                Select at least one customer to search and select sites.
              </p>
            )}

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Device types</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Equivalent Switch/Switches inventory types are grouped for planning.
                    Stack remains separate because its maintenance procedure can differ.
                  </p>
                </div>
                {commonAccessTypeIds.length ? (
                  <Button
                    onClick={() => {
                      setSelectedDeviceTypeIds(commonAccessTypeIds)
                      resetResolvedScope()
                    }}
                  >
                    Select switches + access points
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {deviceTypeOptions.map((option) => (
                  <label
                    key={option.key}
                    className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
                    title={
                      option.sourceLabels.length > 1
                        ? `Inventory types: ${option.sourceLabels.join(', ')}`
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={option.typeIds.every((id) =>
                        selectedDeviceTypeIds.includes(id),
                      )}
                      onChange={() => toggleDeviceTypeOption(option.typeIds)}
                    />
                    {option.label}
                    {option.sourceLabels.length > 1 ? (
                      <span className="text-xs text-[var(--muted)]">
                        ({option.sourceLabels.length} inventory types)
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-sm">
              <div className="font-semibold">Selected site scope</div>
              <div className="mt-1 text-[var(--muted)]">
                {selectedSiteLabels.length
                  ? selectedSiteLabels.map((site) => site.name).join(', ')
                  : 'No sites selected'}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {selectedTypeLabels.length
                  ? selectedTypeLabels.join(', ')
                  : 'No device types selected'}
              </div>
            </div>
          </div>
        )}
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
            description="Browser local time; stored as an explicit instant."
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
        description="Scope resolution uses a narrow server-side candidate query with no client pagination. The resulting explicit device IDs are then passed to the existing #60 preview, which remains authoritative for exceptions, recommendations, compatibility and exact firmware targets."
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

              {exceptionGroups.length ? (
                <div className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">Active exceptions</h4>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Override an exception group once instead of selecting every
                        device individually. Overrides remain explicit per device in
                        the saved plan evidence.
                      </p>
                    </div>
                    {overrideIds.length ? (
                      <Button
                        onClick={() => {
                          setOverrideIds([])
                          setPreviewDirty(true)
                        }}
                      >
                        Clear overrides
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {exceptionGroups.map((group) => {
                      const selectedCount = group.deviceIds.filter((id) =>
                        overrideIds.includes(id),
                      ).length
                      const allSelected = selectedCount === group.count
                      return (
                        <div
                          key={group.key}
                          className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--border)] bg-[var(--surface-raised)] p-3"
                        >
                          <div>
                            <div className="text-sm font-semibold">
                              {group.reason}
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              {group.count} device{group.count === 1 ? '' : 's'} ·{' '}
                              {selectedCount} marked for override
                            </div>
                          </div>
                          <Button
                            onClick={() => {
                              setOverrideIds((current) =>
                                allSelected
                                  ? current.filter(
                                      (id) => !group.deviceIds.includes(id),
                                    )
                                  : [
                                      ...new Set([
                                        ...current,
                                        ...group.deviceIds,
                                      ]),
                                    ],
                              )
                              setPreviewDirty(true)
                            }}
                          >
                            {allSelected
                              ? 'Remove group override'
                              : `Override all ${group.count}`}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                  {previewDirty ? (
                    <p className="mt-3 text-xs font-semibold text-[#f0b574]">
                      Exception overrides changed — run the preview again before
                      creating the plan.
                    </p>
                  ) : null}
                </div>
              ) : null}

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
