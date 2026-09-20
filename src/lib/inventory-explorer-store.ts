import type { Prisma } from '@/generated/prisma/client'
import { resolveDeviceExceptionSummaries } from '@/lib/device-exception-summary-store'
import {
  type CustomerInventoryModel,
  type DeviceTypeInventoryModel,
  type InventoryCounts,
  type InventoryCustomerRow,
  type InventoryDeviceRow,
  type InventoryDeviceTypeRow,
  type InventoryFilterOptions,
  type InventoryQuery,
  type InventorySiteRow,
  type SiteInventoryModel,
  type InventoryOverviewModel,
} from '@/lib/inventory-explorer'
import {
  deriveInventoryPrimaryStatus,
  type InventoryPrimaryStatus,
  type InventoryPrimaryStatusCode,
} from '@/lib/inventory-status'
import { resolveFirmwareComplianceBatch } from '@/lib/firmware-compliance-store'
import { prisma } from '@/lib/prisma'

type InventoryScope = {
  customerId?: string
  siteId?: string | null
  deviceTypeId?: string
}

type InventoryFact = {
  id: string
  name: string
  customerId: string
  siteId: string | null
  deviceModelId: string
  customer: { id: string; name: string }
  site: { id: string; name: string } | null
  deviceModel: {
    id: string
    model: string
    vendor: { id: string; name: string }
    deviceType: { id: string; name: string }
  }
  status: InventoryPrimaryStatus
  compliance: string
  recommendation: string
  exceptionState: string
  exceptionReason: string | null
}

const factSelect = {
  id: true,
  name: true,
  customerId: true,
  siteId: true,
  deviceModelId: true,
  customer: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  deviceModel: {
    select: {
      id: true,
      model: true,
      vendor: { select: { id: true, name: true } },
      deviceType: { select: { id: true, name: true } },
    },
  },
} as const

const compactDeviceSelect = {
  id: true,
  name: true,
  hostname: true,
  currentFirmwareRawVersion: true,
  currentFirmwareNormalizedVersion: true,
  currentFirmwareRelease: { select: { version: true } },
  customer: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  deviceModel: {
    select: {
      model: true,
      deviceType: { select: { id: true, name: true } },
    },
  },
} as const

function searchWhere(q: string): Prisma.DeviceWhereInput | null {
  if (!q) return null
  return {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { hostname: { contains: q, mode: 'insensitive' } },
      { serialNumber: { contains: q, mode: 'insensitive' } },
      { managementAddress: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { site: { name: { contains: q, mode: 'insensitive' } } },
      { site: { code: { contains: q, mode: 'insensitive' } } },
      { deviceModel: { model: { contains: q, mode: 'insensitive' } } },
      {
        deviceModel: {
          vendor: { name: { contains: q, mode: 'insensitive' } },
        },
      },
      {
        deviceModel: {
          deviceType: { name: { contains: q, mode: 'insensitive' } },
        },
      },
    ],
  }
}

function effectiveContractWhere(contract: string): Prisma.DeviceWhereInput | null {
  if (!contract) return null
  if (contract === 'none') {
    return {
      AND: [
        { customer: { contractTypeId: null } },
        {
          OR: [
            { siteId: null },
            { site: { contractTypeId: null } },
          ],
        },
      ],
    }
  }

  return {
    OR: [
      { site: { contractTypeId: contract } },
      {
        AND: [
          { siteId: null },
          { customer: { contractTypeId: contract } },
        ],
      },
      {
        AND: [
          { site: { contractTypeId: null } },
          { customer: { contractTypeId: contract } },
        ],
      },
    ],
  }
}

function buildDeviceWhere(
  scope: InventoryScope,
  query: InventoryQuery,
): Prisma.DeviceWhereInput {
  const and: Prisma.DeviceWhereInput[] = [{ isActive: true }]

  if (scope.customerId) and.push({ customerId: scope.customerId })
  if (scope.siteId !== undefined) and.push({ siteId: scope.siteId })
  if (scope.deviceTypeId) {
    and.push({ deviceModel: { deviceTypeId: scope.deviceTypeId } })
  }

  if (query.vendor) {
    and.push({ deviceModel: { vendorId: query.vendor } })
  }
  if (query.model) and.push({ deviceModelId: query.model })
  if (query.deviceType && !scope.deviceTypeId) {
    and.push({ deviceModel: { deviceTypeId: query.deviceType } })
  }
  if (query.source) and.push({ source: query.source })

  const contract = effectiveContractWhere(query.contract)
  if (contract) and.push(contract)
  const search = searchWhere(query.q)
  if (search) and.push(search)

  return { AND: and }
}

