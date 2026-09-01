import { randomUUID } from 'node:crypto'
import { normalizeImportText } from '@/lib/device-import'
import { getDeviceImportBatchWorkspace, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

const MAX_BULK_SITES = 250
const MAX_SITE_CODE_LENGTH = 40

type StagedSiteReference = {
  id: string
  sourceValue: string
  metadata: unknown
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

export function suggestedBulkSiteCode(sourceValue: string) {
  const code = sourceValue
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (code || 'SITE').slice(0, MAX_SITE_CODE_LENGTH).replace(/-+$/g, '') || 'SITE'
}

export function nextAvailableSiteCode(baseCode: string, usedCodes: Set<string>) {
  if (!usedCodes.has(baseCode)) return baseCode
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `-${suffix}`
    const candidate = `${baseCode.slice(0, Math.max(1, MAX_SITE_CODE_LENGTH - suffixText.length)).replace(/-+$/g, '')}${suffixText}`
    if (!usedCodes.has(candidate)) return candidate
  }
  throw new DeviceImportStagingError(`Could not generate a unique Site code for ${baseCode}.`)
}

export async function bulkCreateDeviceImportSites(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  const referenceIds = Array.isArray(input.referenceIds)
    ? input.referenceIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
    : []

  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  if (!referenceIds.length) throw new DeviceImportStagingError('Choose at least one staged Site to create.')
  if (referenceIds.length > MAX_BULK_SITES) throw new DeviceImportStagingError(`Create at most ${MAX_BULK_SITES} Sites in one bulk action.`)
  if (new Set(referenceIds).size !== referenceIds.length) throw new DeviceImportStagingError('A staged Site can only appear once in a bulk create action.')

  const [batch, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } }),
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, kind: 'SITE', status: 'UNRESOLVED', id: { in: referenceIds } },
      select: { id: true, sourceValue: true, metadata: true },
      orderBy: [{ sourceValue: 'asc' }],
    }) as Promise<StagedSiteReference[]>,
  ])

  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  if (references.length !== referenceIds.length) {
    throw new DeviceImportStagingError('One or more selected Sites are no longer unresolved or ready to create.')
  }

  const customerIds = [...new Set(references.map((reference) => metadata(reference.metadata).customerTargetId).filter((id): id is string => Boolean(id)))]
  if (customerIds.length === 0 || references.some((reference) => !metadata(reference.metadata).customerTargetId)) {
    throw new DeviceImportStagingError('Resolve each Site Customer before bulk-creating Sites.')
  }

  const [customers, existingSites] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: customerIds }, isActive: true }, select: { id: true } }),
    prisma.site.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true, customerId: true, name: true, code: true },
    }),
  ])
  const activeCustomers = new Set(customers.map((customer) => customer.id))
  if (customerIds.some((customerId) => !activeCustomers.has(customerId))) {
    throw new DeviceImportStagingError('One or more resolved Customers no longer exist or are archived.')
  }

  const usedCodesByCustomer = new Map<string, Set<string>>()
  for (const site of existingSites) {
    if (!site.code) continue
    const set = usedCodesByCustomer.get(site.customerId) ?? new Set<string>()
    set.add(site.code.toUpperCase())
    usedCodesByCustomer.set(site.customerId, set)
  }

  const created: Array<{ id: string; customerId: string; name: string; code: string; referenceId: string; referenceMetadata: DeviceImportStagedReferenceMetadata }> = []
  const existingLinks: Array<{ referenceId: string; targetId: string; referenceMetadata: DeviceImportStagedReferenceMetadata }> = []

  for (const reference of references) {
    const meta = metadata(reference.metadata)
    const customerId = meta.customerTargetId!
    const exact = existingSites.find((site) =>
      site.customerId === customerId && normalizeImportText(site.name) === normalizeImportText(reference.sourceValue),
    )
    if (exact) {
      existingLinks.push({ referenceId: reference.id, targetId: exact.id, referenceMetadata: meta })
      continue
    }

    const usedCodes = usedCodesByCustomer.get(customerId) ?? new Set<string>()
    const code = nextAvailableSiteCode(suggestedBulkSiteCode(reference.sourceValue), usedCodes)
    usedCodes.add(code)
    usedCodesByCustomer.set(customerId, usedCodes)
    created.push({
      id: randomUUID(),
      customerId,
      name: reference.sourceValue,
      code,
      referenceId: reference.id,
      referenceMetadata: meta,
    })
  }

  const operations = [
    ...(created.length ? [prisma.site.createMany({
      data: created.map((site) => ({
        id: site.id,
        customerId: site.customerId,
        name: site.name,
        code: site.code,
        isActive: true,
        source: 'IMPORT',
      })),
    })] : []),
    ...created.map((site) => prisma.deviceImportStagedReference.update({
      where: { id: site.referenceId },
      data: {
        status: 'LINKED',
        targetId: site.id,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: 'CREATED',
        metadata: { ...site.referenceMetadata, waitingFor: [] },
      },
    })),
    ...existingLinks.map((link) => prisma.deviceImportStagedReference.update({
      where: { id: link.referenceId },
      data: {
        status: 'LINKED',
        targetId: link.targetId,
        suggestedTargetId: null,
        suggestionScore: null,
        resolutionSource: 'EXACT',
        metadata: { ...link.referenceMetadata, waitingFor: [] },
      },
    })),
  ]
  await prisma.$transaction(operations)

  const unresolved = await prisma.deviceImportStagedReference.count({ where: { batchId, status: { not: 'LINKED' } } })
  await prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: unresolved === 0 ? 'READY' : 'STAGED' } })

  return {
    workspace: await getDeviceImportBatchWorkspace(batchId),
    created: created.length,
    linkedExisting: existingLinks.length,
    sites: created.map((site) => ({ id: site.id, name: site.name, code: site.code, customerId: site.customerId })),
  }
}
