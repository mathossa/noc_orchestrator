import { listDevices } from '@/lib/device-store'
import {
  emptyTechnicalFirmwareStateCounts,
  incrementTechnicalFirmwareStateCount,
  resolveTechnicalFirmwareState,
  type TechnicalFirmwareState,
} from '@/lib/firmware-state'
import { prisma } from '@/lib/prisma'
import type {
  DashboardCustomerAttentionRow,
  DashboardDimensionAttentionRow,
  DashboardFirmwareAttentionRow,
  DashboardSiteAttentionRow,
  DashboardWorkflowCounts,
  DashboardWorkflowState,
  FirmwareLifecycleDashboard,
} from '@/lib/dashboard'

const MODEL_POLICY_SCOPE = {
  isActive: true,
  customerId: null,
  contractTypeId: null,
  deviceId: null,
  vendorId: null,
  deviceTypeId: null,
} as const

type PriorityCounts = {
  actionRequired: number
  unknown: number
  noPolicy: number
}

type SiteBucket = PriorityCounts & {
  id: string | null
  name: string
}

type CustomerBucket = PriorityCounts & {
  id: string
  name: string
  sites: Map<string, SiteBucket>
}

type DimensionBucket = DashboardDimensionAttentionRow

function emptyWorkflowCounts(): DashboardWorkflowCounts {
  return {
    planned: 0,
    ignored: 0,
    customerDeclined: 0,
    done: 0,
    undecided: 0,
  }
}

function emptyPriorityCounts(): PriorityCounts {
  return { actionRequired: 0, unknown: 0, noPolicy: 0 }
}

function incrementWorkflow(counts: DashboardWorkflowCounts, state: DashboardWorkflowState | null) {
  switch (state) {
    case 'PLANNED':
      counts.planned += 1
      break
    case 'IGNORED':
      counts.ignored += 1
      break
    case 'CUSTOMER_DECLINED':
      counts.customerDeclined += 1
      break
    case 'DONE':
      counts.done += 1
      break
    default:
      counts.undecided += 1
      break
  }
}

function incrementPriority(counts: PriorityCounts, state: TechnicalFirmwareState) {
  switch (state) {
    case 'ACTION_REQUIRED':
      counts.actionRequired += 1
      break
    case 'UNKNOWN':
      counts.unknown += 1
      break
    case 'NO_POLICY':
      counts.noPolicy += 1
      break
    case 'CURRENT':
      break
  }
}

function priorityScore(row: PriorityCounts) {
  return row.actionRequired * 1_000_000 + row.unknown * 1_000 + row.noPolicy
}

function hasPriorityAttention(row: PriorityCounts) {
  return row.actionRequired > 0 || row.unknown > 0 || row.noPolicy > 0
}

function sortPriorityRows<T extends PriorityCounts & { name: string }>(rows: T[]) {
  return rows.sort(
    (a, b) =>
      priorityScore(b) - priorityScore(a) ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }),
  )
}

function customerRows(buckets: Map<string, CustomerBucket>): DashboardCustomerAttentionRow[] {
  return sortPriorityRows([...buckets.values()].filter(hasPriorityAttention))
    .slice(0, 8)
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
      actionRequired: customer.actionRequired,
      unknown: customer.unknown,
      noPolicy: customer.noPolicy,
      sites: sortPriorityRows([...customer.sites.values()].filter(hasPriorityAttention)).map(
        (site): DashboardSiteAttentionRow => ({
          id: site.id,
          name: site.name,
          actionRequired: site.actionRequired,
          unknown: site.unknown,
          noPolicy: site.noPolicy,
        }),
      ),
    }))
}

function ensureCustomerBucket(buckets: Map<string, CustomerBucket>, id: string, name: string) {
  const existing = buckets.get(id)
  if (existing) return existing
  const created: CustomerBucket = { id, name, ...emptyPriorityCounts(), sites: new Map() }
  buckets.set(id, created)
  return created
}

function ensureSiteBucket(customer: CustomerBucket, id: string | null, name: string) {
  const key = id ?? 'none'
  const existing = customer.sites.get(key)
  if (existing) return existing
  const created: SiteBucket = { id, name, ...emptyPriorityCounts() }
  customer.sites.set(key, created)
  return created
}

function ensureDimensionBucket(
  buckets: Map<string, DimensionBucket>,
  key: string,
  id: string | null,
  name: string,
) {
  const existing = buckets.get(key)
  if (existing) return existing
  const created: DimensionBucket = {
    id,
    name,
    devices: 0,
    actionRequired: 0,
    unknown: 0,
    noPolicy: 0,
    blocked: 0,
  }
  buckets.set(key, created)
  return created
}