const INVENTORY_FACT_BATCH_SIZE = 1000

async function resolveFactRows(
  rows: Awaited<ReturnType<typeof prisma.device.findMany>>,
): Promise<InventoryFact[]> {
  if (rows.length === 0) return []

  const typedRows = rows as Array<{
    id: string
    name: string
    customerId: string
    siteId: string | null
    deviceModelId: string
    customer: { id: string; name: string }
    site: { id: string; name: string } | null
    deviceModel: {
      id: string
      model: string
      vendor: { id: string; name: string }
      deviceType: { id: string; name: string }
    }
  }>
  const ids = typedRows.map((row) => row.id)
  const complianceByDevice = await resolveFirmwareComplianceBatch(ids)
  const exceptionByDevice = await resolveDeviceExceptionSummaries(
    typedRows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      siteId: row.siteId,
      deviceModelId: row.deviceModelId,
    })),
    complianceByDevice,
  )

  return typedRows.map((row) => {
    const compliance = complianceByDevice.get(row.id)
    if (!compliance) {
      throw new Error('Firmware compliance result missing for device ' + row.id)
    }
    const exception = exceptionByDevice.get(row.id) ?? {
      state: 'NONE' as const,
      effective: null,
      activeCount: 0,
      inheritedCount: 0,
      historyCount: 0,
      reviewDueAt: null,
    }
    return {
      ...row,
      status: deriveInventoryPrimaryStatus(compliance, exception),
      compliance: compliance.compliance,
      recommendation: compliance.recommendation,
      exceptionState: exception.state,
      exceptionReason: exception.effective?.reasonLabel ?? null,
    }
  })
}

async function loadFacts(
  scope: InventoryScope,
  query: InventoryQuery,
): Promise<InventoryFact[]> {
  const facts: InventoryFact[] = []
  let cursor: string | undefined

  while (true) {
    const rows = await prisma.device.findMany({
      where: buildDeviceWhere(scope, query),
      select: factSelect,
      orderBy: { id: 'asc' },
      take: INVENTORY_FACT_BATCH_SIZE,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    })

    if (rows.length === 0) break
    facts.push(...(await resolveFactRows(rows)))
    if (rows.length < INVENTORY_FACT_BATCH_SIZE) break
    cursor = rows[rows.length - 1].id
  }

  return facts
}

function applyDerivedFilters(facts: InventoryFact[], query: InventoryQuery) {
  return facts.filter((fact) => {
    if (query.attention && !fact.status.attention) return false
    if (query.status && fact.status.code !== query.status) return false
    return true
  })
}

function countsFor(facts: InventoryFact[]): InventoryCounts {
  return {
    total: facts.length,
    attention: facts.filter((fact) => fact.status.attention).length,
    unknown: facts.filter((fact) => fact.status.code === 'UNKNOWN').length,
    critical: facts.filter(
      (fact) => fact.status.code === 'CRITICAL_ATTENTION',
    ).length,
  }
}

function compareName(left: string, right: string) {
  return left.localeCompare(right, 'en', {
    sensitivity: 'base',
    numeric: true,
  })
}

function sortFacts(facts: InventoryFact[]) {
  return [...facts].sort(
    (left, right) =>
      right.status.severity - left.status.severity ||
      compareName(left.name, right.name) ||
      left.id.localeCompare(right.id),
  )
}

function highestStatus(facts: InventoryFact[]) {
  if (facts.length === 0) return null
  return sortFacts(facts)[0].status.code
}

function visibleGroupKeys(
  visibleFacts: InventoryFact[],
  key: (fact: InventoryFact) => string,
) {
  return new Set(visibleFacts.map(key))
}

