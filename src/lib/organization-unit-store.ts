import { prisma } from '@/lib/prisma'
import { Prisma } from '../generated/prisma/client'
import { normalizedSiteName } from '@/lib/sites'
import {
  SiteConflictError,
  SiteCustomerError,
  SiteInUseError,
  SiteNotFoundError,
} from '@/lib/site-store'
import {
  parseOrganizationUnitInput,
  type OrganizationUnitRecord,
} from '@/lib/organization-units'

type Db = Prisma.TransactionClient
const include = {
  sites: { select: { _count: { select: { devices: true } } } },
} as const
function serialize(
  record: Prisma.CustomerOrganizationUnitGetPayload<{
    include: typeof include
  }>,
): OrganizationUnitRecord {
  const { sites, ...unit } = record
  return {
    ...unit,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
    lastSynchronizedAt: unit.lastSynchronizedAt?.toISOString() ?? null,
    siteCount: sites.length,
    deviceCount: sites.reduce((total, site) => total + site._count.devices, 0),
  }
}
export async function listOrganizationUnits(customerId?: string, search = '') {
  const records = await prisma.customerOrganizationUnit.findMany({
    where: {
      ...(customerId ? { customerId } : {}),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include,
  })
  return records.map(serialize)
}
export async function getOrganizationUnit(customerId: string, id: string) {
  const record = await prisma.customerOrganizationUnit.findFirst({
    where: { id, customerId },
    include,
  })
  if (!record) throw new SiteNotFoundError()
  const sites = await prisma.site.findMany({
    where: { customerId, organizationUnitId: id },
    select: { id: true, name: true, isActive: true },
  })
  return { ...serialize(record), sites }
}
async function validate(
  tx: Db,
  customerId: string,
  input: ReturnType<typeof parseOrganizationUnitInput>,
  id?: string,
) {
  if (!(await tx.customer.findUnique({ where: { id: customerId } })))
    throw new SiteCustomerError('Customer does not exist.')
  // Serialize hierarchy changes for this customer, including cycle and duplicate checks.
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`
  const units = await tx.customerOrganizationUnit.findMany({
    where: { customerId },
  })
  const seen = new Set(id ? [id] : [])
  let parentId = input.parentId
  while (parentId) {
    if (seen.has(parentId))
      throw new SiteCustomerError('A unit cannot be its own ancestor.')
    seen.add(parentId)
    const parent = units.find((unit) => unit.id === parentId)
    if (!parent)
      throw new SiteCustomerError('Parent unit must belong to this customer.')
    parentId = parent.parentId
  }
  if (
    units.some(
      (unit) =>
        unit.id !== id &&
        unit.parentId === input.parentId &&
        (normalizedSiteName(unit.name) === normalizedSiteName(input.name) ||
          (input.code && unit.code === input.code)),
    )
  )
    throw new SiteConflictError(
      'A unit with this name or code already exists under this parent.',
    )
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
export async function createOrganizationUnit(
  customerId: string,
  raw: unknown,
  actorUserId: string | null = null,
) {
  const input = parseOrganizationUnitInput(raw)
  return prisma.$transaction(async (tx) => {
    await validate(tx, customerId, input)
    const record = await tx.customerOrganizationUnit.create({
      data: {
        customerId,
        ...input,
        sourceMetadata: input.sourceMetadata ?? Prisma.DbNull,
      },
      include,
    })
    await tx.auditEvent.create({
      data: {
        customerId,
        actorUserId,
        entityType: 'CustomerOrganizationUnit',
        entityId: record.id,
        action: 'ORGANIZATION_UNIT_CREATED',
        after: json(input),
      },
    })
    return serialize(record)
  })
}
export async function updateOrganizationUnit(
  customerId: string,
  id: string,
  raw: unknown,
  actorUserId: string | null = null,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`
    const current = await tx.customerOrganizationUnit.findFirst({
      where: { id, customerId },
    })
    if (!current) throw new SiteNotFoundError()
    const patch =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    if ('customerId' in patch && patch.customerId !== customerId)
      throw new SiteCustomerError(
        'Moving units across customers is not supported.',
      )
    const input = parseOrganizationUnitInput({ ...current, ...patch })
    if (current.source === 'MANUAL' && input.source !== 'MANUAL')
      throw new SiteConflictError(
        'Manually owned units cannot be overwritten by source data.',
      )
    await validate(tx, customerId, input, id)
    const record = await tx.customerOrganizationUnit.update({
      where: { id },
      data: { ...input, sourceMetadata: input.sourceMetadata ?? Prisma.DbNull },
      include,
    })
    await tx.auditEvent.create({
      data: {
        customerId,
        actorUserId,
        entityType: 'CustomerOrganizationUnit',
        entityId: id,
        action: 'ORGANIZATION_UNIT_UPDATED',
        before: json(current),
        after: json(input),
      },
    })
    return serialize(record)
  })
}
export async function deleteOrganizationUnit(customerId: string, id: string) {
  await getOrganizationUnit(customerId, id)
  throw new SiteInUseError(
    'Organizational units retain inventory history. Deactivate this unit instead of deleting it.',
  )
}