function dimensionRows(buckets: Map<string, DimensionBucket>) {
  return sortPriorityRows(
    [...buckets.values()].filter(
      (row) => hasPriorityAttention(row) || row.blocked > 0,
    ),
  ).sort(
    (a, b) =>
      priorityScore(b) - priorityScore(a) ||
      b.blocked - a.blocked ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }),
  )
}

export async function getFirmwareLifecycleDashboard(): Promise<FirmwareLifecycleDashboard> {
  const allDevices = await listDevices()
  const devices = allDevices.filter((device) => device.isActive)
  const modelIds = [...new Set(devices.map((device) => device.deviceModelId))]
  const policies = modelIds.length
    ? await prisma.firmwarePolicy.findMany({
        where: {
          ...MODEL_POLICY_SCOPE,
          deviceModelId: { in: modelIds },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          deviceModelId: true,
          targetFirmwareReleaseId: true,
        },
      })
    : []

  const desiredByModel = new Map<string, string>()
  for (const policy of policies) {
    if (!policy.deviceModelId || desiredByModel.has(policy.deviceModelId)) continue
    desiredByModel.set(policy.deviceModelId, policy.targetFirmwareReleaseId)
  }

  const technical = emptyTechnicalFirmwareStateCounts()
  const workflow = emptyWorkflowCounts()
  const customers = new Map<string, CustomerBucket>()
  const contracts = new Map<string, DimensionBucket>()
  const vendors = new Map<string, DimensionBucket>()
  const firmware = new Map<string, DashboardFirmwareAttentionRow>()

  for (const device of devices) {
    const state = resolveTechnicalFirmwareState({
      currentFirmwareReleaseId: device.currentFirmwareReleaseId,
      desiredFirmwareReleaseId: desiredByModel.get(device.deviceModelId),
    })
    incrementTechnicalFirmwareStateCount(technical, state)
    incrementWorkflow(workflow, device.lifecycle?.state ?? null)

    const customer = ensureCustomerBucket(customers, device.customer.id, device.customer.name)
    incrementPriority(customer, state)
    const site = ensureSiteBucket(customer, device.site?.id ?? null, device.site?.name ?? 'Unassigned site')
    incrementPriority(site, state)

    const contract = ensureDimensionBucket(
      contracts,
      device.effectiveContractType?.id ?? 'none',
      device.effectiveContractType?.id ?? null,
      device.effectiveContractType?.name ?? 'No contract',
    )
    contract.devices += 1
    incrementPriority(contract, state)

    const vendor = ensureDimensionBucket(
      vendors,
      device.deviceModel.vendor.id,
      device.deviceModel.vendor.id,
      device.deviceModel.vendor.name,
    )
    vendor.devices += 1
    incrementPriority(vendor, state)

    const blocked = device.currentFirmwareRelease?.status.toUpperCase() === 'BLOCKED'
    if (blocked) {
      contract.blocked += 1
      vendor.blocked += 1
    }

    if (device.currentFirmwareRelease && (state === 'ACTION_REQUIRED' || blocked)) {
      const release = device.currentFirmwareRelease
      const existing = firmware.get(release.id)
      if (existing) {
        existing.devices += 1
        if (state === 'ACTION_REQUIRED') existing.actionRequired += 1
        if (blocked) existing.blocked += 1
      } else {
        firmware.set(release.id, {
          id: release.id,
          version: release.version,
          vendor: device.deviceModel.vendor.name,
          platform: release.platform,
          status: release.status,
          devices: 1,
          actionRequired: state === 'ACTION_REQUIRED' ? 1 : 0,
          blocked: blocked ? 1 : 0,
        })
      }
    }
  }

  return {
    activeDevices: devices.length,
    technical,
    workflow,
    customerAttention: customerRows(customers),
    contractAttention: dimensionRows(contracts),
    vendorAttention: dimensionRows(vendors),
    firmwareAttention: [...firmware.values()]
      .sort(
        (a, b) =>
          b.blocked - a.blocked ||
          b.actionRequired - a.actionRequired ||
          b.devices - a.devices ||
          a.vendor.localeCompare(b.vendor, 'en', { sensitivity: 'base' }) ||
          a.version.localeCompare(b.version, 'en', { sensitivity: 'base', numeric: true }),
      )
      .slice(0, 10),
  }
}