function customerRows(
  facts: InventoryFact[],
  visibleFacts: InventoryFact[],
): InventoryCustomerRow[] {
  const byCustomer = new Map<string, InventoryFact[]>()
  for (const fact of facts) {
    const current = byCustomer.get(fact.customerId)
    if (current) current.push(fact)
    else byCustomer.set(fact.customerId, [fact])
  }
  const visible = visibleGroupKeys(visibleFacts, (fact) => fact.customerId)

  return [...byCustomer.entries()]
    .filter(([id]) => visible.has(id))
    .map(([id, grouped]) => {
      const attention = grouped.filter((fact) => fact.status.attention)
      const siteCount = new Set(
        grouped.flatMap((fact) => (fact.siteId ? [fact.siteId] : [])),
      ).size
      return {
        id,
        name: grouped[0].customer.name,
        siteCount,
        deviceCount: grouped.length,
        attentionCount: attention.length,
        highestStatus: highestStatus(attention.length > 0 ? attention : grouped),
      }
    })
    .sort((left, right) => {
      const leftSeverity =
        facts.find(
          (fact) =>
            fact.customerId === left.id &&
            fact.status.code === left.highestStatus,
        )?.status.severity ?? 0
      const rightSeverity =
        facts.find(
          (fact) =>
            fact.customerId === right.id &&
            fact.status.code === right.highestStatus,
        )?.status.severity ?? 0
      return (
        rightSeverity - leftSeverity ||
        right.attentionCount - left.attentionCount ||
        compareName(left.name, right.name)
      )
    })
}

function siteKey(fact: InventoryFact) {
  return fact.siteId ?? 'unassigned'
}

function siteRows(
  facts: InventoryFact[],
  visibleFacts: InventoryFact[],
): InventorySiteRow[] {
  const bySite = new Map<string, InventoryFact[]>()
  for (const fact of facts) {
    const key = siteKey(fact)
    const current = bySite.get(key)
    if (current) current.push(fact)
    else bySite.set(key, [fact])
  }
  const visible = visibleGroupKeys(visibleFacts, siteKey)

  return [...bySite.entries()]
    .filter(([id]) => visible.has(id))
    .map(([id, grouped]) => {
      const attention = grouped.filter((fact) => fact.status.attention)
      return {
        id,
        name: grouped[0].site?.name ?? 'Unassigned devices',
        deviceCount: grouped.length,
        attentionCount: attention.length,
        highestStatus: highestStatus(attention.length > 0 ? attention : grouped),
      }
    })
    .sort((left, right) => {
      const leftSeverity =
        facts.find(
          (fact) => siteKey(fact) === left.id && fact.status.code === left.highestStatus,
        )?.status.severity ?? 0
      const rightSeverity =
        facts.find(
          (fact) => siteKey(fact) === right.id && fact.status.code === right.highestStatus,
        )?.status.severity ?? 0
      return (
        rightSeverity - leftSeverity ||
        right.attentionCount - left.attentionCount ||
        compareName(left.name, right.name)
      )
    })
}

function typeRows(
  facts: InventoryFact[],
  visibleFacts: InventoryFact[],
): InventoryDeviceTypeRow[] {
  const byType = new Map<string, InventoryFact[]>()
  for (const fact of facts) {
    const key = fact.deviceModel.deviceType.id
    const current = byType.get(key)
    if (current) current.push(fact)
    else byType.set(key, [fact])
  }
  const visible = visibleGroupKeys(
    visibleFacts,
    (fact) => fact.deviceModel.deviceType.id,
  )

  return [...byType.entries()]
    .filter(([id]) => visible.has(id))
    .map(([id, grouped]) => {
      const attention = grouped.filter((fact) => fact.status.attention)
      return {
        id,
        name: grouped[0].deviceModel.deviceType.name,
        deviceCount: grouped.length,
        attentionCount: attention.length,
        highestStatus: highestStatus(attention.length > 0 ? attention : grouped),
      }
    })
    .sort((left, right) => {
      const leftSeverity =
        facts.find(
          (fact) =>
            fact.deviceModel.deviceType.id === left.id &&
            fact.status.code === left.highestStatus,
        )?.status.severity ?? 0
      const rightSeverity =
        facts.find(
          (fact) =>
            fact.deviceModel.deviceType.id === right.id &&
            fact.status.code === right.highestStatus,
        )?.status.severity ?? 0
      return (
        rightSeverity - leftSeverity ||
        right.attentionCount - left.attentionCount ||
        compareName(left.name, right.name)
      )
    })
}

