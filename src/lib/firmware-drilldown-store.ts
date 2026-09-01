import { prisma } from '@/lib/prisma'
import { listDevices } from '@/lib/device-store'
import {
  emptyTechnicalFirmwareStateCounts,
  incrementTechnicalFirmwareStateCount,
  resolveTechnicalFirmwareState,
} from '@/lib/firmware-state'
import type {
  ContractDrilldownRecord,
  DrilldownFirmwareReference,
  FirmwareSourceSummary,
  FirmwareWorkflowSummary,
  VendorDrilldownRecord,
} from '@/lib/firmware-drilldowns'

const MODEL_POLICY_SCOPE = {
  isActive: true,
  customerId: null,
  contractTypeId: null,
  deviceId: null,
  vendorId: null,
  deviceTypeId: null,
} as const

export class FirmwareDrilldownNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FirmwareDrilldownNotFoundError'
  }
}

function emptyWorkflowCounts(): FirmwareWorkflowSummary {
  return { planned: 0, ignored: 0, customerDeclined: 0, done: 0, undecided: 0 }
}

function sourceSummary(records: Awaited<ReturnType<typeof listDevices>>): FirmwareSourceSummary {
  const summary: FirmwareSourceSummary = { manual: 0, api: 0, import: 0, other: 0, latestSynchronizedAt: null }
  let latest: Date | null = null
  for (const record of records) {
    switch (record.source.toUpperCase()) {
      case 'MANUAL': summary.manual += 1; break
      case 'API': summary.api += 1; break
      case 'IMPORT': summary.import += 1; break
      default: summary.other += 1
    }
    if (record.lastSynchronizedAt) {
      const value = new Date(record.lastSynchronizedAt)
      if (!Number.isNaN(value.getTime()) && (!latest || value > latest)) latest = value
    }
  }
  summary.latestSynchronizedAt = latest?.toISOString() ?? null
  return summary
}

async function loadDesiredByModel(modelIds: string[]) {
  if (modelIds.length === 0) return new Map<string, DrilldownFirmwareReference>()
  const policies = await prisma.firmwarePolicy.findMany({
    where: { ...MODEL_POLICY_SCOPE, deviceModelId: { in: modelIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      deviceModelId: true,
      targetFirmwareRelease: {
        select: { id: true, version: true, platform: true, status: true, isActive: true },
      },
    },
  })
  const result = new Map<string, DrilldownFirmwareReference>()
  for (const policy of policies) {
    if (!policy.deviceModelId || result.has(policy.deviceModelId)) continue
    result.set(policy.deviceModelId, policy.targetFirmwareRelease)
  }
  return result
}

function summarizeLifecycle(
  devices: Awaited<ReturnType<typeof listDevices>>,
  desiredByModel: Map<string, DrilldownFirmwareReference>,
) {
  const technicalStateCounts = emptyTechnicalFirmwareStateCounts()
  const workflowCounts = emptyWorkflowCounts()

  for (const device of devices) {
    const desired = desiredByModel.get(device.deviceModelId)
    incrementTechnicalFirmwareStateCount(
      technicalStateCounts,
      resolveTechnicalFirmwareState({
        currentFirmwareReleaseId: device.currentFirmwareReleaseId,
        desiredFirmwareReleaseId: desired?.id,
      }),
    )
    switch (device.lifecycle?.state) {
      case 'PLANNED': workflowCounts.planned += 1; break
      case 'IGNORED': workflowCounts.ignored += 1; break
      case 'CUSTOMER_DECLINED': workflowCounts.customerDeclined += 1; break
      case 'DONE': workflowCounts.done += 1; break
      default: workflowCounts.undecided += 1
    }
  }

  return { technicalStateCounts, workflowCounts }
}

export async function getVendorDrilldown(id: string): Promise<VendorDrilldownRecord> {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, websiteUrl: true, isActive: true, createdAt: true, updatedAt: true },
  })
  if (!vendor) throw new FirmwareDrilldownNotFoundError('Vendor was not found.')

  const [allDevices, models, releases] = await Promise.all([
    listDevices(),
    prisma.deviceModel.findMany({
      where: { vendorId: id },
      orderBy: [{ isActive: 'desc' }, { model: 'asc' }],
      select: {
        id: true,
        model: true,
        platform: true,
        isActive: true,
        source: true,
        lastSynchronizedAt: true,
        deviceType: { select: { id: true, name: true } },
      },
    }),
    prisma.firmwareRelease.findMany({
      where: { vendorId: id },
      orderBy: [{ isActive: 'desc' }, { platform: 'asc' }, { version: 'asc' }],
      select: {
        id: true,
        platform: true,
        version: true,
        status: true,
        isActive: true,
        source: true,
        lastSynchronizedAt: true,
        firmwareTrain: { select: { id: true, name: true } },
      },
    }),
  ])

  const devices = allDevices.filter((device) => device.deviceModel.vendor.id === id)
  const desiredByModel = await loadDesiredByModel(models.map((model) => model.id))
  const { technicalStateCounts, workflowCounts } = summarizeLifecycle(devices, desiredByModel)

  const deviceCountByModel = new Map<string, number>()
  const currentCountByRelease = new Map<string, number>()
  const desiredCountByRelease = new Map<string, number>()
  for (const device of devices) {
    deviceCountByModel.set(device.deviceModelId, (deviceCountByModel.get(device.deviceModelId) ?? 0) + 1)
    if (device.currentFirmwareReleaseId) {
      currentCountByRelease.set(device.currentFirmwareReleaseId, (currentCountByRelease.get(device.currentFirmwareReleaseId) ?? 0) + 1)
    }
    const desired = desiredByModel.get(device.deviceModelId)
    if (desired) desiredCountByRelease.set(desired.id, (desiredCountByRelease.get(desired.id) ?? 0) + 1)
  }

  return {
    ...vendor,
    createdAt: vendor.createdAt.toISOString(),
    updatedAt: vendor.updatedAt.toISOString(),
    deviceCount: devices.length,
    modelCount: models.length,
    releaseCount: releases.length,
    technicalStateCounts,
    workflowCounts,
    sourceSummary: sourceSummary(devices),
    models: models.map((model) => ({
      ...model,
      lastSynchronizedAt: model.lastSynchronizedAt?.toISOString() ?? null,
      deviceCount: deviceCountByModel.get(model.id) ?? 0,
      desiredFirmwareRelease: desiredByModel.get(model.id) ?? null,
    })),
    releases: releases.map((release) => ({
      ...release,
      lastSynchronizedAt: release.lastSynchronizedAt?.toISOString() ?? null,
      currentDeviceCount: currentCountByRelease.get(release.id) ?? 0,
      desiredDeviceCount: desiredCountByRelease.get(release.id) ?? 0,
    })),
  }
}

