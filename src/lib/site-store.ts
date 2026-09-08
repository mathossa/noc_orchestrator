import { organizationUnitSiteWhere } from '@/lib/organization-units'
import { prisma } from '@/lib/prisma'
import { cleanSiteCode, normalizedSiteName, parseSiteInput, type SiteRecord } from '@/lib/sites'

export class SiteConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteConflictError'
  }
}

export class SiteNotFoundError extends Error {
  constructor() {
    super('Site was not found for this customer.')
    this.name = 'SiteNotFoundError'
  }
}

export class SiteCustomerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteCustomerError'
  }
}

export class SiteContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteContractError'
  }
}

export class SiteInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteInUseError'
  }
}

const contractSelect = {
  id: true,
  code: true,
  name: true,
  firmwareManagementEnabled: true,
  isActive: true,
} as const

const siteInclude = {
  organizationUnit: { select: { id: true, customerId: true, parentId: true, name: true, isActive: true } },
  customer: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      contractType: { select: contractSelect },
    },
  },
  contractType: { select: contractSelect },
  _count: { select: { devices: true } },
} as const

type ContractReference = {
  id: string
  code: string
  name: string
  firmwareManagementEnabled: boolean
  isActive: boolean
}

function serializeSite(record: {
  id: string
  customerId: string
  organizationUnitId?: string | null
  organizationUnit?: SiteRecord['organizationUnit']
  contractTypeId: string | null
  customer: {
    id: string
    code: string | null
    name: string
    isActive: boolean
    contractType: ContractReference | null
  }
  contractType: ContractReference | null
  name: string
  code: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  country: string | null
  notes: string | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
  _count: { devices: number }
}): SiteRecord {
  const effectiveContractType = record.contractType ?? record.customer.contractType
  return {
    id: record.id,
    customerId: record.customerId,
    organizationUnitId: record.organizationUnitId ?? null,
    organizationUnit: record.organizationUnit ?? null,
    contractTypeId: record.contractTypeId,
    customer: record.customer,
    contractType: record.contractType,
    effectiveContractType,
    contractSource: record.contractType ? 'SITE' : record.customer.contractType ? 'CUSTOMER' : 'NONE',
    name: record.name,
    code: record.code,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2,
    postalCode: record.postalCode,
    city: record.city,
    region: record.region,
    country: record.country,
    notes: record.notes,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
    deviceCount: record._count.devices,
  }
}

async function assertCustomer(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })
  if (!customer) throw new SiteCustomerError('The selected customer does not exist.')
}

async function assertContractType(contractTypeId: string | null) {
  if (!contractTypeId) return
  const contractType = await prisma.contractType.findUnique({
    where: { id: contractTypeId },
    select: { id: true },
  })
  if (!contractType) throw new SiteContractError('The selected site contract type does not exist.')
}

async function assertUniqueWithinCustomer(customerId: string, name: string, code: string | null, excludeId?: string, organizationUnitId: string | null = null) {
  const records = await prisma.site.findMany({
    where: { customerId, organizationUnitId },
    select: { id: true, name: true, code: true },
  })

  const normalizedName = normalizedSiteName(name)
  const nameConflict = records.find(
    (record) => record.id !== excludeId && normalizedSiteName(record.name) === normalizedName,
  )
  if (nameConflict) throw new SiteConflictError(`Site “${name}” already exists in this customer/business unit.`)

  const canonicalCode = cleanSiteCode(code)
  if (canonicalCode) {
    const codeConflict = records.find(
      (record) => record.id !== excludeId && cleanSiteCode(record.code) === canonicalCode,
    )
    if (codeConflict) throw new SiteConflictError(`Site code ${canonicalCode} is already in use in this customer/business unit.`)
  }
}

export async function listSiteContractTypes() {
  return prisma.contractType.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: contractSelect,
  })
}

export async function listSites(organizationUnit?: string) {
  const records = await prisma.site.findMany({
    where: organizationUnitSiteWhere(organizationUnit),
    orderBy: [{ isActive: 'desc' }, { customer: { name: 'asc' } }, { name: 'asc' }],
    include: siteInclude,
  })
  return records.map(serializeSite)
}