async function getFilterOptions(): Promise<InventoryFilterOptions> {
  const [vendors, models, deviceTypes, contracts] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.deviceModel.findMany({
      where: { isActive: true },
      select: {
        id: true,
        model: true,
        vendor: { select: { name: true } },
      },
      orderBy: [{ vendor: { name: 'asc' } }, { model: 'asc' }],
    }),
    prisma.deviceType.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.contractType.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return {
    vendors,
    models: models.map((model) => ({
      id: model.id,
      model: model.model,
      vendorName: model.vendor.name,
    })),
    deviceTypes,
    contracts,
  }
}

async function deviceRows(
  facts: InventoryFact[],
): Promise<InventoryDeviceRow[]> {
  if (facts.length === 0) return []
  const rows = await prisma.device.findMany({
    where: { id: { in: facts.map((fact) => fact.id) } },
    select: compactDeviceSelect,
  })
  const rowById = new Map(rows.map((row) => [row.id, row]))

  return facts.flatMap((fact) => {
    const row = rowById.get(fact.id)
    if (!row) return []
    return [
      {
        id: row.id,
        name: row.name,
        hostname: row.hostname,
        model: row.deviceModel.model,
        currentFirmware:
          row.currentFirmwareRelease?.version ??
          row.currentFirmwareNormalizedVersion ??
          row.currentFirmwareRawVersion ??
          null,
        status: fact.status,
        customer: row.customer,
        site: row.site,
        deviceType: row.deviceModel.deviceType,
      },
    ]
  })
}

async function searchHits(
  query: InventoryQuery,
  visibleFacts: InventoryFact[],
) {
  if (!query.q) return []
  return deviceRows(sortFacts(visibleFacts).slice(0, 12))
}

export async function getInventoryOverview(
  query: InventoryQuery,
): Promise<InventoryOverviewModel> {
  const [facts, filters] = await Promise.all([
    loadFacts({}, query),
    getFilterOptions(),
  ])
  const visible = applyDerivedFilters(facts, query)
  return {
    counts: countsFor(facts),
    customers: customerRows(facts, visible),
    searchHits: await searchHits(query, visible),
    filters,
  }
}

export async function getCustomerInventory(
  customerId: string,
  query: InventoryQuery,
): Promise<CustomerInventoryModel | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, isActive: true },
    select: { id: true, name: true },
  })
  if (!customer) return null

  const [facts, filters] = await Promise.all([
    loadFacts({ customerId }, query),
    getFilterOptions(),
  ])
  const visible = applyDerivedFilters(facts, query)
  return {
    customer,
    counts: countsFor(facts),
    sites: siteRows(facts, visible),
    searchHits: await searchHits(query, visible),
    filters,
  }
}

async function siteContext(customerId: string, siteId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, isActive: true },
    select: { id: true, name: true },
  })
  if (!customer) return null

  if (siteId === 'unassigned') {
    return {
      customer,
      site: {
        id: 'unassigned',
        name: 'Unassigned devices',
        unassigned: true,
      },
      databaseSiteId: null,
    }
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId, customerId, isActive: true },
    select: { id: true, name: true },
  })
  if (!site) return null
  return {
    customer,
    site: { ...site, unassigned: false },
    databaseSiteId: site.id,
  }
}

export async function getSiteInventory(
  customerId: string,
  siteId: string,
  query: InventoryQuery,
): Promise<SiteInventoryModel | null> {
  const context = await siteContext(customerId, siteId)
  if (!context) return null

  const [facts, filters] = await Promise.all([
    loadFacts(
      { customerId, siteId: context.databaseSiteId },
      query,
    ),
    getFilterOptions(),
  ])
  const visible = applyDerivedFilters(facts, query)
  return {
    customer: context.customer,
    site: context.site,
    counts: countsFor(facts),
    deviceTypes: typeRows(facts, visible),
    searchHits: await searchHits(query, visible),
    filters,
  }
}

