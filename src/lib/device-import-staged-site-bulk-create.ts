import { randomUUID } from 'node:crypto'
import { normalizeImportText } from '@/lib/device-import'
import {
  nextAvailableImportSiteCode,
  suggestedImportSiteCode,
  suggestedImportSiteName,
} from '@/lib/device-import-site-code'
import { getDeviceImportBatchWorkspace, DeviceImportStagingError } from '@/lib/device-import-staging-store'
import type { DeviceImportStagedReferenceMetadata } from '@/lib/device-import-staging'
import { prisma } from '@/lib/prisma'

const MAX_BULK_SITES = 250

type StagedSiteReference = {
  id: string
  sourceValue: string
  metadata: unknown
}

type SiteProposalInput = {
  referenceIds: string[]
  name: string
  code: string
}

function metadata(value: unknown): DeviceImportStagedReferenceMetadata {
  return typeof value === 'object' && value !== null ? value as DeviceImportStagedReferenceMetadata : {}
}

async function loadReadySiteReferences(batchId: string) {
  const [batch, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } }),
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, kind: 'SITE', status: 'UNRESOLVED' },
      select: { id: true, sourceValue: true, metadata: true },
      orderBy: [{ sourceValue: 'asc' }],
    }) as Promise<StagedSiteReference[]>,
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  return references.filter((reference) => Boolean(metadata(reference.metadata).customerTargetId))
}

export async function getDeviceImportSiteCreateProposals(batchId: string) {
  const references = await loadReadySiteReferences(batchId)
  const customerIds = [...new Set(references.map((reference) => metadata(reference.metadata).customerTargetId!).filter(Boolean))]
  const [customers, existingSites] = await Promise.all([
    customerIds.length
      ? prisma.customer.findMany({ where: { id: { in: customerIds }, isActive: true }, select: { id: true, code: true, name: true } })
      : Promise.resolve([]),
    customerIds.length
      ? prisma.site.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, customerId: true, name: true, code: true } })
      : Promise.resolve([]),
  ])
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))
  const usedCodesByCustomer = new Map<string, Set<string>>()
  for (const site of existingSites) {
    if (!site.code) continue
    const used = usedCodesByCustomer.get(site.customerId) ?? new Set<string>()
    used.add(site.code.toUpperCase())
    usedCodesByCustomer.set(site.customerId, used)
  }

  const grouped = new Map<string, {
    customerId: string
    referenceIds: string[]
    sourceValues: string[]
    customerSourceValues: string[]
    name: string
  }>()
  for (const reference of references) {
    const meta = metadata(reference.metadata)
    const customerId = meta.customerTargetId!
    const customer = customerById.get(customerId)
    if (!customer) continue
    const proposedName = suggestedImportSiteName(reference.sourceValue, meta.customerSourceValue, customer.name)
    const key = `${customerId}|${normalizeImportText(proposedName)}`
    const current = grouped.get(key)
    if (current) {
      current.referenceIds.push(reference.id)
      if (!current.sourceValues.includes(reference.sourceValue)) current.sourceValues.push(reference.sourceValue)
      if (meta.customerSourceValue && !current.customerSourceValues.includes(meta.customerSourceValue)) {
        current.customerSourceValues.push(meta.customerSourceValue)
      }
    } else {
      grouped.set(key, {
        customerId,
        referenceIds: [reference.id],
        sourceValues: [reference.sourceValue],
        customerSourceValues: meta.customerSourceValue ? [meta.customerSourceValue] : [],
        name: proposedName,
      })
    }
  }

  const proposals = [...grouped.values()].sort((left, right) => {
    const customerOrder = (customerById.get(left.customerId)?.name ?? '').localeCompare(customerById.get(right.customerId)?.name ?? '')
    return customerOrder || left.name.localeCompare(right.name)
  }).map((group) => {
    const existing = existingSites.find((site) =>
      site.customerId === group.customerId && normalizeImportText(site.name) === normalizeImportText(group.name),
    ) ?? null
    const used = usedCodesByCustomer.get(group.customerId) ?? new Set<string>()
    const code = existing?.code ?? nextAvailableImportSiteCode(suggestedImportSiteCode(group.name), used)
    if (!existing) {
      used.add(code.toUpperCase())
      usedCodesByCustomer.set(group.customerId, used)
    }
    const customer = customerById.get(group.customerId)!
    return {
      key: `${group.customerId}|${normalizeImportText(group.name)}`,
      customerId: group.customerId,
      customerName: customer.name,
      customerCode: customer.code,
      referenceIds: group.referenceIds,
      sourceValues: group.sourceValues,
      customerSourceValues: group.customerSourceValues,
      name: group.name,
      code,
      existingTarget: existing ? { id: existing.id, name: existing.name, code: existing.code } : null,
    }
  })

  return {
    proposals,
    rawReferenceCount: references.length,
    proposalCount: proposals.length,
    duplicateReferenceCount: Math.max(0, references.length - proposals.length),
  }
}

function parseProposalItems(rawInput: unknown): SiteProposalInput[] {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!rawItems.length) throw new DeviceImportStagingError('Choose at least one prepared Site to create or link.')
  if (rawItems.length > MAX_BULK_SITES) throw new DeviceImportStagingError(`Create at most ${MAX_BULK_SITES} Sites in one bulk action.`)
  return rawItems.map((rawItem) => {
    const item = typeof rawItem === 'object' && rawItem !== null ? rawItem as Record<string, unknown> : {}
    const referenceIds = Array.isArray(item.referenceIds)
      ? item.referenceIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
      : []
    const name = typeof item.name === 'string' ? item.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : ''
    const code = typeof item.code === 'string' ? item.code.normalize('NFKC').trim().toUpperCase().replace(/[\s_]+/g, '-') : ''
    if (!referenceIds.length || !name || !code) throw new DeviceImportStagingError('Every prepared Site needs source references, a Site name, and a Site code.')
    if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(code)) throw new DeviceImportStagingError(`Site code “${code}” may contain only letters, numbers, dots, and hyphens.`)
    return { referenceIds, name, code }
  })
}