export async function getContractDrilldown(id: string): Promise<ContractDrilldownRecord> {
  const contract = await prisma.contractType.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      firmwareManagementEnabled: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { customers: true, sites: true } },
    },
  })
  if (!contract) throw new FirmwareDrilldownNotFoundError('Contract type was not found.')

  const allDevices = await listDevices()
  const devices = allDevices.filter((device) => device.effectiveContractType?.id === id)
  const modelIds = [...new Set(devices.map((device) => device.deviceModelId))]
  const desiredByModel = await loadDesiredByModel(modelIds)
  const { technicalStateCounts, workflowCounts } = summarizeLifecycle(devices, desiredByModel)

  const customerMap = new Map<string, { id: string; name: string; deviceCount: number }>()
  const siteMap = new Map<string, { id: string; name: string; customerId: string; customerName: string; deviceCount: number }>()
  for (const device of devices) {
    const customer = customerMap.get(device.customer.id)
    if (customer) customer.deviceCount += 1
    else customerMap.set(device.customer.id, { id: device.customer.id, name: device.customer.name, deviceCount: 1 })

    if (device.site) {
      const site = siteMap.get(device.site.id)
      if (site) site.deviceCount += 1
      else siteMap.set(device.site.id, {
        id: device.site.id,
        name: device.site.name,
        customerId: device.customer.id,
        customerName: device.customer.name,
        deviceCount: 1,
      })
    }
  }

  return {
    id: contract.id,
    code: contract.code,
    name: contract.name,
    description: contract.description,
    firmwareManagementEnabled: contract.firmwareManagementEnabled,
    isActive: contract.isActive,
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
    defaultCustomerCount: contract._count.customers,
    siteOverrideCount: contract._count.sites,
    effectiveDeviceCount: devices.length,
    technicalStateCounts,
    workflowCounts,
    sourceSummary: sourceSummary(devices),
    customers: [...customerMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sites: [...siteMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
}