export async function getDeviceTypeInventory(
  customerId: string,
  siteId: string,
  deviceTypeId: string,
  query: InventoryQuery,
): Promise<DeviceTypeInventoryModel | null> {
  const context = await siteContext(customerId, siteId)
  if (!context) return null
  const deviceType = await prisma.deviceType.findFirst({
    where: { id: deviceTypeId, isActive: true },
    select: { id: true, name: true },
  })
  if (!deviceType) return null

  const [facts, filters] = await Promise.all([
    loadFacts(
      {
        customerId,
        siteId: context.databaseSiteId,
        deviceTypeId,
      },
      query,
    ),
    getFilterOptions(),
  ])
  const visible = sortFacts(applyDerivedFilters(facts, query))
  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, totalPages)
  const offset = (page - 1) * query.pageSize
  const pageFacts = visible.slice(offset, offset + query.pageSize)

  return {
    customer: context.customer,
    site: context.site,
    deviceType,
    counts: countsFor(facts),
    devices: await deviceRows(pageFacts),
    pagination: {
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
    },
    filters,
  }
}

export type InventoryExportScope =
  | { kind: 'customer'; customerId: string }
  | { kind: 'site'; customerId: string; siteId: string }
  | {
      kind: 'deviceType'
      customerId: string
      siteId: string
      deviceTypeId: string
    }

export type InventoryExportRecord = {
  customer: string
  site: string
  deviceType: string
  name: string
  hostname: string
  vendor: string
  model: string
  serialNumber: string
  managementAddress: string
  currentFirmware: string
  primaryStatus: string
  statusReason: string
  technicalCompliance: string
  recommendation: string
  exceptionState: string
  exceptionReason: string
  workflow: string
  contract: string
  source: string
  externalProvider: string
  externalId: string
  lastSynchronizedAt: string
}

export async function getInventoryExportRecords(
  scope: InventoryExportScope,
  query: InventoryQuery,
): Promise<InventoryExportRecord[]> {
  const siteId =
    'siteId' in scope
      ? scope.siteId === 'unassigned'
        ? null
        : scope.siteId
      : undefined
  const facts = await loadFacts(
    {
      customerId: scope.customerId,
      siteId,
      deviceTypeId:
        scope.kind === 'deviceType' ? scope.deviceTypeId : undefined,
    },
    query,
  )
  const visible = sortFacts(applyDerivedFilters(facts, query))
  if (visible.length === 0) return []

  const rows = await prisma.device.findMany({
    where: { id: { in: visible.map((fact) => fact.id) } },
    select: {
      id: true,
      name: true,
      hostname: true,
      serialNumber: true,
      managementAddress: true,
      currentFirmwareRawVersion: true,
      currentFirmwareNormalizedVersion: true,
      currentFirmwareRelease: { select: { version: true } },
      source: true,
      externalProvider: true,
      externalId: true,
      lastSynchronizedAt: true,
      customer: {
        select: {
          name: true,
          contractType: { select: { name: true } },
        },
      },
      site: {
        select: {
          name: true,
          contractType: { select: { name: true } },
        },
      },
      deviceModel: {
        select: {
          model: true,
          vendor: { select: { name: true } },
          deviceType: { select: { name: true } },
        },
      },
      lifecycle: { select: { state: true } },
    },
  })
  const rowById = new Map(rows.map((row) => [row.id, row]))

  return visible.flatMap((fact) => {
    const row = rowById.get(fact.id)
    if (!row) return []
    return [
      {
        customer: row.customer.name,
        site: row.site?.name ?? 'Unassigned',
        deviceType: row.deviceModel.deviceType.name,
        name: row.name,
        hostname: row.hostname ?? '',
        vendor: row.deviceModel.vendor.name,
        model: row.deviceModel.model,
        serialNumber: row.serialNumber ?? '',
        managementAddress: row.managementAddress ?? '',
        currentFirmware:
          row.currentFirmwareRelease?.version ??
          row.currentFirmwareNormalizedVersion ??
          row.currentFirmwareRawVersion ??
          '',
        primaryStatus: fact.status.label,
        statusReason: fact.status.reason,
        technicalCompliance: fact.compliance,
        recommendation: fact.recommendation,
        exceptionState: fact.exceptionState,
        exceptionReason: fact.exceptionReason ?? '',
        workflow: row.lifecycle?.state ?? '',
        contract:
          row.site?.contractType?.name ??
          row.customer.contractType?.name ??
          '',
        source: row.source,
        externalProvider: row.externalProvider ?? '',
        externalId: row.externalId ?? '',
        lastSynchronizedAt: row.lastSynchronizedAt?.toISOString() ?? '',
      },
    ]
  })
}

export function statusCodeLabel(code: InventoryPrimaryStatusCode) {
  return code
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
