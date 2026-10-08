import { prisma } from '@/lib/prisma'

export type InventorySyncTrigger = 'MANUAL' | 'SCHEDULED'
export type InventorySyncRunStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Inventory synchronization failed.'
}

export async function beginInventorySyncRun(
  sourceId: string,
  trigger: InventorySyncTrigger,
) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "InventorySource"
      WHERE "id" = ${sourceId}
      FOR UPDATE
    `
    if (locked.length === 0) throw new Error('Inventory source was not found.')

    const running = await tx.inventorySyncRun.findFirst({
      where: { sourceId, status: 'RUNNING' },
      orderBy: { startedAt: 'desc' },
    })
    if (running) {
      throw new Error(
        `Inventory synchronization is already running for this source (run ${running.id}).`,
      )
    }

    return tx.inventorySyncRun.create({
      data: { sourceId, trigger, status: 'RUNNING' },
    })
  })
}

export async function completeInventorySyncRun(input: {
  runId: string
  status: Exclude<InventorySyncRunStatus, 'RUNNING'>
  batchId?: string | null
  fetchedCount?: number
  stagedCount?: number
  autoPublishedCount?: number
  reviewRequiredCount?: number
  ignoredCount?: number
  errorCount?: number
  failureSummary?: unknown
  metadata?: unknown
}) {
  return prisma.inventorySyncRun.update({
    where: { id: input.runId },
    data: {
      status: input.status,
      finishedAt: new Date(),
      batchId: input.batchId ?? null,
      fetchedCount: input.fetchedCount ?? 0,
      stagedCount: input.stagedCount ?? 0,
      autoPublishedCount: input.autoPublishedCount ?? 0,
      reviewRequiredCount: input.reviewRequiredCount ?? 0,
      ignoredCount: input.ignoredCount ?? 0,
      errorCount: input.errorCount ?? 0,
      failureSummary:
        input.failureSummary === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(input.failureSummary)) as never),
      metadata:
        input.metadata === undefined
          ? undefined
          : (JSON.parse(JSON.stringify(input.metadata)) as never),
    },
  })
}

export async function failInventorySyncRun(runId: string, error: unknown) {
  return prisma.inventorySyncRun.update({
    where: { id: runId },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorCount: 1,
      errorMessage: errorMessage(error),
    },
  })
}

export async function listInventorySyncRuns(sourceId: string, limit = 20) {
  return prisma.inventorySyncRun.findMany({
    where: { sourceId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: Math.max(1, Math.min(limit, 100)),
  })
}