export async function bulkCreateDeviceImportSites(rawInput: unknown) {
  const input = typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}
  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  if (!batchId) throw new DeviceImportStagingError('Import batch is required.')
  const items = parseProposalItems(rawInput)
  const allReferenceIds = items.flatMap((item) => item.referenceIds)
  if (new Set(allReferenceIds).size !== allReferenceIds.length) throw new DeviceImportStagingError('A staged Site reference can only appear in one prepared Site.')

  const [batch, references] = await Promise.all([
    prisma.deviceImportBatch.findUnique({ where: { id: batchId }, select: { id: true, status: true } }),
    prisma.deviceImportStagedReference.findMany({
      where: { batchId, kind: 'SITE', status: 'UNRESOLVED', id: { in: allReferenceIds } },
      select: { id: true, sourceValue: true, metadata: true },
    }) as Promise<StagedSiteReference[]>,
  ])
  if (!batch) throw new DeviceImportStagingError('Import batch was not found.')
  if (batch.status === 'PUBLISHED') throw new DeviceImportStagingError('Published import batches can no longer be changed.')
  if (references.length !== allReferenceIds.length) throw new DeviceImportStagingError('One or more prepared Site references are no longer unresolved.')

  const referenceById = new Map(references.map((reference) => [reference.id, reference]))
  const prepared = items.map((item) => {
    const refs = item.referenceIds.map((id) => referenceById.get(id)!)
    const customerIds = [...new Set(refs.map((reference) => metadata(reference.metadata).customerTargetId).filter((id): id is string => Boolean(id)))]
    if (customerIds.length !== 1) throw new DeviceImportStagingError(`Prepared Site “${item.name}” must belong to exactly one resolved Customer.`)
    return { ...item, customerId: customerIds[0], refs }
  })

  const canonicalKeys = prepared.map((item) => `${item.customerId}|${normalizeImportText(item.name)}`)
  if (new Set(canonicalKeys).size !== canonicalKeys.length) {
    throw new DeviceImportStagingError('Two prepared Sites have the same name under the same Customer. Merge or rename them before creating.')
  }
  const codeKeys = prepared.map((item) => `${item.customerId}|${item.code.toUpperCase()}`)
  if (new Set(codeKeys).size !== codeKeys.length) {
    throw new DeviceImportStagingError('Two prepared Sites use the same code under the same Customer. Change one of the codes before creating.')
  }

  const customerIds = [...new Set(prepared.map((item) => item.customerId))]
  const [customers, existingSites] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: customerIds }, isActive: true }, select: { id: true } }),
    prisma.site.findMany({ where: { customerId: { in: customerIds } }, select: { id: true, customerId: true, name: true, code: true } }),
  ])
  if (customers.length !== customerIds.length) throw new DeviceImportStagingError('One or more resolved Customers no longer exist or are archived.')

  const created: Array<{ id: string; customerId: string; name: string; code: string; refs: StagedSiteReference[] }> = []
  const existingLinks: Array<{ targetId: string; refs: StagedSiteReference[] }> = []
  for (const item of prepared) {
    const exact = existingSites.find((site) => site.customerId === item.customerId && normalizeImportText(site.name) === normalizeImportText(item.name))
    if (exact) {
      existingLinks.push({ targetId: exact.id, refs: item.refs })
      continue
    }
    const codeConflict = existingSites.find((site) => site.customerId === item.customerId && site.code?.toUpperCase() === item.code.toUpperCase())
    if (codeConflict) throw new DeviceImportStagingError(`Site code “${item.code}” is already used under this Customer. Change the proposed code and try again.`)
    created.push({ id: randomUUID(), customerId: item.customerId, name: item.name, code: item.code, refs: item.refs })
  }

  const operations = [
    ...(created.length ? [prisma.site.createMany({
      data: created.map((site) => ({ id: site.id, customerId: site.customerId, name: site.name, code: site.code, isActive: true, source: 'IMPORT' })),
    })] : []),
    ...created.flatMap((site) => site.refs.map((reference) => prisma.deviceImportStagedReference.update({
      where: { id: reference.id },
      data: {
        status: 'LINKED', targetId: site.id, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'CREATED',
        metadata: { ...metadata(reference.metadata), waitingFor: [] },
      },
    }))),
    ...existingLinks.flatMap((link) => link.refs.map((reference) => prisma.deviceImportStagedReference.update({
      where: { id: reference.id },
      data: {
        status: 'LINKED', targetId: link.targetId, suggestedTargetId: null, suggestionScore: null, resolutionSource: 'EXACT',
        metadata: { ...metadata(reference.metadata), waitingFor: [] },
      },
    }))),
  ]
  await prisma.$transaction(operations)

  const unresolved = await prisma.deviceImportStagedReference.count({ where: { batchId, status: { not: 'LINKED' } } })
  await prisma.deviceImportBatch.update({ where: { id: batchId }, data: { status: unresolved === 0 ? 'READY' : 'STAGED' } })
  return {
    workspace: await getDeviceImportBatchWorkspace(batchId),
    created: created.length,
    linkedExisting: existingLinks.length,
  }
}
