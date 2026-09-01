import { AUDIT_ACTIONS } from '@/lib/audit-events'
import { listDevices } from '@/lib/device-store'
import {
  emptyTechnicalFirmwareStateCounts,
  incrementTechnicalFirmwareStateCount,
  resolveTechnicalFirmwareState,
} from '@/lib/firmware-state'
import { prisma } from '@/lib/prisma'
import type {
  DashboardAttentionRow,
  DashboardFirmwareDistributionRow,
  DashboardRecentDecision,
  DashboardTechnicalCounts,
  DashboardVendorComplianceRow,
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

const LIFECYCLE_AUDIT_ACTIONS = [
  AUDIT_ACTIONS.lifecyclePlanned,
  AUDIT_ACTIONS.lifecycleIgnored,
  AUDIT_ACTIONS.lifecycleCustomerDeclined,
  AUDIT_ACTIONS.lifecycleDone,
] as const

type TechnicalBucket = DashboardTechnicalCounts & { devices: number }

type AttentionBucket = TechnicalBucket & {
  id: string
  name: string
  context: string
}

type VendorBucket = TechnicalBucket & {
  id: string
  name: string
}

function emptyWorkflowCounts(): DashboardWorkflowCounts {
  return {
    planned: 0,
    ignored: 0,
    customerDeclined: 0,
    done: 0,
    undecided: 0,
  }
}

function createTechnicalBucket(): TechnicalBucket {
  return {
    devices: 0,
    ...emptyTechnicalFirmwareStateCounts(),
  }
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

function ensureAttentionBucket(
  buckets: Map<string, AttentionBucket>,
  id: string,
  name: string,
  context: string,
) {
  const existing = buckets.get(id)
  if (existing) return existing
  const created = { id, name, context, ...createTechnicalBucket() }
  buckets.set(id, created)
  return created
}

function ensureVendorBucket(buckets: Map<string, VendorBucket>, id: string, name: string) {
  const existing = buckets.get(id)
  if (existing) return existing
  const created = { id, name, ...createTechnicalBucket() }
  buckets.set(id, created)
  return created
}

function recordTechnicalState(bucket: TechnicalBucket, state: Parameters<typeof incrementTechnicalFirmwareStateCount>[1]) {
  bucket.devices += 1
  incrementTechnicalFirmwareStateCount(bucket, state)
}

function attentionRows(buckets: Map<string, AttentionBucket>): DashboardAttentionRow[] {
  return [...buckets.values()]
    .filter((row) => row.actionRequired > 0)
    .sort((a, b) =>
      b.actionRequired - a.actionRequired ||
      b.devices - a.devices ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }),
    )
    .slice(0, 8)
    .map(({ id, name, context, devices, current, actionRequired, unknown, noPolicy }) => ({
      id,
      name,
      context,
      devices,
      current,
      actionRequired,
      unknown,
      noPolicy,
    }))
}

function vendorRows(buckets: Map<string, VendorBucket>): DashboardVendorComplianceRow[] {
  return [...buckets.values()]
    .sort((a, b) =>
      b.actionRequired - a.actionRequired ||
      b.devices - a.devices ||
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }),
    )
    .map(({ id, name, devices, current, actionRequired, unknown, noPolicy }) => ({
      id,
      name,
      devices,
      current,
      actionRequired,
      unknown,
      noPolicy,
    }))
}

