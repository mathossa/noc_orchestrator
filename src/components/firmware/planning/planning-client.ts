import type { FirmwareWorkPlanState } from '@/lib/firmware-work-planning'

export type ClientError = Error & { status?: number; code?: string }

export type PlanSummary = {
  id: string
  state: FirmwareWorkPlanState
  title: string | null
  reason: string | null
  notes: string | null
  upgradeCapability: string
  createdAt: string
  updatedAt: string
  proposedFor: string | null
  proposedMaintenanceWindowReference: string | null
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

export type PlanTarget = {
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

export type PlanEvent = {
  id: string
  fromState: string | null
  toState: string
  actorUserId: string | null
  reason: string | null
  notes: string | null
  createdAt: string
  metadata: unknown
}

export type PlanDetail = PlanSummary & {
  events: PlanEvent[]
  targets: PlanTarget[]
}

export type PlanListResponse = {
  data: PlanSummary[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type DeviceTypeReference = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export type PlanningCandidateDevice = {
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
    deviceType: DeviceTypeReference
  }
  currentFirmwareRelease: { id: string; version: string } | null
  currentFirmwareNormalizedVersion: string | null
  currentFirmwareRawVersion: string | null
}

export type DeviceChoice = PlanningCandidateDevice & {
  firmwareCompliance: { recommendation: string; explanation?: string }
}

export type DeviceReferences = {
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
    deviceType: DeviceTypeReference
    isActive: boolean
  }>
  vendors: Array<{ id: string; name: string; isActive: boolean }>
  deviceTypes: DeviceTypeReference[]
}

export type DevicePayload = {
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

export type PreviewTarget = {
  deviceId: string
  deviceName: string
  customerId: string
  customerName: string
  siteId: string | null
  siteName: string | null
  deviceModelId: string
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

export type PlanPreview = {
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

export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
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

export function labelValue(value: string) {
  return value.toLowerCase().replaceAll('_', ' ')
}

export function dateTime(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value
}

export function dateTimeLocalToIso(value: string) {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw new Error('Choose a valid local date and time.')
  return parsed.toISOString()
}

export function toLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return ''
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export function toggleSelection(values: string[], id: string) {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id]
}

export function toggleDeviceRecord<T extends { id: string }>(
  current: Record<string, T>,
  device: T,
) {
  const next = { ...current }
  if (next[device.id]) delete next[device.id]
  else next[device.id] = device
  return next
}

export function canConfirmProposedSchedule(
  state: FirmwareWorkPlanState,
  proposedFor: string | null,
) {
  return (
    Boolean(proposedFor) &&
    (state === 'AWAITING_CUSTOMER' || state === 'APPROVED')
  )
}

function commonTypeText(type: DeviceTypeReference) {
  return `${type.code} ${type.name}`.normalize('NFKC').toLowerCase()
}

export function commonSwitchAndAccessPointTypeIds(
  types: DeviceTypeReference[],
) {
  return types
    .filter((type) => {
      const value = commonTypeText(type)
      const switchLike = /(^|\W)switch(?:es|ing)?(\W|$)/.test(value)
      const accessPointLike =
        /access\s*point/.test(value) ||
        /wireless\s*access/.test(value) ||
        /(^|\W)ap(\W|$)/.test(value)
      return switchLike || accessPointLike
    })
    .map((type) => type.id)
}

export async function resolveSiteScopeDevices(
  siteIds: string[],
  deviceTypeIds: string[],
  requester: JsonRequester = requestJson,
) {
  const payload = await requester<{ data: PlanningCandidateDevice[] }>(
    '/api/v1/firmware-work-plans/candidates',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteIds, deviceTypeIds }),
    },
  )
  return [...payload.data].sort(
    (a, b) =>
      a.customer.name.localeCompare(b.customer.name) ||
      (a.site?.name ?? '').localeCompare(b.site?.name ?? '') ||
      a.deviceModel.deviceType.name.localeCompare(
        b.deviceModel.deviceType.name,
      ) ||
      a.deviceModel.model.localeCompare(b.deviceModel.model) ||
      a.name.localeCompare(b.name),
  )
}

export type ScopeDeviceGroup = {
  customerId: string
  customerName: string
  sites: Array<{
    siteId: string | null
    siteName: string
    deviceTypes: Array<{
      deviceTypeId: string
      deviceTypeName: string
      count: number
      models: Array<{ modelId: string; modelName: string; count: number }>
      devices: PlanningCandidateDevice[]
    }>
  }>
}

export function groupScopeDevices(
  devices: PlanningCandidateDevice[],
): ScopeDeviceGroup[] {
  const customers = new Map<
    string,
    {
      customerId: string
      customerName: string
      sites: Map<
        string,
        {
          siteId: string | null
          siteName: string
          deviceTypes: Map<
            string,
            {
              deviceTypeId: string
              deviceTypeName: string
              devices: PlanningCandidateDevice[]
            }
          >
        }
      >
    }
  >()

  for (const device of devices) {
    let customer = customers.get(device.customer.id)
    if (!customer) {
      customer = {
        customerId: device.customer.id,
        customerName: device.customer.name,
        sites: new Map(),
      }
      customers.set(device.customer.id, customer)
    }
    const siteKey = device.site?.id ?? 'no-site'
    let site = customer.sites.get(siteKey)
    if (!site) {
      site = {
        siteId: device.site?.id ?? null,
        siteName: device.site?.name ?? 'No site',
        deviceTypes: new Map(),
      }
      customer.sites.set(siteKey, site)
    }
    const type = device.deviceModel.deviceType
    let deviceType = site.deviceTypes.get(type.id)
    if (!deviceType) {
      deviceType = {
        deviceTypeId: type.id,
        deviceTypeName: type.name,
        devices: [],
      }
      site.deviceTypes.set(type.id, deviceType)
    }
    deviceType.devices.push(device)
  }

  return [...customers.values()]
    .sort((a, b) => a.customerName.localeCompare(b.customerName))
    .map((customer) => ({
      customerId: customer.customerId,
      customerName: customer.customerName,
      sites: [...customer.sites.values()]
        .sort((a, b) => a.siteName.localeCompare(b.siteName))
        .map((site) => ({
          siteId: site.siteId,
          siteName: site.siteName,
          deviceTypes: [...site.deviceTypes.values()]
            .sort((a, b) =>
              a.deviceTypeName.localeCompare(b.deviceTypeName),
            )
            .map((deviceType) => {
              const modelCounts = new Map<
                string,
                { modelId: string; modelName: string; count: number }
              >()
              for (const device of deviceType.devices) {
                const current = modelCounts.get(device.deviceModel.id)
                if (current) current.count += 1
                else
                  modelCounts.set(device.deviceModel.id, {
                    modelId: device.deviceModel.id,
                    modelName: device.deviceModel.model,
                    count: 1,
                  })
              }
              return {
                ...deviceType,
                count: deviceType.devices.length,
                models: [...modelCounts.values()].sort((a, b) =>
                  a.modelName.localeCompare(b.modelName),
                ),
              }
            }),
        })),
    }))
}

export type PreviewGroup = {
  customerId: string
  customerName: string
  siteId: string | null
  siteName: string
  modelName: string
  observedVersion: string
  targetVersion: string
  disposition: PreviewTarget['disposition']
  count: number
}

export function groupPreviewTargets(targets: PreviewTarget[]): PreviewGroup[] {
  const groups = new Map<string, PreviewGroup>()
  for (const target of targets) {
    const value: PreviewGroup = {
      customerId: target.customerId,
      customerName: target.customerName,
      siteId: target.siteId,
      siteName: target.siteName ?? 'No site',
      modelName: target.deviceModelName,
      observedVersion: target.observedFirmwareVersion ?? 'Unknown',
      targetVersion: target.targetVersion ?? 'Unresolved',
      disposition: target.disposition,
      count: 1,
    }
    const key = JSON.stringify([
      value.customerId,
      value.siteId,
      value.modelName,
      value.observedVersion,
      value.targetVersion,
      value.disposition,
    ])
    const current = groups.get(key)
    if (current) current.count += 1
    else groups.set(key, value)
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.customerName.localeCompare(b.customerName) ||
      a.siteName.localeCompare(b.siteName) ||
      a.modelName.localeCompare(b.modelName) ||
      a.targetVersion.localeCompare(b.targetVersion),
  )
}

export type PlanTargetGroup = {
  customerId: string
  customerName: string
  siteId: string | null
  siteName: string
  modelName: string
  observedVersion: string
  targetVersion: string
  targetPlatform: string
  targetVariant: string | null
  targetImageCode: string | null
  count: number
  targets: PlanTarget[]
}

export function groupPlanTargets(targets: PlanTarget[]): PlanTargetGroup[] {
  const groups = new Map<string, PlanTargetGroup>()
  for (const target of targets) {
    const snapshot = target.snapshot
    const value: PlanTargetGroup = {
      customerId: snapshot.customerId,
      customerName: snapshot.customerName,
      siteId: snapshot.siteId,
      siteName: snapshot.siteName ?? 'No site',
      modelName: snapshot.deviceModelName,
      observedVersion:
        snapshot.observedFirmwareVersion ??
        snapshot.observedFirmwareRawVersion ??
        'Unknown',
      targetVersion: snapshot.targetVersion,
      targetPlatform: snapshot.targetPlatform,
      targetVariant: snapshot.targetVariant,
      targetImageCode: snapshot.targetImageCode,
      count: 1,
      targets: [target],
    }
    const key = JSON.stringify([
      value.customerId,
      value.siteId,
      value.modelName,
      value.observedVersion,
      value.targetVersion,
      value.targetPlatform,
      value.targetVariant,
      value.targetImageCode,
    ])
    const current = groups.get(key)
    if (current) {
      current.count += 1
      current.targets.push(target)
    } else groups.set(key, value)
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.customerName.localeCompare(b.customerName) ||
      a.siteName.localeCompare(b.siteName) ||
      a.modelName.localeCompare(b.modelName) ||
      a.targetVersion.localeCompare(b.targetVersion),
  )
}
