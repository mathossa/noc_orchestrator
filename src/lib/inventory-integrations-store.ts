import { prisma } from '@/lib/prisma'
import {
  normalizeInventorySourceDefinition,
  type InventorySourceDefinition,
} from '@/lib/inventory-source-adapter'

type CreateInventorySourceInput = Omit<InventorySourceDefinition, 'id'>

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function sourceRecord(record: {
  id: string
  provider: string
  adapterType: string
  sourceAdapterId: string
  name: string
  enabled: boolean
  configuration: unknown
  metadata: unknown
}) {
  return {
    id: record.id,
    provider: record.provider,
    adapterType: record.adapterType,
    sourceAdapterId: record.sourceAdapterId,
    name: record.name,
    enabled: record.enabled,
    configuration: (record.configuration ?? {}) as Record<string, unknown>,
    metadata: (record.metadata ?? null) as Record<string, unknown> | null,
  } satisfies InventorySourceDefinition
}

export async function createInventorySource(input: CreateInventorySourceInput) {
  const source = normalizeInventorySourceDefinition(input)
  const record = await prisma.inventorySource.create({
    data: {
      provider: source.provider,
      adapterType: source.adapterType,
      sourceAdapterId: source.sourceAdapterId,
      name: source.name,
      enabled: source.enabled,
      configuration: jsonValue(source.configuration),
      metadata: source.metadata ? jsonValue(source.metadata) : undefined,
    },
  })
  return sourceRecord(record)
}

export async function listInventorySources() {
  const records = await prisma.inventorySource.findMany({
    orderBy: [{ provider: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  })
  return records.map(sourceRecord)
}

export async function createInventorySyncProfile(input: {
  name: string
  enabled?: boolean
  sourceIds: readonly string[]
}) {
  const name = input.name.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Inventory Sync Profile name is required.')
  const sourceIds = [...new Set(input.sourceIds)]
  if (sourceIds.length === 0) {
    throw new Error('Inventory Sync Profile must reference at least one source.')
  }

  return prisma.inventorySyncProfile.create({
    data: {
      name,
      enabled: input.enabled ?? true,
      sources: {
        create: sourceIds.map((sourceId, position) => ({
          position,
          source: { connect: { id: sourceId } },
        })),
      },
    },
    include: {
      sources: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { source: true },
      },
    },
  })
}

export async function attachInventorySourceToSyncProfile(input: {
  profileId: string
  sourceId: string
  position?: number
}) {
  return prisma.inventorySyncProfileSource.create({
    data: {
      profileId: input.profileId,
      sourceId: input.sourceId,
      position: input.position ?? 0,
    },
    include: { source: true },
  })
}

export async function listInventorySyncProfiles() {
  return prisma.inventorySyncProfile.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: {
      sources: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { source: true },
      },
    },
  })
}
