import { prisma } from '@/lib/prisma'
import { listDeviceReferences, listDevices } from '@/lib/device-store'
import { resolveTechnicalFirmwareState } from '@/lib/firmware-state'
import type { DeviceFirmwareReference, DeviceRecord } from '@/lib/devices'
import type {
  DeviceGroupBy,
  DeviceQuery,
  DeviceQueryGroup,
  DeviceQueryPayload,
  DeviceQueryRecord,
  DeviceQueryReferenceData,
  DeviceSortField,
} from '@/lib/device-query'

const MODEL_POLICY_SCOPE = {
  isActive: true,
  customerId: null,
  contractTypeId: null,
  deviceId: null,
  vendorId: null,
  deviceTypeId: null,
} as const

const desiredReleaseSelect = {
  id: true,
  vendorId: true,
  platform: true,
  version: true,
  status: true,
  isActive: true,
  firmwareTrain: { select: { id: true, name: true } },
} as const

function normalize(value: string | null | undefined) {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

function uniqueReferences<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function buildQueryReferences(references: Awaited<ReturnType<typeof listDeviceReferences>>): DeviceQueryReferenceData {
  const vendors = uniqueReferences(references.models.map((model) => model.vendor)).sort((a, b) => a.name.localeCompare(b.name))
  const deviceTypes = uniqueReferences(references.models.map((model) => model.deviceType)).sort((a, b) => a.name.localeCompare(b.name))
  const contractTypes = uniqueReferences([
    ...references.customers.flatMap((customer) => customer.contractType ? [customer.contractType] : []),
    ...references.sites.flatMap((site) => site.contractType ? [site.contractType] : []),
  ]).sort((a, b) => a.name.localeCompare(b.name))
  return { ...references, vendors, deviceTypes, contractTypes }
}

async function resolveDesiredFirmware(records: DeviceRecord[]) {
  const modelIds = [...new Set(records.map((record) => record.deviceModelId))]
  if (modelIds.length === 0) return new Map<string, DeviceFirmwareReference>()

  const policies = await prisma.firmwarePolicy.findMany({
    where: {
      ...MODEL_POLICY_SCOPE,
      deviceModelId: { in: modelIds },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      deviceModelId: true,
      targetFirmwareRelease: { select: desiredReleaseSelect },
    },
  })

  const desiredByModel = new Map<string, DeviceFirmwareReference>()
  for (const policy of policies) {
    if (!policy.deviceModelId || desiredByModel.has(policy.deviceModelId)) continue
    desiredByModel.set(policy.deviceModelId, policy.targetFirmwareRelease)
  }
  return desiredByModel
}

function matchesSearch(record: DeviceQueryRecord, q: string) {
  const needle = normalize(q)
  if (!needle) return true
  return normalize([
    record.name,
    record.hostname ?? '',
    record.serialNumber ?? '',
    record.managementAddress ?? '',
    record.customer.name,
    record.site?.name ?? '',
    record.site?.code ?? '',
    record.deviceModel.vendor.name,
    record.deviceModel.model,
    record.deviceModel.deviceType.name,
    record.currentFirmwareRelease?.version ?? '',
    record.desiredFirmwareRelease?.version ?? '',
    record.effectiveContractType?.name ?? '',
    record.technicalState,
    record.lifecycle?.state ?? 'UNDECIDED',
    record.source,
  ].join(' ')).includes(needle)
}

function matchesQuery(record: DeviceQueryRecord, query: DeviceQuery) {
  if (query.archive === 'active' && !record.isActive) return false
  if (query.archive === 'archived' && record.isActive) return false
  if (query.customer && record.customerId !== query.customer) return false
  if (query.site === 'none' && record.siteId !== null) return false
  if (query.site && query.site !== 'none' && record.siteId !== query.site) return false
  if (query.vendor && record.deviceModel.vendor.id !== query.vendor) return false
  if (query.model && record.deviceModelId !== query.model) return false
  if (query.deviceType && record.deviceModel.deviceType.id !== query.deviceType) return false
  if (query.contract === 'none' && record.effectiveContractType !== null) return false
  if (query.contract && query.contract !== 'none' && record.effectiveContractType?.id !== query.contract) return false
  if (query.currentFirmware === 'none' && record.currentFirmwareReleaseId !== null) return false
  if (query.currentFirmware && query.currentFirmware !== 'none' && record.currentFirmwareReleaseId !== query.currentFirmware) return false
  if (query.desiredFirmware === 'none' && record.desiredFirmwareRelease !== null) return false
  if (query.desiredFirmware && query.desiredFirmware !== 'none' && record.desiredFirmwareRelease?.id !== query.desiredFirmware) return false
  if (query.technicalState && record.technicalState !== query.technicalState) return false
  if (query.workflow === 'UNDECIDED' && record.lifecycle !== null) return false
  if (query.workflow && query.workflow !== 'UNDECIDED' && record.lifecycle?.state !== query.workflow) return false
  if (query.source && record.source !== query.source) return false
  return matchesSearch(record, query.q)
}

function groupFor(record: DeviceQueryRecord, groupBy: DeviceGroupBy) {
  switch (groupBy) {
    case 'customer':
      return { key: record.customer.id, label: record.customer.name }
    case 'site':
      return record.site ? { key: record.site.id, label: record.site.name } : { key: 'none', label: 'Unassigned site' }
    case 'deviceType':
      return { key: record.deviceModel.deviceType.id, label: record.deviceModel.deviceType.name }
    case 'model':
      return { key: record.deviceModel.id, label: `${record.deviceModel.vendor.name} · ${record.deviceModel.model}` }
    case 'none':
      return null
  }
}

function sortValue(record: DeviceQueryRecord, field: DeviceSortField) {
  switch (field) {
    case 'customer': return record.customer.name
    case 'site': return record.site?.name ?? ''
    case 'vendor': return record.deviceModel.vendor.name
    case 'model': return record.deviceModel.model
    case 'deviceType': return record.deviceModel.deviceType.name
    case 'name': return record.name
    case 'currentFirmware': return record.currentFirmwareRelease?.version ?? ''
    case 'desiredFirmware': return record.desiredFirmwareRelease?.version ?? ''
    case 'technicalState': return record.technicalState
    case 'workflow': return record.lifecycle?.state ?? 'UNDECIDED'
    case 'source': return record.source
  }
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })
}