function objectValue(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function workflowStateFromEvent(action: string, after: unknown): DashboardWorkflowState {
  const state = optionalText(objectValue(after).state)
  if (state === 'PLANNED' || state === 'IGNORED' || state === 'CUSTOMER_DECLINED' || state === 'DONE') {
    return state
  }
  switch (action) {
    case AUDIT_ACTIONS.lifecycleIgnored:
      return 'IGNORED'
    case AUDIT_ACTIONS.lifecycleCustomerDeclined:
      return 'CUSTOMER_DECLINED'
    case AUDIT_ACTIONS.lifecycleDone:
      return 'DONE'
    default:
      return 'PLANNED'
  }
}

export async function getFirmwareLifecycleDashboard(): Promise<FirmwareLifecycleDashboard> {
  const [allDevices, customers, models, vendors, recentEvents] = await Promise.all([
    listDevices(),
    prisma.customer.count({ where: { isActive: true } }),
    prisma.deviceModel.count({ where: { isActive: true } }),
    prisma.vendor.count({ where: { isActive: true } }),
    prisma.auditEvent.findMany({
      where: { action: { in: [...LIFECYCLE_AUDIT_ACTIONS] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        action: true,
        entityId: true,
        after: true,
        createdAt: true,
        actor: { select: { name: true } },
        customer: { select: { id: true, name: true } },
      },
    }),
  ])

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
  const modelBuckets = new Map<string, AttentionBucket>()
  const customerBuckets = new Map<string, AttentionBucket>()
  const vendorBuckets = new Map<string, VendorBucket>()
  const firmwareDistribution = new Map<string, DashboardFirmwareDistributionRow>()

  for (const device of devices) {
    const state = resolveTechnicalFirmwareState({
      currentFirmwareReleaseId: device.currentFirmwareReleaseId,
      desiredFirmwareReleaseId: desiredByModel.get(device.deviceModelId),
    })
    incrementTechnicalFirmwareStateCount(technical, state)
    incrementWorkflow(workflow, device.lifecycle?.state ?? null)

    const model = ensureAttentionBucket(
      modelBuckets,
      device.deviceModel.id,
      device.deviceModel.model,
      `${device.deviceModel.vendor.name} · ${device.deviceModel.deviceType.name}`,
    )
    recordTechnicalState(model, state)

    const customer = ensureAttentionBucket(
      customerBuckets,
      device.customer.id,
      device.customer.name,
      device.customer.code ?? 'Customer',
    )
    recordTechnicalState(customer, state)

    const vendor = ensureVendorBucket(vendorBuckets, device.deviceModel.vendor.id, device.deviceModel.vendor.name)
    recordTechnicalState(vendor, state)

    if (device.currentFirmwareRelease) {
      const current = firmwareDistribution.get(device.currentFirmwareRelease.id)
      if (current) current.devices += 1
      else {
        firmwareDistribution.set(device.currentFirmwareRelease.id, {
          id: device.currentFirmwareRelease.id,
          version: device.currentFirmwareRelease.version,
          vendor: device.deviceModel.vendor.name,
          platform: device.currentFirmwareRelease.platform,
          devices: 1,
        })
      }
    }
  }

  const deviceById = new Map(allDevices.map((device) => [device.id, device]))
  const recentDecisions: DashboardRecentDecision[] = recentEvents.map((event) => {
    const device = deviceById.get(event.entityId)
    const after = objectValue(event.after)
    return {
      id: event.id,
      action: event.action,
      state: workflowStateFromEvent(event.action, event.after),
      deviceId: event.entityId,
      deviceName: device?.name ?? 'Historical device',
      customerId: event.customer?.id ?? device?.customer.id ?? null,
      customerName: event.customer?.name ?? device?.customer.name ?? null,
      actorName: event.actor?.name ?? null,
      reason: optionalText(after.reason),
      notes: optionalText(after.notes),
      createdAt: event.createdAt.toISOString(),
    }
  })

  return {
    inventory: {
      customers,
      devices: devices.length,
      models,
      vendors,
    },
    technical,
    workflow,
    modelsRequiringUpdates: attentionRows(modelBuckets),
    customersRequiringUpdates: attentionRows(customerBuckets),
    complianceByVendor: vendorRows(vendorBuckets),
    currentFirmwareDistribution: [...firmwareDistribution.values()]
      .sort((a, b) =>
        b.devices - a.devices ||
        a.vendor.localeCompare(b.vendor, 'en', { sensitivity: 'base' }) ||
        a.version.localeCompare(b.version, 'en', { sensitivity: 'base', numeric: true }),
      )
      .slice(0, 10),
    recentDecisions,
  }
}
