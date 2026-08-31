import { prisma } from '@/lib/prisma'
import {
  findNormalizedNameConflict,
  parseReferenceInput,
  referencedRecordMessage,
  type ReferenceKind,
} from '@/lib/reference-data'

export class ReferenceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceConflictError'
  }
}

export class ReferenceNotFoundError extends Error {
  constructor() {
    super('Reference record was not found.')
    this.name = 'ReferenceNotFoundError'
  }
}

export class ReferenceInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceInUseError'
  }
}

export function parseReferenceKind(value: string): ReferenceKind | null {
  return value === 'vendors' || value === 'device-types' || value === 'contract-types' ? value : null
}

function mergePatch(current: object, rawInput: unknown) {
  const patch = typeof rawInput === 'object' && rawInput !== null ? rawInput : {}
  return { ...current, ...patch }
}

async function assertUnique(kind: ReferenceKind, code: string, name: string, excludeId?: string) {
  const records =
    kind === 'vendors'
      ? await prisma.vendor.findMany({ select: { id: true, code: true, name: true } })
      : kind === 'device-types'
        ? await prisma.deviceType.findMany({ select: { id: true, code: true, name: true } })
        : await prisma.contractType.findMany({ select: { id: true, code: true, name: true } })

  const codeConflict = records.find((record) => record.id !== excludeId && record.code === code)
  if (codeConflict) throw new ReferenceConflictError(`Code ${code} is already in use.`)

  const nameConflict = findNormalizedNameConflict(records, name, excludeId)
  if (nameConflict) throw new ReferenceConflictError(`Name “${name}” is already in use.`)
}

export async function listReferenceData(kind: ReferenceKind) {
  const orderBy = [{ isActive: 'desc' as const }, { name: 'asc' as const }]

  if (kind === 'vendors') {
    return prisma.vendor.findMany({
      orderBy,
      select: { id: true, code: true, name: true, websiteUrl: true, isActive: true },
    })
  }

  if (kind === 'device-types') {
    return prisma.deviceType.findMany({
      orderBy,
      select: { id: true, code: true, name: true, description: true, isActive: true },
    })
  }

  return prisma.contractType.findMany({
    orderBy,
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      firmwareManagementEnabled: true,
      isActive: true,
    },
  })
}

export async function createReferenceRecord(kind: ReferenceKind, rawInput: unknown) {
  if (kind === 'vendors') {
    const input = parseReferenceInput('vendors', rawInput)
    await assertUnique(kind, input.code, input.name)
    return prisma.vendor.create({ data: input })
  }

  if (kind === 'device-types') {
    const input = parseReferenceInput('device-types', rawInput)
    await assertUnique(kind, input.code, input.name)
    return prisma.deviceType.create({ data: input })
  }

  const input = parseReferenceInput('contract-types', rawInput)
  await assertUnique(kind, input.code, input.name)
  return prisma.contractType.create({ data: input })
}

export async function updateReferenceRecord(kind: ReferenceKind, id: string, rawInput: unknown) {
  if (kind === 'vendors') {
    const current = await prisma.vendor.findUnique({ where: { id } })
    if (!current) throw new ReferenceNotFoundError()
    const input = parseReferenceInput('vendors', mergePatch(current, rawInput))
    await assertUnique(kind, input.code, input.name, id)
    return prisma.vendor.update({ where: { id }, data: input })
  }

  if (kind === 'device-types') {
    const current = await prisma.deviceType.findUnique({ where: { id } })
    if (!current) throw new ReferenceNotFoundError()
    const input = parseReferenceInput('device-types', mergePatch(current, rawInput))
    await assertUnique(kind, input.code, input.name, id)
    return prisma.deviceType.update({ where: { id }, data: input })
  }

  const current = await prisma.contractType.findUnique({ where: { id } })
  if (!current) throw new ReferenceNotFoundError()
  const input = parseReferenceInput('contract-types', mergePatch(current, rawInput))
  await assertUnique(kind, input.code, input.name, id)
  return prisma.contractType.update({ where: { id }, data: input })
}

export async function deleteReferenceRecord(kind: ReferenceKind, id: string) {
  if (kind === 'vendors') {
    const current = await prisma.vendor.findUnique({ where: { id } })
    if (!current) throw new ReferenceNotFoundError()
    const [models, releases, policies] = await Promise.all([
      prisma.deviceModel.count({ where: { vendorId: id } }),
      prisma.firmwareRelease.count({ where: { vendorId: id } }),
      prisma.firmwarePolicy.count({ where: { vendorId: id } }),
    ])
    const message = referencedRecordMessage(kind, models + releases + policies)
    if (message) throw new ReferenceInUseError(message)
    return prisma.vendor.delete({ where: { id } })
  }

  if (kind === 'device-types') {
    const current = await prisma.deviceType.findUnique({ where: { id } })
    if (!current) throw new ReferenceNotFoundError()
    const [models, policies] = await Promise.all([
      prisma.deviceModel.count({ where: { deviceTypeId: id } }),
      prisma.firmwarePolicy.count({ where: { deviceTypeId: id } }),
    ])
    const message = referencedRecordMessage(kind, models + policies)
    if (message) throw new ReferenceInUseError(message)
    return prisma.deviceType.delete({ where: { id } })
  }

  const current = await prisma.contractType.findUnique({ where: { id } })
  if (!current) throw new ReferenceNotFoundError()
  const [customers, policies] = await Promise.all([
    prisma.customer.count({ where: { contractTypeId: id } }),
    prisma.firmwarePolicy.count({ where: { contractTypeId: id } }),
  ])
  const message = referencedRecordMessage(kind, customers + policies)
  if (message) throw new ReferenceInUseError(message)
  return prisma.contractType.delete({ where: { id } })
}
