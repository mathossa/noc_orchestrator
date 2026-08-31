import { prisma } from '@/lib/prisma'
import { parseCustomerInput } from '@/lib/customers'

export class CustomerConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerConflictError'
  }
}

export class CustomerNotFoundError extends Error {
  constructor() {
    super('Customer was not found.')
    this.name = 'CustomerNotFoundError'
  }
}

export class CustomerInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerInUseError'
  }
}

export class CustomerContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerContractError'
  }
}

async function assertContractType(contractTypeId: string | null) {
  if (!contractTypeId) return
  const contract = await prisma.contractType.findUnique({ where: { id: contractTypeId }, select: { id: true } })
  if (!contract) throw new CustomerContractError('The selected contract type does not exist.')
}

function serializeCustomer(record: {
  id: string
  code: string | null
  name: string
  contractTypeId: string | null
  contractType: {
    id: string
    code: string
    name: string
    firmwareManagementEnabled: boolean
    isActive: boolean
  } | null
  isActive: boolean
  source: string
  externalProvider: string | null
  externalId: string | null
  lastSynchronizedAt: Date | null
  _count: { devices: number; sites: number }
}) {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    contractTypeId: record.contractTypeId,
    contractType: record.contractType,
    isActive: record.isActive,
    source: record.source,
    externalProvider: record.externalProvider,
    externalId: record.externalId,
    lastSynchronizedAt: record.lastSynchronizedAt?.toISOString() ?? null,
    deviceCount: record._count.devices,
    siteCount: record._count.sites,
  }
}

const customerInclude = {
  contractType: {
    select: {
      id: true,
      code: true,
      name: true,
      firmwareManagementEnabled: true,
      isActive: true,
    },
  },
  _count: { select: { devices: true, sites: true } },
} as const

export async function listCustomers() {
  const records = await prisma.customer.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: customerInclude,
  })
  return records.map(serializeCustomer)
}

export async function listCustomerContractTypes() {
  return prisma.contractType.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      firmwareManagementEnabled: true,
      isActive: true,
    },
  })
}

export async function getCustomer(id: string) {
  const record = await prisma.customer.findUnique({
    where: { id },
    include: customerInclude,
  })
  if (!record) throw new CustomerNotFoundError()

  const [devices, sites] = await Promise.all([
    prisma.device.findMany({
      where: { customerId: id },
      select: { lifecycle: { select: { state: true } } },
    }),
    prisma.site.findMany({
      where: { customerId: id },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        country: true,
        isActive: true,
        _count: { select: { devices: true } },
      },
    }),
  ])

  const workflowCounts = {
    planned: 0,
    ignored: 0,
    customerDeclined: 0,
    done: 0,
  }

  for (const device of devices) {
    switch (device.lifecycle?.state) {
      case 'PLANNED':
        workflowCounts.planned += 1
        break
      case 'IGNORED':
        workflowCounts.ignored += 1
        break
      case 'CUSTOMER_DECLINED':
        workflowCounts.customerDeclined += 1
        break
      case 'DONE':
        workflowCounts.done += 1
        break
    }
  }

  return {
    ...serializeCustomer(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      code: site.code,
      city: site.city,
      country: site.country,
      isActive: site.isActive,
      deviceCount: site._count.devices,
    })),
    workflowCounts,
    // Issue #10 owns canonical desired-state resolution. Do not duplicate that
    // comparison logic here; the detail API exposes a stable summary shape now.
    desiredStateSummary: {
      available: false as const,
      current: null,
      actionRequired: null,
    },
  }
}

export async function createCustomer(rawInput: unknown) {
  const input = parseCustomerInput(rawInput)
  await assertContractType(input.contractTypeId)
  const record = await prisma.customer.create({ data: input, include: customerInclude })
  return serializeCustomer(record)
}

export async function updateCustomer(id: string, rawInput: unknown) {
  const current = await prisma.customer.findUnique({ where: { id } })
  if (!current) throw new CustomerNotFoundError()

  const patch = typeof rawInput === 'object' && rawInput !== null ? (rawInput as Record<string, unknown>) : {}
  const input = parseCustomerInput({
    name: current.name,
    code: current.code,
    contractTypeId: current.contractTypeId,
    source: current.source,
    externalProvider: current.externalProvider,
    externalId: current.externalId,
    isActive: current.isActive,
    ...patch,
  })
  await assertContractType(input.contractTypeId)
  const record = await prisma.customer.update({ where: { id }, data: input, include: customerInclude })
  return serializeCustomer(record)
}

export async function deleteCustomer(id: string) {
  const current = await prisma.customer.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!current) throw new CustomerNotFoundError()

  const [sites, devices, policies, auditEvents] = await Promise.all([
    prisma.site.count({ where: { customerId: id } }),
    prisma.device.count({ where: { customerId: id } }),
    prisma.firmwarePolicy.count({ where: { customerId: id } }),
    prisma.auditEvent.count({ where: { customerId: id } }),
  ])

  const references = sites + devices + policies + auditEvents
  if (references > 0) {
    throw new CustomerInUseError(
      `This customer is referenced by ${references} site, device, policy, or audit record${references === 1 ? '' : 's'} and cannot be deleted. Archive it instead.`,
    )
  }

  return prisma.customer.delete({ where: { id } })
}