function sortRecords(records: DeviceQueryRecord[], query: DeviceQuery) {
  const direction = query.direction === 'desc' ? -1 : 1
  return records.sort((a, b) => {
    if (query.groupBy !== 'none') {
      const groupA = a.groupLabel ?? ''
      const groupB = b.groupLabel ?? ''
      const groupCompare = compareText(groupA, groupB)
      if (groupCompare !== 0) return groupCompare
    }

    const selectedCompare = compareText(sortValue(a, query.sort), sortValue(b, query.sort))
    if (selectedCompare !== 0) return selectedCompare * direction

    const customerCompare = compareText(a.customer.name, b.customer.name)
    if (customerCompare !== 0) return customerCompare
    const nameCompare = compareText(a.name, b.name)
    if (nameCompare !== 0) return nameCompare
    return a.id.localeCompare(b.id)
  })
}

function aggregateGroups(records: DeviceQueryRecord[], groupBy: DeviceGroupBy): DeviceQueryGroup[] {
  if (groupBy === 'none') return []
  const groups = new Map<string, DeviceQueryGroup>()
  for (const record of records) {
    const group = groupFor(record, groupBy)
    if (!group) continue
    const current = groups.get(group.key)
    if (current) current.count += 1
    else groups.set(group.key, { ...group, count: 1 })
  }
  return [...groups.values()].sort((a, b) => compareText(a.label, b.label))
}

export async function queryDevices(query: DeviceQuery): Promise<DeviceQueryPayload> {
  const [records, baseReferences] = await Promise.all([listDevices(), listDeviceReferences()])
  const desiredByModel = await resolveDesiredFirmware(records)
  const references = buildQueryReferences(baseReferences)

  const enriched: DeviceQueryRecord[] = records.map((record) => {
    const desiredFirmwareRelease = desiredByModel.get(record.deviceModelId) ?? null
    const technicalState = resolveTechnicalFirmwareState({
      currentFirmwareReleaseId: record.currentFirmwareReleaseId,
      desiredFirmwareReleaseId: desiredFirmwareRelease?.id,
    })
    const group = groupFor({ ...record, desiredFirmwareRelease, technicalState, groupKey: null, groupLabel: null }, query.groupBy)
    return {
      ...record,
      desiredFirmwareRelease,
      technicalState,
      groupKey: group?.key ?? null,
      groupLabel: group?.label ?? null,
    }
  })

  const filtered = enriched.filter((record) => matchesQuery(record, query))
  const groups = aggregateGroups(filtered, query.groupBy)
  sortRecords(filtered, query)

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, totalPages)
  const offset = (page - 1) * query.pageSize
  const data = filtered.slice(offset, offset + query.pageSize)

  return {
    data,
    meta: {
      ...references,
      query: { ...query, page },
      pagination: {
        page,
        pageSize: query.pageSize,
        total,
        totalPages,
        inventoryTotal: records.length,
      },
      groups,
    },
  }
}