export async function listSitesForCustomer(customerId: string, organizationUnit?: string) {
  await assertCustomer(customerId)
  const records = await prisma.site.findMany({
    where: { customerId, ...organizationUnitSiteWhere(organizationUnit) },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: siteInclude,
  })
  return records.map(serializeSite)
}

export async function getSite(customerId: string, siteId: string) {
  const record = await prisma.site.findFirst({
    where: { id: siteId, customerId },
    include: siteInclude,
  })
  if (!record) throw new SiteNotFoundError()

  return {
    ...serializeSite(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function createSite(customerId: string, rawInput: unknown) {
  await assertCustomer(customerId)
  const input = parseSiteInput(rawInput)
  await Promise.all([
    assertContractType(input.contractTypeId),
    assertOrganizationUnitBelongsToCustomer(input.organizationUnitId, customerId),
    assertUniqueWithinCustomer(customerId, input.name, input.code, undefined, input.organizationUnitId),
  ])
  const created = await prisma.site.create({
    data: { customerId, ...input },
    include: siteInclude,
  })
  return serializeSite(created)
}

export async function updateSite(customerId: string, siteId: string, rawInput: unknown, actorUserId: string | null = null) {
  const current = await prisma.site.findFirst({ where: { id: siteId, customerId } })
  if (!current) throw new SiteNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseSiteInput({
    name: current.name,
    code: current.code,
    organizationUnitId: current.organizationUnitId,
    contractTypeId: current.contractTypeId,
    addressLine1: current.addressLine1,
    addressLine2: current.addressLine2,
    postalCode: current.postalCode,
    city: current.city,
    region: current.region,
    country: current.country,
    notes: current.notes,
    isActive: current.isActive,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    ...patch,
  })

  await Promise.all([
    assertContractType(input.contractTypeId),
    assertOrganizationUnitBelongsToCustomer(input.organizationUnitId, customerId),
    assertUniqueWithinCustomer(customerId, input.name, input.code, siteId, input.organizationUnitId),
  ])
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.site.update({ where: { id: siteId }, data: input, include: siteInclude })
    if ((current.organizationUnitId ?? null) !== input.organizationUnitId) {
      await tx.auditEvent.create({ data: { customerId, actorUserId, entityType: 'Site', entityId: siteId, action: 'SITE_ORGANIZATION_UNIT_CHANGED', before: { organizationUnitId: current.organizationUnitId ?? null }, after: { organizationUnitId: input.organizationUnitId } } })
    }
    return result
  })
  return serializeSite(updated)
}

export async function deleteSite(customerId: string, siteId: string) {
  const current = await prisma.site.findFirst({
    where: { id: siteId, customerId },
    select: { id: true, name: true },
  })
  if (!current) throw new SiteNotFoundError()

  const [devices, auditEvents] = await Promise.all([
    prisma.device.count({ where: { siteId } }),
    prisma.auditEvent.count({ where: { entityType: 'Site', entityId: siteId } }),
  ])
  const references = devices + auditEvents

  if (references > 0) {
    throw new SiteInUseError(
      `This site is referenced by ${references} device or audit record${references === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }

  return prisma.site.delete({ where: { id: siteId } })
}

// Reused by Issue #8 device inventory. A device may have no site, but when a
// site is supplied it must belong to the same customer as the device.
export async function assertSiteBelongsToCustomer(siteId: string | null | undefined, customerId: string) {
  if (!siteId) return null
  const site = await prisma.site.findFirst({
    where: { id: siteId, customerId },
    select: {
      id: true,
      customerId: true,
      name: true,
      isActive: true,
      contractTypeId: true,
      contractType: { select: contractSelect },
      customer: { select: { contractType: { select: contractSelect } } },
    },
  })
  if (!site) throw new SiteCustomerError('The selected site does not belong to this customer.')
  return {
    ...site,
    effectiveContractType: site.contractType ?? site.customer.contractType,
  }
}

export async function assertOrganizationUnitBelongsToCustomer(id: string | null, customerId: string) {
  if (!id) return null
  const unit = await prisma.customerOrganizationUnit.findFirst({ where: { id, customerId } })
  if (!unit) throw new SiteCustomerError('The selected organizational unit does not belong to this customer.')
  return unit
}
