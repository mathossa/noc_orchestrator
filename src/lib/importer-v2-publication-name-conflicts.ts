import { prisma } from '@/lib/prisma'
import {
  importerV2WorkspaceEffectiveEvaluated,
  importerV2WorkspaceEffectiveText,
} from '@/lib/importer-v2-workspace-effective-overlay'
import { importerV2WorkspaceIdentityReview } from '@/lib/importer-v2-workspace-identity-state'

type Evaluated = {
  proposedCanonicalValues?: {
    customer?: { id?: string | null; label?: string | null } | null
  }
}

/**
 * A customer/name unique constraint is NOT identity evidence.
 *
 * Hold auto-publication of a new device when its customer/name is already
 * present in the canonical inventory, or another new row in this batch.
 * Never silently merge by name: the engineer must confirm durable identity.
 */
export async function findImporterV2PublicationNameConflicts(input: {
  batchId: string
  rowNumbers: readonly number[]
}): Promise<number[]> {
  if (input.rowNumbers.length === 0) return []
  const batch = await prisma.importerV2WorkspaceBatch.findUnique({
    where: { id: input.batchId },
    select: {
      rows: {
        where: {
          rowNumber: { in: [...input.rowNumbers] },
          inclusion: 'INCLUDED',
          publishedAt: null,
        },
        select: {
          rowNumber: true,
          inclusion: true,
          evaluated: true,
          identityResolution: true,
          decisions: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { action: true, field: true, value: true },
          },
        },
      },
    },
  })
  if (!batch) return []
  const proposed = batch.rows.flatMap(row => {
    const identity = importerV2WorkspaceIdentityReview({
      identityResolution: row.identityResolution,
      decisions: row.decisions,
    })
    const existingId = identity?.selectedDecision === 'CREATE_NEW'
      ? null
      : identity?.selectedCanonicalDeviceId ??
        (!identity?.requiresConfirmation && identity?.candidates.length === 1
          ? identity.candidates[0].canonicalDeviceId : null)
    if (existingId) return []

    const snapshot = importerV2WorkspaceEffectiveEvaluated({
      evaluated: row.evaluated,
      inclusion: row.inclusion,
      decisions: row.decisions,
    }).evaluated as Evaluated
    const name =
      importerV2WorkspaceEffectiveText(snapshot, 'deviceName') ??
      importerV2WorkspaceEffectiveText(snapshot, 'hostname')
    const target = snapshot.proposedCanonicalValues?.customer
    const customerId = target?.id ?? null
    const customerName =
      target?.label ?? importerV2WorkspaceEffectiveText(snapshot, 'customer')
    if (!name || (!customerId && !customerName)) return []
    return [{
      rowNumber: row.rowNumber,
      name,
      customerId,
      customerName,
    }]
  })
  if (!proposed.length) return []

  const names = [...new Set(proposed.map(row => row.name))]
  const customerIds = [...new Set(proposed.flatMap(row => row.customerId ? [row.customerId] : []))]
  const customerNames = [...new Set(proposed.flatMap(row => row.customerName ? [row.customerName] : []))]
  const customers = await prisma.customer.findMany({
    where: {
      OR: [
        ...(customerIds.length ? [{ id: { in: customerIds } }] : []),
        ...(customerNames.length ? [{ name: { in: customerNames } }] : []),
      ],
    },
    select: { id: true, name: true },
  })
  const idsByName = new Map(customers.map(customer => [customer.name, customer.id]))
  const resolved = proposed.flatMap(row => {
    const customerId = row.customerId ?? (row.customerName ? idsByName.get(row.customerName) : null)
    return customerId ? [{...row, customerId}] : []
  })
  if (!resolved.length) return []
  const resolvedCustomerIds = [...new Set(resolved.map(row => row.customerId))]
  const existing = await prisma.device.findMany({
    where: {
      customerId: { in: resolvedCustomerIds },
      name: { in: names },
    },
    select: { customerId: true, name: true },
  })
  const key = (customerId: string, name: string) => JSON.stringify([customerId, name])
  const occupied = new Set(existing.map(row => key(row.customerId, row.name)))
  const rowsByKey = new Map<string, number[]>()
  for (const row of resolved) {
    const group = key(row.customerId, row.name)
    rowsByKey.set(group, [...(rowsByKey.get(group) ?? []), row.rowNumber])
  }
  return [...new Set([...rowsByKey.entries()].flatMap(([group, rowNumbers]) =>
    occupied.has(group) || rowNumbers.length > 1 ? rowNumbers : [],
  ))].sort((a,b) => a-b)
}
