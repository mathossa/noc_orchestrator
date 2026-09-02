import { randomUUID } from 'node:crypto'
import { normalizeImportText } from '@/lib/device-import'
import { suggestedImportReferenceCode } from '@/lib/device-import-staging'
import {
  DeviceImportStagingError,
  refreshDeviceImportBatchReferences,
} from '@/lib/device-import-staging-store'
import { prisma } from '@/lib/prisma'

export const CORE_ASSIST_KINDS = ['CUSTOMER', 'VENDOR', 'DEVICE_TYPE'] as const
type CoreAssistKind = (typeof CORE_ASSIST_KINDS)[number]

const MAX_CORE_CREATE = 250

type CoreItem = {
  referenceId: string
  name: string
  code: string
}

function cleanCode(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    : ''
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
}

function uniqueCode(base: string, used: Set<string>) {
  const first = (base || 'IMPORT').slice(0, 40)
  if (!used.has(first)) {
    used.add(first)
    return first
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const end = `_${suffix}`
    const candidate = `${first.slice(0, Math.max(1, 40 - end.length))}${end}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new DeviceImportStagingError(`Could not generate a unique code for “${base}”.`)
}

async function assertMutable(batchId: string) {
  const batch = await prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } })
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
}

export async function getDeviceImportCoreAssist(batchId: string) {
  await assertMutable(batchId)
  const [references, customers, vendors, deviceTypes, contracts] = await Promise.all([
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, kind: { in: [...CORE_ASSIST_KINDS] }, status: 'UNRESOLVED' },
      orderBy: [{ kind: 'asc' }, { sourceValue: 'asc' }],
      select: {
        id: true,
        kind: true,
        sourceValue: true,
        occurrenceCount: true,
        suggestedTargetId: true,
        suggestionScore: true,
      },
    }),
    prisma.customer.findMany({ select: { id: true, code: true, name: true } }),
    prisma.vendor.findMany({ select: { id: true, code: true, name: true } }),
    prisma.deviceType.findMany({ select: { id: true, code: true, name: true } }),
    prisma.contractType.findMany({ select: { id: true, code: true, name: true } }),
  ])
  const used = {
    CUSTOMER: new Set(customers.map((record) => record.code?.toUpperCase()).filter((value): value is string => Boolean(value))),
    VENDOR: new Set(vendors.map((record) => record.code.toUpperCase())),
    DEVICE_TYPE: new Set(deviceTypes.map((record) => record.code.toUpperCase())),
    CONTRACT_TYPE: new Set(contracts.map((record) => record.code.toUpperCase())),
  }

  return {
    proposals: references.map((reference) => {
      const kind = reference.kind as CoreAssistKind
      return {
        referenceId: reference.id,
        kind,
        sourceValue: reference.sourceValue,
        occurrenceCount: reference.occurrenceCount,
        proposedName: reference.sourceValue,
        proposedCode: uniqueCode(suggestedImportReferenceCode(reference.sourceValue), used[kind]),
        suggestedTargetId: reference.suggestedTargetId,
        suggestionScore: reference.suggestionScore,
      }
    }),
  }
}

function parseItems(raw: unknown): CoreItem[] {
  const input = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!rawItems.length) throw new DeviceImportStagingError('Choose at least one prepared reference to create.')
  if (rawItems.length > MAX_CORE_CREATE) throw new DeviceImportStagingError(`Create at most ${MAX_CORE_CREATE} core references in one action.`)
  return rawItems.map((rawItem) => {
    const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
    const referenceId = typeof item.referenceId === 'string' ? item.referenceId.trim() : ''
    const name = cleanName(item.name)
    const code = cleanCode(item.code)
    if (!referenceId || !name || !code) throw new DeviceImportStagingError('Every prepared record needs a source reference, name, and code.')
    return { referenceId, name, code }
  })
}

export async function bulkCreateDeviceImportCoreReferences(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const deferRefresh = input.deferRefresh === true
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  await assertMutable(batchId)
  const items = parseItems(rawInput)
  const ids = items.map((item) => item.referenceId)
  if (new Set(ids).size !== ids.length) throw new DeviceImportStagingError('A staged reference can only appear once in a create action.')

  const references = await prisma.deviceImportStagedReference.findMany({
    where: { batchId, id: { in: ids }, kind: { in: [...CORE_ASSIST_KINDS] }, status: 'UNRESOLVED' },
    select: { id: true, kind: true, sourceValue: true },
  })
  if (references.length !== ids.length) throw new DeviceImportStagingError('One or more prepared references are no longer unresolved.')
  const referenceById = new Map(references.map((reference) => [reference.id, reference]))

  let created = 0
  let linkedExisting = 0
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const reference = referenceById.get(item.referenceId)!
      const normalizedName = normalizeImportText(item.name)
      const normalizedCode = normalizeImportText(item.code)
      let targetId: string | null = null
      let resolutionSource: 'EXACT' | 'CREATED' = 'CREATED'

      if (reference.kind === 'CUSTOMER') {
        const candidates = await tx.customer.findMany({ select: { id: true, code: true, name: true } })
        const exact = candidates.filter((record) => normalizeImportText(record.name) === normalizedName || normalizeImportText(record.code) === normalizedCode)
        if (exact.length > 1) throw new DeviceImportStagingError(`Customer “${item.name}” is ambiguous. Link it manually instead.`)
        if (exact.length === 1) {
          targetId = exact[0].id
          resolutionSource = 'EXACT'
          linkedExisting += 1
        } else {
          targetId = randomUUID()
          await tx.customer.create({ data: { id: targetId, name: item.name, code: item.code, source: 'IMPORT', isActive: true } })
          created += 1
        }
      } else if (reference.kind === 'VENDOR') {
        const existing = await tx.vendor.findFirst({ where: { OR: [{ code: item.code }, { name: item.name }] }, select: { id: true } })
        if (existing) {
          targetId = existing.id
          resolutionSource = 'EXACT'
          linkedExisting += 1
        } else {
          targetId = randomUUID()
          await tx.vendor.create({ data: { id: targetId, code: item.code, name: item.name, isActive: true } })
          created += 1
        }
      } else if (reference.kind === 'DEVICE_TYPE') {
        const existing = await tx.deviceType.findFirst({ where: { OR: [{ code: item.code }, { name: item.name }] }, select: { id: true } })
        if (existing) {
          targetId = existing.id
          resolutionSource = 'EXACT'
          linkedExisting += 1
        } else {
          targetId = randomUUID()
          await tx.deviceType.create({ data: { id: targetId, code: item.code, name: item.name, isActive: true } })
          created += 1
        }
      } else {
        const existing = await tx.contractType.findFirst({ where: { OR: [{ code: item.code }, { name: item.name }] }, select: { id: true } })
        if (existing) {
          targetId = existing.id
          resolutionSource = 'EXACT'
          linkedExisting += 1
        } else {
          targetId = randomUUID()
          await tx.contractType.create({ data: { id: targetId, code: item.code, name: item.name, firmwareManagementEnabled: true, isActive: true } })
          created += 1
        }
      }

      await tx.deviceImportStagedReference.update({
        where: { id: reference.id },
        data: {
          status: 'LINKED',
          targetId,
          suggestedTargetId: null,
          suggestionScore: null,
          resolutionSource,
        },
      })
    }
  })

  return {
    created,
    linkedExisting,
    workspace: deferRefresh ? null : await refreshDeviceImportBatchReferences(batchId),
  }
}
